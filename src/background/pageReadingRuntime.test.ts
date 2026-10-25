import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageReadingRuntime, type PageReadingRuntimeDependencies, type PageReadingSender } from './pageReadingRuntime';
import type { PageReadingTask } from '../shared/pageReadingFocus';
import type { WorkosTransport } from '../services/workosTransport';
import { WORKOS_INTERNAL_V2_BASE_URL, WorkosProgressDisconnected } from '../services/workosTransport';
import { YemaiDatabase } from '../data/database';
import { PageReadingRepository } from '../data/pageReadingRepository';
import type { WorkosConnectionSettings } from '../services/workosConnection';
import type { WorkosSseCallbacks } from '../services/workosSse';

const connection: WorkosConnectionSettings = {
  schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '',
  internalV2: { accessToken: 'secret', userUuid: 'user', organizationUuid: 'org' },
};
const snapshot = { url: 'https://example.com/article', title: 'Article', paragraphs: [
  { id: 'p0', text: 'Use a script if the workflow is predictable.' },
  { id: 'p1', text: 'Read the documentation before continuing.' },
] };
const output = JSON.stringify({ paragraphs: [
  { id: 'p0', groups: [{ text: 'Use a script', kind: 'core' }] },
  { id: 'p1', groups: [] },
] });
const sender: PageReadingSender = { id: 'extension', frameId: 0, tab: { id: 3 }, documentId: 'doc', url: snapshot.url };
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const runtimes: ReturnType<typeof createPageReadingRuntime>[] = [];
function setup(overrides: Partial<PageReadingRuntimeDependencies> = {}, remoteOverrides: Partial<WorkosTransport> = {}) {
  const records = new Map<string, PageReadingTask>();
  const repository = {
    get: vi.fn(async (id: string) => structuredClone(records.get(id))),
    put: vi.fn(async (task: PageReadingTask) => { records.set(task.id, structuredClone(task)); }),
    claim: vi.fn(async (task: PageReadingTask, retry = false) => {
      const existing = records.get(task.id);
      if (existing && !(retry && ['failed', 'stopped'].includes(existing.status))) return { task: structuredClone(existing), created: false };
      records.set(task.id, structuredClone(task)); return { task, created: true };
    }),
    listUnfinished: vi.fn(async () => [...records.values()].filter((t) => ['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping'].includes(t.status))),
    prune: vi.fn(async () => undefined),
  };
  const remote: WorkosTransport = {
    kind: 'internal-v2', createConversation: vi.fn(async () => 'remote-session'),
    executeStream: vi.fn(async (_id, _request, callbacks) => { callbacks.onText(output); callbacks.onComplete?.(); }),
    abortConversation: vi.fn(async () => undefined), ...remoteOverrides,
  };
  const loadConnection = vi.fn(async () => connection);
  const createTransport = vi.fn(() => remote);
  const keepAlive = vi.fn(async () => undefined);
  const runtime = createPageReadingRuntime({ extensionId: 'extension', repository, loadConnection, createTransport, keepAlive,
    timeoutMs: 1_000, stopTimeoutMs: 10, ...overrides });
  runtimes.push(runtime);
  return { runtime, repository, remote, records, loadConnection, createTransport, keepAlive };
}
function ask(runtime: ReturnType<typeof createPageReadingRuntime>, request: unknown = { type: 'reading-focus:page-prepare', snapshot }, from = sender) {
  return new Promise<any>((resolve) => runtime.handle(request, from, resolve));
}
async function status(runtime: ReturnType<typeof createPageReadingRuntime>, id: string, from = sender) {
  await tick(); return ask(runtime, { type: 'reading-focus:page-status', id }, from);
}
afterEach(() => { runtimes.splice(0).forEach((runtime) => runtime.dispose()); vi.useRealTimers(); });

