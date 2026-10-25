import { readFile } from 'node:fs/promises';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultOutput = join(root, 'output/reading-focus-corpus/runs');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : undefined;

/** Load the same prompt, validation, parser and transport factory as the extension. */
export async function loadRunnerProduction({ onPhase = () => {} } = {}) {
  onPhase('production-server-starting');
  const server = await createServer({
    configFile: false, root, logLevel: 'silent',
    cacheDir: join(root, 'node_modules/.vite-reading-corpus'),
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true }, appType: 'custom',
  });
  try {
    onPhase('production-analysis-loading');
    const analysis = await server.ssrLoadModule('/src/shared/pageReadingFocus.ts');
    onPhase('production-transport-loading');
    const factory = await server.ssrLoadModule('/src/services/workosTransportFactory.ts');
    onPhase('production-ready');
    return { ...analysis, ...factory, close: () => server.close() };
  } catch {
    await server.close();
    throw new Error('production-load-failed');
  }
}

function connectionTarget(connection, execute) {
  if (!connection) {
    if (execute) throw new Error('connection-required');
    return { transport: 'unconfigured', agentUuid: '' };
  }
  if (!['internal-v2', 'public-v1'].includes(connection.transport)
    || !/^[0-9a-f-]{36}$/i.test(connection.agentUuid ?? '')) throw new Error('invalid-connection');
  if (execute && (connection.schemaVersion !== 2
    || (connection.transport === 'public-v1' ? !connection.publicApiToken
      : !connection.internalV2?.accessToken || !connection.internalV2?.userUuid || !connection.internalV2?.organizationUuid))) {
    throw new Error('incomplete-connection');
  }
  return { transport: connection.transport, agentUuid: connection.agentUuid };
}

