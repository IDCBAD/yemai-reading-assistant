import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskRuntime } from './taskRuntime';
import { InternalV2Transport } from '../services/workosInternalV2';
import { WORKOS_INTERNAL_V2_BASE_URL } from '../services/workosTransport';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { BackgroundTaskEvent } from './taskEvents';

const agentUuid = '11111111-1111-4111-8111-111111111111';
vi.mock('../services/workosIdentityEncryption', () => ({ encryptWorkosIdentity: (value: string) => `synthetic-${value}` }));
vi.mock('./createTransport', () => ({ createBackgroundTransport: () => new InternalV2Transport({
  accessToken: 'synthetic-token', userUuid: 'user-1', organizationUuid: 'org-1',
}, '11111111-1111-4111-8111-111111111111') }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('WorkOS terminal status to background task notification', () => {
  it.each([
    ['run_succeeded', 'complete'],
    ['run_failed', 'failed'],
  ] as const)('records %s as %s after the viewer closes', async (terminalStatus, expectedKind) => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => input.includes('/subscribe')
      ? new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ success: true, data: { runId: 'run-1' } }), { headers: { 'Content-Type': 'application/json' } })));
    const state = structuredClone(INITIAL_WORKSPACE);
    const conversation = state.conversations[0]!;
    conversation.id = 'c1'; conversation.remoteUuid = 'remote-1'; conversation.remoteTransport = 'internal-v2';
    conversation.remoteAgentUuid = agentUuid; conversation.remoteApiBase = WORKOS_INTERNAL_V2_BASE_URL;
    const question = { id: 'question', role: 'user' as const, content: '仅回复通知验证完成', createdAt: 1, status: 'complete' as const };
    conversation.messages = [question, { id: 'answer', role: 'assistant', content: '', createdAt: 2, status: 'queued' }];
    const events: BackgroundTaskEvent[] = [];
    const runtime = new BackgroundTaskRuntime({
      load: async () => state, save: async () => undefined,
      connection: async () => ({ schemaVersion: 2, agentUuid, transport: 'internal-v2', publicApiToken: '',
        internalV2: { accessToken: 'synthetic-token', userUuid: 'user-1', organizationUuid: 'org-1' } }),
      preparePage: async () => ({}), keepAlive: async () => undefined,
      recordEvents: async (next) => { events.push(...next); },
    });
    const closeViewer = await runtime.subscribe(() => undefined);
    await runtime.handle({ type: 'executor:command', clientId: 'viewer', epoch: runtime.snapshot().epoch, sequence: 1,
      command: { kind: 'submit', request: { conversationId: 'c1', messageId: 'answer', userMessage: question, needsPageRead: false } } });
    await vi.advanceTimersByTimeAsync(0);
    closeViewer();
    const event = (type: string, properties: object) => `event: message\ndata: ${JSON.stringify({
      runId: 'run-1', data: JSON.stringify({ type, properties }),
    })}\n\n`;
    streamController.enqueue(new TextEncoder().encode(
      event('message.part.updated', { part: { id: 'part', type: 'text', text: '通知验证完成' } })
      + event('run.terminal', { sessionID: 'session-1', messageID: 'message-1', status: terminalStatus, runId: 'run-1' })
      + `event: xybot-stream-complete\ndata: ${JSON.stringify({ runId: 'run-1' })}\n\n`,
    ));
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.snapshot().workspace.conversations[0]!.messages[1]).toMatchObject({ status: expectedKind, content: '通知验证完成' });
    expect(events.map((entry) => entry.kind)).toEqual([expectedKind]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