describe('durable article analysis runtime', () => {
  it('fails wholly invalid expression results, retries only explicitly, and caches a legitimate empty scan', async () => {
    let reply = JSON.stringify({ expressions: [{ text: 'based on', category: 'collocation', meaning: '基于',
      occurrences: [{ paragraphId: 'p0', text: 'based on' }] }] }); // absent from source
    const f = setup({}, { executeStream: vi.fn(async (_id, _request, callbacks) => {
      callbacks.onText(reply); callbacks.onComplete?.();
    }) });
    const request = { type: 'reading-focus:page-prepare', snapshot, mode: 'expressions' };
    const first = await ask(f.runtime, request);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'failed' } });
    await ask(f.runtime, request);
    expect(f.remote.createConversation).toHaveBeenCalledTimes(1);
    reply = JSON.stringify({ expressions: [] });
    const retried = await ask(f.runtime, { ...request, retry: true });
    expect(await status(f.runtime, retried.task.id)).toMatchObject({ task: { status: 'ready',
      result: { expressions: [], invalidCount: 0, readyCount: snapshot.paragraphs.length } } });
    await ask(f.runtime, { ...request, retry: true });
    expect(f.remote.createConversation).toHaveBeenCalledTimes(2);
  });
  it('runs groups and expressions independently once and rejects unknown modes before creating conversations', async () => {
    const f = setup({}, { executeStream: vi.fn(async (_id, request, callbacks) => {
      callbacks.onText(request.content.includes('Extract valuable reusable expressions')
        ? JSON.stringify({ expressions: [{ text: 'Use a script', category: 'pattern', meaning: '使用脚本',
          occurrences: [{ paragraphId: 'p0', text: 'Use a script' }] }] }) : output);
      callbacks.onComplete?.();
    }) });
    const groups = await ask(f.runtime);
    const expressions = await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, mode: 'expressions' });
    expect(groups.task.id).not.toBe(expressions.task.id);
    expect(await status(f.runtime, expressions.task.id)).toMatchObject({ task: { mode: 'expressions', status: 'ready',
      result: { expressions: [{ text: 'Use a script' }], paragraphs: [] } } });
    await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, mode: 'expressions' });
    expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, mode: 'invalid' })).toMatchObject({ ok: false });
    expect(f.remote.createConversation).toHaveBeenCalledTimes(2);
    expect(f.remote.executeStream).toHaveBeenCalledTimes(2);
  });
  it('claims once across concurrent starts/tabs, sends one whole article and exposes no connection secrets', async () => {
    const f = setup();
    const prepared = await Promise.all(Array.from({ length: 12 }, (_, i) => ask(f.runtime, undefined,
      { ...sender, tab: { id: i }, documentId: `doc${i}` })));
    expect(prepared.every((value) => value.ok && value.task.id === prepared[0].task.id)).toBe(true);
    await tick();
    expect(f.remote.createConversation).toHaveBeenCalledTimes(1);
    expect(f.remote.executeStream).toHaveBeenCalledTimes(1);
    const request = vi.mocked(f.remote.executeStream).mock.calls[0]![1];
    expect(request.content).toContain(snapshot.paragraphs[0]!.text);
    expect(request.content).toContain(snapshot.paragraphs[1]!.text);
    expect(request.content).not.toContain(snapshot.url);
    expect(request).not.toHaveProperty('attachments');
    expect(JSON.stringify(prepared)).not.toContain('secret');
    expect(JSON.stringify([...f.records.values()])).not.toContain('secret');
    expect(f.remote.abortConversation).not.toHaveBeenCalled();
  });

  it('reuses persisted completed results after runtime restart without new sessions', async () => {
    const f = setup();
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready', readyCount: 2 } });
    f.runtime.dispose();
    const next = setup({ repository: f.repository });
    expect(await ask(next.runtime)).toMatchObject({ task: { status: 'ready' } });
    expect(next.remote.createConversation).not.toHaveBeenCalled();
  });

  it('reads a cached result after credentials are removed, but requires credentials for a new article', async () => {
    const f = setup();
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready' } });
    f.runtime.dispose();
    const next = setup({ repository: f.repository, loadConnection: async () => ({ ...connection,
      internalV2: { accessToken: '', userUuid: '', organizationUuid: '' },
    }) });
    expect(await ask(next.runtime)).toMatchObject({ task: { status: 'ready', id: first.task.id } });
    const changed = { ...snapshot, paragraphs: [{ id: 'changed', text: 'A different article needs a new analysis.' }] };
    expect(await ask(next.runtime, { type: 'reading-focus:page-prepare', snapshot: changed })).toMatchObject({ ok: false });
    expect(next.remote.createConversation).not.toHaveBeenCalled();
    expect(next.createTransport).not.toHaveBeenCalled();
  });

  it('returns immediately while preparing, permits reentry, and never subscribes to page lifetime', async () => {
    let finish: () => void = () => undefined;
    const f = setup({}, { executeStream: vi.fn((_id, _request, callbacks) => new Promise<void>((resolve) => {
      finish = () => { callbacks.onText(output); callbacks.onComplete?.(); resolve(); };
    })) });
    const first = await ask(f.runtime);
    await tick();
    expect((await ask(f.runtime)).task.id).toBe(first.task.id);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'analyzing' } });
    expect(f.remote.createConversation).toHaveBeenCalledTimes(1);
    finish();
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready' } });
    expect(f.remote.abortConversation).not.toHaveBeenCalled();
  });

  it('limits unrelated active articles to two; pointer movement cannot bypass dedup', async () => {
    const f = setup({}, { executeStream: vi.fn(() => new Promise<void>(() => undefined)) });
    const first = await ask(f.runtime); await tick();
    const secondSnapshot = { ...snapshot, paragraphs: [{ id: 'other', text: 'Different article content.' }] };
    expect((await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: secondSnapshot })).ok).toBe(true);
    const third = { ...snapshot, paragraphs: [{ id: 'third', text: 'A third article version.' }] };
    expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: third })).toMatchObject({ ok: false });
    expect((await ask(f.runtime)).task.id).toBe(first.task.id);
    expect(f.remote.createConversation).toHaveBeenCalledTimes(2);
  });

  it.each([{ ...sender, id: 'wrong' }, { ...sender, frameId: 1 }, { ...sender, tab: undefined },
    { ...sender, url: 'file:///secret' }, { ...sender, frameId: undefined }])('rejects untrusted sender %# before config access', async (from) => {
    const f = setup(); expect(await ask(f.runtime, undefined, from)).toMatchObject({ ok: false });
    expect(f.loadConnection).not.toHaveBeenCalled();
  });

  it('refuses cross-URL snapshots and task access, and requires a per-document prepare', async () => {
    const f = setup();
    expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: { ...snapshot, url: 'https://other.com/' } })).toMatchObject({ ok: false });
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id, { ...sender, url: 'https://other.com/' })).toMatchObject({ ok: false });
    expect(await status(f.runtime, first.task.id, { ...sender, documentId: 'new-doc' })).toMatchObject({ ok: false });
    expect((await ask(f.runtime, undefined, { ...sender, documentId: 'new-doc' })).task.id).toBe(first.task.id);
    expect((await status(f.runtime, first.task.id, { ...sender, documentId: 'new-doc' })).ok).toBe(true);
  });

  it('uses the browser-provided current top-frame URL after same-document navigation', async () => {
    const f = setup();
    const principles = { ...snapshot, url: 'https://openrouter.ai/docs/guides/overview/principles' };
    const models = { ...snapshot, url: 'https://openrouter.ai/docs/guides/overview/models' };
    const originalSender = { ...sender, url: principles.url, tab: { id: 3, url: principles.url } };
    // Chrome retains the script context's original sender.url after pushState.
    const modelsSender = { ...originalSender, tab: { id: 3, url: models.url } };
    const first = await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: principles }, originalSender);
    expect(first.ok).toBe(true);
    await status(f.runtime, first.task.id, originalSender);
    const next = await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: models }, modelsSender);
    expect(next, 'opening Models after Principles must not report a URL mismatch').toMatchObject({ ok: true });
    expect(next.task.id).not.toBe(first.task.id);
    expect(await status(f.runtime, next.task.id, modelsSender)).toMatchObject({ task: { status: 'ready' } });
    expect(await status(f.runtime, first.task.id, modelsSender)).toMatchObject({ ok: false });
    expect(await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id }, modelsSender)).toMatchObject({ ok: false });
    expect(await status(f.runtime, next.task.id, { ...modelsSender, documentId: 'replacement-doc' })).toMatchObject({ ok: false });
    expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: principles }, originalSender))
      .toMatchObject({ ok: true, task: { id: first.task.id } });
    expect(f.remote.createConversation).toHaveBeenCalledTimes(2);
  });

  it.each(['https://other.example/article', 'chrome://settings/', 'not a URL'])
    ('rejects an inconsistent browser tab URL before reading credentials: %s', async (url) => {
      const f = setup();
      const from = { ...sender, tab: { id: 3, url } };
      expect(await ask(f.runtime, undefined, from)).toMatchObject({ ok: false });
      expect(f.loadConnection).not.toHaveBeenCalled();
      expect(f.remote.createConversation).not.toHaveBeenCalled();
    });

  it('does not accept the old route snapshot when the browser is showing a new route', async () => {
    const f = setup();
    const from = { ...sender, tab: { id: 3, url: 'https://example.com/other-route' } };
    expect(await ask(f.runtime, undefined, from)).toMatchObject({ ok: false, error: '文章地址与当前网页不一致。' });
    expect(f.loadConnection).not.toHaveBeenCalled();
    expect(f.remote.createConversation).not.toHaveBeenCalled();
  });

  it('normalizes ordinary anchors on the current tab URL and preserves hash-based routes', async () => {
    const f = setup();
    const anchored = { ...sender, tab: { id: 3, url: `${snapshot.url}#section` } };
    const first = await ask(f.runtime, undefined, anchored);
    expect(first.ok).toBe(true);
    expect(await status(f.runtime, first.task.id, anchored)).toMatchObject({ task: { status: 'ready' } });
    const routed = { ...snapshot, url: `${snapshot.url}#/models` };
    const hashSender = { ...sender, tab: { id: 3, url: routed.url } };
    const next = await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: routed }, hashSender);
    expect(next.ok).toBe(true);
    expect(next.task.id).not.toBe(first.task.id);
    expect(await status(f.runtime, first.task.id, hashSender)).toMatchObject({ ok: false });
  });

  it('refuses missing/broken settings and storage failure before creating a remote session', async () => {
    const f = setup();
    f.loadConnection.mockRejectedValueOnce(new Error('broken'));
    expect(await ask(f.runtime)).toMatchObject({ ok: false });
    f.loadConnection.mockResolvedValueOnce({ ...connection, agentUuid: '' });
    expect(await ask(f.runtime)).toMatchObject({ ok: false });
    f.repository.claim.mockRejectedValueOnce(new Error('disk'));
    expect(await ask(f.runtime)).toMatchObject({ ok: false, error: expect.stringContaining('存储') });
    expect(f.remote.createConversation).not.toHaveBeenCalled();
  });

  it('never submits when persisting a newly created session identifier fails', async () => {
    const f = setup();
    f.repository.put.mockImplementation(async (task) => {
      if (task.remoteUuid) throw new Error('disk');
      f.records.set(task.id, structuredClone(task));
    });
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'unknown', message: expect.stringContaining('保存') } });
    expect(f.remote.executeStream).not.toHaveBeenCalled();
    expect(await ask(f.runtime)).toMatchObject({ ok: false });
  });

  it('does not publish ready when persisting the final cache fails', async () => {
    const f = setup();
    f.repository.put.mockImplementation(async (task) => {
      if (task.status === 'ready') throw new Error('disk');
      f.records.set(task.id, structuredClone(task));
    });
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'unknown' } });
    expect((await status(f.runtime, first.task.id)).task.result).toBeUndefined();
    expect(f.records.get(first.task.id)?.status).toBe('checking');
  });

  it('does not parse partial output without a terminal event; unknown never retries', async () => {
    const f = setup({}, { executeStream: vi.fn(async (_id, _request, callbacks) => { callbacks.onText(output); }) });
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'unknown' } });
    expect((await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true })).task.status).toBe('unknown');
    expect(f.remote.executeStream).toHaveBeenCalledTimes(1);
  });

  it('records run identity from progress disconnect and blocks resubmission', async () => {
    const f = setup({}, { executeStream: vi.fn(async () => { throw new WorkosProgressDisconnected('remote-session', 'run-42'); }) });
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'unknown' } });
    expect(f.records.get(first.task.id)).toMatchObject({ remoteUuid: 'remote-session', runId: 'run-42' });
    expect(JSON.stringify(await status(f.runtime, first.task.id))).not.toContain('run-42');
  });

  it('recovers every unfinished stage as unknown before accepting starts', async () => {
    const f = setup({}, { executeStream: vi.fn(() => new Promise<void>(() => undefined)) });
    const first = await ask(f.runtime); await tick();
    f.runtime.dispose(); await tick();
    // Simulate abrupt worker death before it could persist its disconnect outcome.
    f.records.set(first.task.id, { ...f.records.get(first.task.id)!, status: 'analyzing' });
    const next = setup({ repository: f.repository });
    expect(await ask(next.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true })).toMatchObject({ task: { status: 'unknown' } });
    expect(next.remote.createConversation).not.toHaveBeenCalled();
  });

  it.each(['analyzing', 'unknown'] as const)('authorizes the prior version task returned by claim after restoring %s', async (priorStatus) => {
    const database = new YemaiDatabase(`runtime-version-upgrade-${crypto.randomUUID()}`);
    const repository = new PageReadingRepository(database);
    const prior: PageReadingTask = {
      id: 'page-reading:prior-version', snapshot: { ...snapshot, url: `${snapshot.url}#old-heading` },
      target: `internal-v2:${connection.agentUuid}:${WORKOS_INTERNAL_V2_BASE_URL}`,
      status: priorStatus, remoteUuid: 'old-remote', runId: 'old-run', createdAt: 1, updatedAt: 1,
    };
    await repository.put(prior);
    const f = setup({ repository });
    try {
      const prepared = await ask(f.runtime);
      expect(prepared).toMatchObject({ ok: true, task: { id: prior.id, status: 'unknown' } });
      expect(await status(f.runtime, prior.id)).toMatchObject({ ok: true, task: { id: prior.id, status: 'unknown' } });
      expect(await ask(f.runtime, { type: 'reading-focus:page-stop', id: prior.id })).toMatchObject({
        ok: false, error: expect.stringContaining('远端任务状态未确认'),
      });
      expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true })).toMatchObject({
        ok: true, task: { id: prior.id, status: 'unknown' },
      });
      expect(f.remote.createConversation).not.toHaveBeenCalled();
      expect(f.remote.executeStream).not.toHaveBeenCalled();
      expect(f.remote.abortConversation).not.toHaveBeenCalled();
      expect((await database.meta.toArray()).map(({ key }) => key)).toEqual([`pageReadingTask:${prior.id}`]);
    } finally {
      f.runtime.dispose();
      await database.delete();
    }
  });

  it('only retries definite failures explicitly and caches partially valid paragraphs', async () => {
    const remote = { executeStream: vi.fn(async (_id: string, _req: unknown, callbacks: WorkosSseCallbacks) => {
      callbacks.onText('{"paragraphs":[]}'); callbacks.onComplete?.();
    }) };
    const f = setup({}, remote);
    const first = await ask(f.runtime);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'failed' } });
    expect((await ask(f.runtime)).task.status).toBe('failed');
    expect(f.remote.executeStream).toHaveBeenCalledTimes(1);
    vi.mocked(f.remote.executeStream).mockImplementationOnce(async (_id, _req, callbacks) => {
      callbacks.onText('{"paragraphs":[{"id":"p0","groups":[]}]}'); callbacks.onComplete?.();
    });
    await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true });
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready', readyCount: 1, invalidCount: 1 } });
  });

  it('records a finite deadline without converting partial JSON to a completed cache', async () => {
    vi.useFakeTimers();
    const f = setup({}, { executeStream: vi.fn(async (_id, _request, callbacks) => {
      callbacks.onText(output); await new Promise<void>(() => undefined);
    }) });
    const first = await ask(f.runtime); await tick();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'unknown', message: expect.stringContaining('耗时较长') } });
    expect((await status(f.runtime, first.task.id)).task.result).toBeUndefined();
    expect((await ask(f.runtime)).task.status).toBe('unknown');
  });

  it('internal stop calls the endpoint once and reports acceptance as unknown rather than stopped', async () => {
    const f = setup({}, { executeStream: vi.fn(() => new Promise<void>(() => undefined)) });
    const first = await ask(f.runtime); await tick();
    const stopped = await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id });
    expect(stopped).toMatchObject({ task: { status: 'unknown', message: expect.stringContaining('接受') } });
    expect(f.remote.abortConversation).toHaveBeenCalledTimes(1);
    expect(await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true })).toMatchObject({ task: { status: 'unknown' } });
  });

  it('reports a rejected remote stop as unknown and does not automatically submit again', async () => {
    const f = setup({}, {
      executeStream: vi.fn(() => new Promise<void>(() => undefined)),
      abortConversation: vi.fn(async () => { throw new Error('sensitive remote error'); }),
    });
    const first = await ask(f.runtime); await tick();
    const stopped = await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id });
    expect(stopped).toMatchObject({ task: { status: 'unknown', message: expect.stringContaining('未获确认') } });
    expect(JSON.stringify(stopped)).not.toContain('sensitive');
    expect((await ask(f.runtime)).task.status).toBe('unknown');
    expect(f.remote.executeStream).toHaveBeenCalledTimes(1);
  });

  it('stops before submission even if a slow create ignores AbortSignal and resolves later', async () => {
    let created: (id: string) => void = () => undefined;
    const f = setup({}, { createConversation: vi.fn(() => new Promise<string>((resolve) => { created = resolve; })) });
    const first = await ask(f.runtime); await tick();
    expect(await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id })).toMatchObject({ task: { status: 'stopped' } });
    created('late-empty-session'); await tick();
    expect(f.remote.executeStream).not.toHaveBeenCalled();
    expect(f.records.get(first.task.id)).toMatchObject({ status: 'stopped' });
    expect(f.records.get(first.task.id)?.remoteUuid).toBeUndefined();
  });

  it('blocks submission immediately when stop arrives during the pending analyzing stage write', async () => {
    const f = setup();
    let releaseAnalyzing: () => void = () => undefined;
    let releaseStopped: () => void = () => undefined;
    const analyzingWrite = new Promise<void>((resolve) => { releaseAnalyzing = resolve; });
    const stoppedWrite = new Promise<void>((resolve) => { releaseStopped = resolve; });
    let analyzingPending = false;
    let stoppedPending = false;
    f.repository.put.mockImplementation(async (task) => {
      if (task.status === 'analyzing') { analyzingPending = true; await analyzingWrite; }
      if (task.status === 'stopped') { stoppedPending = true; await stoppedWrite; }
      f.records.set(task.id, structuredClone(task));
    });
    const first = await ask(f.runtime); await tick();
    expect(analyzingPending).toBe(true);
    const stopping = ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id });
    await tick();
    releaseAnalyzing(); await tick();
    expect(stoppedPending).toBe(true);
    // The stop write is deliberately still pending. Submission must already be
    // prevented; it cannot depend on persisting the UI's stopped state first.
    expect(f.remote.executeStream).not.toHaveBeenCalled();
    releaseStopped();
    expect(await stopping).toMatchObject({ task: { status: 'stopped' } });
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'stopped' } });
    expect(f.remote.abortConversation).not.toHaveBeenCalled();
  });

  it('does not let a late stopped attempt overwrite an explicitly retried task with the same article key', async () => {
    let oldCreated: (id: string) => void = () => undefined;
    const f = setup();
    vi.mocked(f.remote.createConversation).mockImplementationOnce(() => new Promise<string>((resolve) => { oldCreated = resolve; }));
    const first = await ask(f.runtime); await tick();
    await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id });
    await tick();
    await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot, retry: true });
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready' } });
    oldCreated('old-unused-session'); await tick();
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready' } });
    expect(f.records.get(first.task.id)?.remoteUuid).toBe('remote-session');
    expect(f.remote.executeStream).toHaveBeenCalledTimes(1);
  });

  it.each(['ready', 'failed', 'stopped'] as const)('does not retain pruned %s history in memory after more than 20 articles', async (outcome) => {
    const f = setup({}, outcome === 'stopped'
      ? { createConversation: vi.fn(() => new Promise<string>(() => undefined)) }
      : outcome === 'failed' ? { executeStream: vi.fn(async (_id, _req, callbacks) => {
        callbacks.onText('malformed output'); callbacks.onComplete?.();
      }) } : {});
    const finishTask = async (id: string) => {
      await tick();
      if (outcome === 'stopped') await ask(f.runtime, { type: 'reading-focus:page-stop', id });
      expect(await status(f.runtime, id)).toMatchObject({ task: { status: outcome } });
    };
    f.repository.prune.mockImplementation(async () => {
      const completed = [...f.records.values()].filter((task) => ['ready', 'failed', 'stopped'].includes(task.status));
      for (const task of completed.slice(0, Math.max(0, completed.length - 20))) f.records.delete(task.id);
    });
    const first = await ask(f.runtime);
    await finishTask(first.task.id);
    for (let index = 1; index < 25; index++) {
      const nextSnapshot = { ...snapshot, paragraphs: [
        { id: 'p0', text: `Read article number ${index} before continuing.` }, snapshot.paragraphs[1]!,
      ] };
      const prepared = await ask(f.runtime, { type: 'reading-focus:page-prepare', snapshot: nextSnapshot });
      await finishTask(prepared.task.id);
    }
    expect(f.records.size).toBe(20);
    expect(f.records.has(first.task.id)).toBe(false);
    expect(f.remote.createConversation).toHaveBeenCalledTimes(25);
    const restarted = await ask(f.runtime);
    await finishTask(restarted.task.id);
    expect(f.remote.createConversation).toHaveBeenCalledTimes(26);
  });

  it('public stop keeps receiving the same run and caches its eventual complete result', async () => {
    let finish = () => undefined;
    const f = setup({ loadConnection: async () => ({ ...connection, transport: 'public-v1', publicApiToken: 'AP_secret' }) }, {
      kind: 'public-v1', abortConversation: undefined,
      executeStream: vi.fn((_id, _req, callbacks) => new Promise<void>((resolve) => {
        finish = () => { callbacks.onText(output); callbacks.onComplete?.(); resolve(); };
      })),
    });
    const first = await ask(f.runtime); await tick();
    expect(await ask(f.runtime, { type: 'reading-focus:page-stop', id: first.task.id })).toMatchObject({ task: { status: 'stopping', message: expect.stringContaining('不支持') } });
    expect((await ask(f.runtime)).task.id).toBe(first.task.id);
    finish();
    expect(await status(f.runtime, first.task.id)).toMatchObject({ task: { status: 'ready' } });
    expect(f.remote.createConversation).toHaveBeenCalledTimes(1);
  });

  it.each(['tool', 'interrupt', 'artifact'])('stops explicit %s output and never accepts its JSON as a valid result', async (kind) => {
    const f = setup({}, { executeStream: vi.fn(async (_id, _req, callbacks) => {
      if (kind === 'tool') callbacks.onActivity?.({ id: 't', title: 'browser', status: 'running' });
      else if (kind === 'interrupt') callbacks.onInterrupt?.({ id: 'q', sessionId: 's', title: 'Question', fields: [] });
      else callbacks.onArtifact?.({ id: 'a', kind: 'html', filename: 'x.html', status: 'available' });
      callbacks.onText(output); callbacks.onComplete?.();
    }) });
    const first = await ask(f.runtime);
    const result = await status(f.runtime, first.task.id);
    expect(result.task.status).toBe('failed');
    expect(result.task.result).toBeUndefined();
  });

  it('keeps the worker alive only while tasks are running', async () => {
    vi.useFakeTimers();
    let finish = () => undefined;
    const f = setup({ timeoutMs: 100_000 }, { executeStream: vi.fn((_id, _req, callbacks) => new Promise<void>((resolve) => {
      finish = () => { callbacks.onText(output); callbacks.onComplete?.(); resolve(); };
    })) });
    expect(f.keepAlive).not.toHaveBeenCalled();
    await ask(f.runtime); await tick();
    expect(f.keepAlive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(f.keepAlive).toHaveBeenCalledTimes(2);
    finish(); await tick();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(f.keepAlive).toHaveBeenCalledTimes(2);
  });
});
