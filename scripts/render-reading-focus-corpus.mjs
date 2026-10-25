import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

// Replay only persisted, terminal real responses. No credentials, API client or user profile.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--batch', '--playwright', '--browser-channel'].includes(process.argv[i]) || !process.argv[i + 1]) throw Error('Usage: node scripts/render-reading-focus-corpus.mjs --batch batch.json [--browser-channel chrome] [--playwright module-path]');
  args.set(process.argv[i], process.argv[i + 1]);
}
if (!args.has('--batch')) throw Error('--batch is required');
const channel = args.get('--browser-channel') ?? 'chrome';
if (!['chrome', 'msedge', 'chromium'].includes(channel)) throw Error('Unsupported browser channel');
const batchPath = resolve(args.get('--batch'));
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const items = Array.isArray(batch) ? batch : batch.results;
if (!Array.isArray(items)) throw Error('Batch must contain results');
const output = resolve(dirname(batchPath), 'render');
const require = createRequire(import.meta.url);
const { chromium } = require(args.get('--playwright') ?? 'C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const json = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const publicAsset = (address) => {
  try {
    const url = new URL(address), host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !host.includes(':') && host !== 'localhost' && !host.endsWith('.localhost')
      && !host.endsWith('.local') && !/^\d+(?:\.\d+){3}$/.test(host);
  } catch { return false; }
};
let browser, vite;
const summaries = [];
await mkdir(output, { recursive: true });
try {
  vite = await createServer({ root, configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: 'custom' });
  const compiled = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: false, lib: { entry: 'corpus-render-entry', formats: ['iife'], name: '__readingCorpusReplay' } }, plugins: [{
    name: 'production-replay-transform',
    resolveId(path) {
      if (path === 'corpus-render-entry' || path === resolve(root, 'corpus-render-entry')) return '\0corpus-render-entry';
      if (path.startsWith('/src/')) return resolve(root, path.slice(1).split('?')[0]);
    },
    async load(path) {
      if (path === '\0corpus-render-entry') return 'export { createReadingFocus, readingParagraphs } from "/src/content/readingFocus/index.ts"; export { paragraphText, rangeEndpoints } from "/src/content/readingFocus/text.ts";';
      if (!path.endsWith('.ts') || !isAbsolute(path) || relative(root, path).startsWith('..')) return;
      const transformed = await vite.transformRequest(`/${relative(root, path).replaceAll('\\', '/')}`);
      if (!transformed) throw Error(`Cannot transform production module: ${path}`);
      return transformed.code;
    },
  }] });
  const bundle = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(chunk => chunk.type === 'chunk').code;
  browser = await chromium.launch({ headless: true, channel, timeout: 60_000 });
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(item.id ?? '')) throw Error('Invalid sample id');
    const directory = resolve(output, item.id);
    await mkdir(directory, { recursive: true });
    const checks = { id: item.id, evidence: 'persisted-real-WorkOS-response-replayed-on-saved-DOM', userOriginalTabAcceptance: false, callsToWorkOS: 0, startedAt: new Date().toISOString(), captureFile: item.captureFile, runDirectory: item.directory, checks: [], hovers: [] };
    let context;
    try {
      const run = await readJson(resolve(item.directory, 'run.json'));
      checks.remoteStatus = run.status;
      if (run.status !== 'ready') {
        checks.status = 'skipped'; checks.reason = `Persisted task is ${run.status}; unconfirmed/candidate responses are never replayed as ready`;
        continue;
      }
      assert.ok(run.result, 'Ready run must contain production-parsed result');
      const capture = await readJson(resolve(item.captureFile));
      const submitted = await readJson(resolve(item.directory, 'snapshot.json'));
      assert.deepEqual(submitted, capture.snapshot, 'Captured and actually submitted snapshots must match exactly');
      checks.checks.push('captured-and-submitted-snapshot-exactly-equal');
      const source = new URL(capture.snapshot.url);
      assert.ok(publicAsset(source.href), 'Replay URL must be public');
      const html = await readFile(resolve(dirname(item.captureFile), 'rendered.html'), 'utf8');
      await writeFile(resolve(directory, 'rendered.html'), html);
      // Keep our evaluated production listeners functional. CSP plus routing disables
      // website scripts; context-wide JS disabling also disables injected listeners.
      context = await browser.newContext({ javaScriptEnabled: true, viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
      const requests = { allowedStatic: 0, blockedOther: 0 };
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() === source.href) {
          return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': "script-src 'none'; object-src 'none'; frame-src 'none'" }, body: html });
        }
        if (['stylesheet', 'font', 'image'].includes(request.resourceType()) && publicAsset(request.url())) {
          requests.allowedStatic++; return route.continue();
        }
        requests.blockedOther++; return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(source.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
      await page.evaluate(bundle);
      const setup = await page.evaluate(({ snapshot, result, id }) => {
        const api = window.__readingCorpusReplay;
        const found = api.readingParagraphs(document);
        const actual = found.paragraphs.map((node, i) => ({ id: `p${i}`, text: api.paragraphText(node).text }));
        if (JSON.stringify(actual) !== JSON.stringify(snapshot.paragraphs)) return { matches: false, actual };
        const rangeChecks = [];
        for (const entry of result.paragraphs) {
          if (entry.status !== 'ready') continue;
          const index = snapshot.paragraphs.findIndex(p => p.id === entry.id);
          const text = api.paragraphText(found.paragraphs[index]);
          if (text.text !== entry.text) throw Error(`Result text mismatch: ${entry.id}`);
          for (const group of entry.groups) {
            const endpoints = api.rangeEndpoints(text.segments, group.start, group.end);
            if (!endpoints) throw Error(`No Range endpoints: ${entry.id}`);
            const range = document.createRange();
            range.setStart(endpoints.startNode, endpoints.startOffset); range.setEnd(endpoints.endNode, endpoints.endOffset);
            rangeChecks.push({ paragraphId: entry.id, kind: group.kind, expected: group.text, actual: range.toString(), exact: range.toString() === group.text });
          }
        }
        const replay = window.__readingReplayState = { statuses: [], paragraphs: found.paragraphs, snapshot, result,
          originalBody: document.body.innerHTML, originalLinks: [...document.links].map(a => [a.outerHTML, a.href]), prepareCalls: 0 };
        const task = { id: `persisted-real:${id}`, status: 'ready', total: result.total, readyCount: result.readyCount, invalidCount: result.invalidCount, result };
        replay.focus = api.createReadingFocus({ document,
          prepare: async input => { if (JSON.stringify(input.paragraphs) !== JSON.stringify(snapshot.paragraphs)) throw Error('Prepare snapshot changed'); replay.prepareCalls++; return task; },
          getTask: async () => task, stopTask: async () => { throw Error('No remote task is connected to replay'); }, onStatus: status => replay.statuses.push(status) });
        replay.focus.enable();
        return { matches: true, rangeChecks };
      }, { snapshot: capture.snapshot, result: run.result, id: item.id });
      assert.equal(setup.matches, true, 'Production paragraph discovery must match saved snapshot');
      checks.rangeChecks = setup.rangeChecks;
      assert.ok(setup.rangeChecks.every(check => check.exact), 'Every saved group must map exactly to original DOM Range text');
      checks.checks.push('production-discovery-matches-snapshot', 'all-ready-group-DOM-ranges-exact');
      await page.waitForFunction(() => window.__readingReplayState?.statuses.at(-1)?.phase === 'ready');
      const targets = run.result.paragraphs.filter(p => p.status === 'ready' && p.groups.length).slice(0, 2).map(p => p.id);
      if (item.focusIds !== undefined && !Array.isArray(item.focusIds)) throw Error('focusIds must be an array');
      checks.skippedTargets = [];
      const requestedTargets = [...(item.id.includes('zero') ? ['p8', 'p12'] : []), ...(item.focusIds ?? [])];
      for (const id of requestedTargets) {
        const entry = typeof id === 'string' && /^p\d+$/.test(id) ? run.result.paragraphs.find(p => p.id === id) : undefined;
        if (entry?.status === 'ready' && entry.groups.length && capture.snapshot.paragraphs.some(p => p.id === id)) targets.push(id);
        else checks.skippedTargets.push({ paragraphId: id, status: 'skipped', reason: !entry ? 'paragraph-id-missing-or-invalid' : entry.status !== 'ready' ? `paragraph-status-${entry.status}` : 'no-groups' });
      }
      for (const id of [...new Set(targets)]) {
        const target = await page.evaluateHandle(id => {
          const state = window.__readingReplayState;
          const index = state.snapshot.paragraphs.findIndex(p => p.id === id);
          const node = state.paragraphs[index];
          node.scrollIntoView({ block: 'center' });
          return node;
        }, id);
        try { await target.asElement().hover({ force: true }); }
        finally { await target.dispose(); }
        await page.waitForTimeout(220);
        const hover = await page.evaluate(id => {
          const state = window.__readingReplayState;
          const expected = state.result.paragraphs.find(p => p.id === id).groups.map(g => ({ kind: g.kind, text: g.text }));
          const actual = [...CSS.highlights].filter(([name]) => name.startsWith('yemai-rf-')).flatMap(([name, highlight]) => [...highlight].map(range => ({ kind: name.split('-').at(-1), text: range.toString() })));
          const canonical = values => values.map(v => `${v.kind}:${v.text}`).sort();
          const selection = document.getSelection();
          const focusAttributes = state.paragraphs.map((node, index) => ({ paragraphId: state.snapshot.paragraphs[index].id,
            state: [...node.attributes].filter(attr => attr.name.startsWith('data-yemai-rf-')).map(attr => ({ name: attr.name, value: attr.value })) }));
          return { paragraphId: id, expected, actual, exact: JSON.stringify(canonical(expected)) === JSON.stringify(canonical(actual)), status: state.statuses.at(-1),
            diagnostics: { selectionIsCollapsed: selection?.isCollapsed ?? null, selectionText: selection?.toString() ?? '', enabled: state.focus.enabled,
              url: document.URL, focusAttributes, highlightNames: [...CSS.highlights.keys()], statuses: state.statuses } };
        }, id);
        hover.screenshot = `${id}.png`;
        // Playwright's default caret hiding touches input.style and leaves style="".
        // Preserve the page verbatim so the exit DOM comparison measures the feature.
        await page.screenshot({ path: resolve(directory, hover.screenshot), timeout: 10_000, caret: 'initial' });
        checks.hovers.push(hover);
        assert.equal(hover.exact, true, `CSS.highlights must contain exactly persisted groups for ${id}`);
      }
      checks.checks.push('hover-CSS-highlights-match-persisted-groups');
      const exit = await page.evaluate(() => {
        const state = window.__readingReplayState;
        state.focus.disable();
        const actualBody = document.body.innerHTML;
        let difference = 0;
        while (difference < state.originalBody.length && state.originalBody[difference] === actualBody[difference]) difference++;
        return { highlightsRemaining: [...CSS.highlights.keys()].filter(name => name.startsWith('yemai-rf-')).length,
          bodyUnchanged: actualBody === state.originalBody,
          ...(actualBody === state.originalBody ? {} : { bodyDifference: { offset: difference,
            original: state.originalBody.slice(Math.max(0, difference - 160), difference + 320),
            actual: actualBody.slice(Math.max(0, difference - 160), difference + 320), originalLength: state.originalBody.length, actualLength: actualBody.length } }),
          linksUnchanged: JSON.stringify([...document.links].map(a => [a.outerHTML, a.href])) === JSON.stringify(state.originalLinks),
          prepareCalls: state.prepareCalls, status: state.statuses.at(-1) };
      });
      checks.exit = exit;
      assert.equal(exit.highlightsRemaining, 0); assert.equal(exit.bodyUnchanged, true); assert.equal(exit.linksUnchanged, true); assert.equal(exit.prepareCalls, 1);
      checks.checks.push('exit-restores-original-body-and-links-and-clears-highlights');
      checks.requests = requests;
      checks.status = 'passed';
    } catch (error) {
      checks.status = 'failed'; checks.error = error.message;
      process.exitCode = 1;
    } finally {
      await context?.close();
      checks.endedAt = new Date().toISOString();
      await json(resolve(directory, 'checks.json'), checks);
      summaries.push({ id: item.id, status: checks.status, reason: checks.reason ?? checks.error, output: directory });
      console.log(JSON.stringify(summaries.at(-1)));
    }
  }
  await json(resolve(output, 'summary.json'), { evidence: 'persisted-real-WorkOS-response-replay; not user original tab acceptance', callsToWorkOS: 0, results: summaries });
} finally {
  const deadline = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
  await deadline(browser?.close()); await deadline(vite?.close());
  process.exit(process.exitCode ?? 0);
}
