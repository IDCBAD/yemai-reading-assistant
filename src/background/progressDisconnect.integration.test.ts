import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskRuntime } from './taskRuntime';
import { InternalV2Transport } from '../services/workosInternalV2';
import { WORKOS_INTERNAL_V2_BASE_URL } from '../services/workosTransport';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { ExecutorCommand } from '../shared/backgroundTasks';
import type { BackgroundTaskEvent } from './taskEvents';

vi.mock('../services/workosIdentityEncryption', () => ({ encryptWorkosIdentity: (v: string) => `synthetic-${v}` }));
vi.mock('./createTransport', () => ({ createBackgroundTransport: () => new InternalV2Transport({
  accessToken: 'synthetic-token', userUuid: 'user-1', organizationUuid: 'org-1',
}, '11111111-1111-4111-8111-111111111111') }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('accepted WorkOS run with a disconnected progress stream', () => {
  it('keeps the partial answer after the viewer closes and never starts queued work or emits a failure', async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetchMock = vi.fn(async (input: string) => input.includes('/subscribe')
      ? new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ success: true, data: { runId: 'run-1' } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const state = structuredClone(INITIAL_WORKSPACE);
    const c = state.conversations[0]!;
    c.id = 'c1'; c.remoteUuid = 'remote-1'; c.remoteTransport = 'internal-v2'; c.remoteAgentUuid = '11111111-1111-4111-8111-111111111111'; c.remoteApiBase = WORKOS_INTERNAL_V2_BASE_URL;
    c.messages = [1, 2].flatMap((i) => [
      { id: `u${i}`, role: 'user' as const, content: `question ${i}`, createdAt: 1, status: 'complete' as const },
      { id: `a${i}`, role: 'assistant' as const, content: '', createdAt: 2, status: 'queued' as const },
    ]);
    const events: BackgroundTaskEvent[] = [];
    let saved = structuredClone(state);
    const runtime = new BackgroundTaskRuntime({
      load: async () => state, save: async (s) => { saved = structuredClone(s); },
      connection: async () => ({ schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '',
        internalV2: { accessToken: 'synthetic-token', userUuid: 'user-1', organizationUuid: 'org-1' } }),
      preparePage: async () => ({}), keepAlive: async () => undefined,
      recordEvents: async (next) => { events.push(...next); },
    });
    const closeViewer = await runtime.subscribe(() => undefined);
    let sequence = 0;
    const command = (command: ExecutorCommand) => runtime.handle({ type: 'executor:command', clientId: 'viewer',
      epoch: runtime.snapshot().epoch, sequence: ++sequence, command });
    const request = (i: number) => ({ conversationId: 'c1', messageId: `a${i}`, userMessage: c.messages[(i - 1) * 2]!, needsPageRead: false });
    expect((await command({ kind: 'submit', request: request(1) })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/queue/submit'))).toHaveLength(1);
    expect((await command({ kind: 'submit', request: request(2) })).ok).toBe(true);
    closeViewer();
    streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ runId: 'run-1', type: 'message.part.updated', properties: { part: { id: 'text-1', type: 'text', text: '已经接收的部分回答' } } })}\n\n`));
    await vi.advanceTimersByTimeAsync(300);
    expect(saved.conversations[0]!.messages[1]!.content).toBe('已经接收的部分回答');
    streamController.error(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(300);
    const answer = saved.conversations[0]!.messages[1]!;
    expect(answer).toMatchObject({ status: 'stopped', content: '已经接收的部分回答', remoteRunUnconfirmed: { runId: 'run-1' } });
    expect(saved.conversations[0]!.messages[3]).toMatchObject({ status: 'stopped', errorMessage: expect.stringContaining('未发送') });
    expect(events.map((e) => e.kind)).toEqual(['connection-lost']);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/queue/submit'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/abort'))).toBe(false);
    expect((await command({ kind: 'submit', request: request(2) })).ok).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