/** One case only. Persistent claims are intentionally never retried or removed. */
export async function runCase({ id, snapshot, connection, execute = false, timeoutMs = 180_000,
  outputRoot = defaultOutput, production, transport: suppliedTransport }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id ?? '')) throw new Error('invalid-case-id');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_800_000) throw new Error('invalid-timeout');
  const checked = production.validatePageReadingSnapshot(snapshot);
  const prompt = production.buildPageReadingPrompt(checked);
  const target = connectionTarget(connection, execute);
  const promptHash = sha256(prompt);
  const hash = sha256(JSON.stringify([target, prompt]));
  const directory = join(resolve(outputRoot), `${id}-${hash}`);
  mkdirSync(directory, { recursive: true });
  const statePath = join(directory, 'run.json');
  const claimPath = join(directory, 'submitted.lock');
  const previousRun = (previousDirectory) => {
    let previous;
    try { previous = JSON.parse(readFileSync(join(previousDirectory, 'run.json'), 'utf8')); } catch { /* A claim without a final write is unknown. */ }
    return {directory:previousDirectory,reused:true,status:previous?.status??'unknown',reason:previous?.reason??'existing-submission'};
  };
  const writeJson = (path, value) => {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  // Dry runs do not overwrite an executed run's evidence.
  try {
    readFileSync(claimPath);
    let previous;
    try { previous = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* Crash before first state write. */ }
    return { directory, reused: true, status: previous?.status ?? 'unknown', reason: previous?.reason ?? 'existing-submission' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('claim-read-failed');
  }
  if (!execute) {
    writeJson(join(directory, 'snapshot.json'), checked);
    writeFileSync(join(directory, 'prompt.txt'), prompt, { mode: 0o600 });
    writeJson(join(directory, 'dry-run.json'), { id, hash, promptHash, target, analysisVersion: production.ANALYSIS_VERSION,
      status: 'dry-run', paragraphs: checked.paragraphs.length, characters: checked.paragraphs.reduce((sum, p) => sum + p.text.length, 0) });
    return { directory, reused: false, status: 'dry-run', hash, promptHash };
  }
  // Aliases must not create extra remote sessions for identical target + prompt.
  // Also recognize runs written before the global claim was introduced.
  for (const entry of readdirSync(resolve(outputRoot), {withFileTypes:true})) {
    if (!entry.isDirectory() || !entry.name.endsWith(`-${hash}`)) continue;
    const previousDirectory=join(resolve(outputRoot),entry.name);
    try { readFileSync(join(previousDirectory,'submitted.lock')); return previousRun(previousDirectory); }
    catch(error) { if(error.code!=='ENOENT') throw new Error('claim-read-failed'); }
  }
  const claims=join(resolve(outputRoot),'.claims');
  mkdirSync(claims,{recursive:true});
  const globalClaim=join(claims,`${hash}.json`);
  try { writeFileSync(globalClaim,JSON.stringify({directory}),{flag:'wx',mode:0o600}); }
  catch(error) {
    if(error.code!=='EEXIST') throw new Error('claim-write-failed');
    try { return previousRun(JSON.parse(readFileSync(globalClaim,'utf8')).directory); }
    catch { return {directory,reused:true,status:'unknown',reason:'existing-submission'}; }
  }
  try { closeSync(openSync(claimPath, 'wx', 0o600)); }
  catch (error) {
    if (error.code === 'EEXIST') return { directory, reused: true, status: 'unknown', reason: 'existing-submission' };
    throw new Error('claim-write-failed');
  }
  const startedAt = Date.now();
  const state = { id, hash, promptHash, target, analysisVersion: production.ANALYSIS_VERSION,
    status: 'creating', phase: 'create-conversation', startedAt, events: [], rawResponse: '' };
  const persist = () => { state.updatedAt = Date.now(); writeJson(statePath, state); };
  const event = (type) => { state.events.push({ type, elapsedMs: Date.now() - startedAt }); persist(); };
  writeJson(join(directory, 'snapshot.json'), checked);
  writeFileSync(join(directory, 'prompt.txt'), prompt, { mode: 0o600 });
  persist(); // Persist the claim before any network operation.
  const controller = new AbortController();
  let terminal = false;
  let streamError = false;
  let finished = false;
  let interruptedReason;
  let interrupt;
  const interruption = new Promise((resolveInterrupted) => { interrupt = resolveInterrupted; });
  const stopReceiving = (reason) => {
    if (finished || interruptedReason) return;
    interruptedReason = reason;
    controller.abort();
    interrupt();
  };
  const timer = setTimeout(() => stopReceiving('timeout'), timeoutMs);
  const work = async () => {
    const transport = suppliedTransport ?? production.createWorkosTransport(connection);
    event('creating');
    const conversationUuid = await transport.createConversation(controller.signal);
    if (finished || controller.signal.aborted) return;
    state.conversationUuid = identifier(conversationUuid);
    state.status = 'submitted';
    state.phase = 'execute-stream';
    event('submitting'); // An ambiguous execute failure must never trigger a second submission.
    await transport.executeStream(conversationUuid, { content: prompt }, {
      onText(value) {
        if (finished || controller.signal.aborted) return;
        if (typeof value !== 'string' || value.length > production.MAX_PAGE_READING_OUTPUT_LENGTH) {
          stopReceiving('output-limit'); return;
        }
        const first = !state.rawResponse && value;
        state.rawResponse = value; // Production callbacks contain accumulated text, not a delta.
        state.phase = 'receiving';
        if (first) event('first-text'); else persist();
      },
      onComplete() { if (!finished && !controller.signal.aborted) { terminal = true; event('complete'); } },
      onError() { if (!finished && !controller.signal.aborted) { terminal = true; streamError = true; event('remote-error'); } },
      onActivity() { stopReceiving('unexpected-tool-activity'); },
      onArtifact() { stopReceiving('unexpected-artifact'); },
      onInterrupt() { stopReceiving('unexpected-interrupt'); },
    }, controller.signal);
  };
  try {
    await Promise.race([work(), interruption]);
    if (interruptedReason) { state.status = 'unknown'; state.reason = interruptedReason; }
    else if (!terminal) { state.status = 'unknown'; state.reason = 'unconfirmed-eof'; }
    else if (streamError) { state.status = 'failed'; state.reason = 'remote-error'; }
    else {
      state.phase = 'checking'; event('checking');
      try {
        state.result = production.parsePageReadingAnalysis(state.rawResponse, checked);
        state.status = state.result.readyCount ? 'ready' : 'failed';
        if (!state.result.readyCount) state.reason = 'no-valid-paragraphs';
      } catch { state.status = 'failed'; state.reason = 'invalid-analysis'; }
    }
  } catch (error) {
    // Never serialize exception messages, request headers, credentials, or remote error bodies.
    if (error?.name === 'WorkosProgressDisconnected') {
      state.conversationUuid = identifier(error.conversationUuid) ?? state.conversationUuid;
      state.runId = identifier(error.runId);
    }
    state.status = terminal ? 'failed' : 'unknown';
    if (['WorkosApiError','WorkosProgressDisconnected'].includes(error?.name)) state.errorType=error.name;
    if (Number.isInteger(error?.status)&&error.status>=100&&error.status<=599) state.httpStatus=error.status;
    state.reason = interruptedReason ?? (error?.name === 'WorkosProgressDisconnected' ? 'progress-disconnected' : 'transport-error');
  } finally {
    finished = true;
    clearTimeout(timer);
    controller.abort(); // Receive-only cancellation; does not claim to stop the remote task.
    state.durationMs = Date.now() - startedAt;
    state.finishedAt = Date.now();
    event(state.status);
  }
  return { directory, reused: false, status: state.status, reason: state.reason, durationMs: state.durationMs,
    conversationUuid: state.conversationUuid, runId: state.runId };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!['--snapshot', '--id', '--connection-file', '--timeout-ms', '--execute'].includes(key) || key in options) throw new Error('invalid-arguments');
    options[key] = key === '--execute' ? true : argv[++index];
    if (!options[key] || String(options[key]).startsWith('--')) throw new Error('invalid-arguments');
  }
  if (!options['--snapshot'] || !options['--id']) throw new Error('snapshot-and-id-required');
  let connection;
  try {
    const value = options['--connection-file'] ? await readFile(options['--connection-file'], 'utf8') : process.env.READING_WORKOS_CONNECTION_JSON;
    if (value) connection = JSON.parse(value);
  } catch { throw new Error('connection-read-failed'); }
  let snapshot;
  try { const value = JSON.parse(await readFile(options['--snapshot'], 'utf8')); snapshot = value.snapshot ?? value; }
  catch { throw new Error('snapshot-read-failed'); }
  const production = await loadRunnerProduction({ onPhase: (phase) => process.stderr.write(`[reading-focus] ${phase}\n`) });
  try {
    const result = await runCase({ id: options['--id'], snapshot, connection, execute: Boolean(options['--execute']),
      timeoutMs: options['--timeout-ms'] ? Number(options['--timeout-ms']) : 180_000, production });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally { await production.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Reading Focus runner failed; check arguments, snapshot, connection and local output permissions. No automatic retry was performed.\n'); process.exitCode = 1; });
}
