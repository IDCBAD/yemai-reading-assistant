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

describe('WorkOS form events with the viewer closed', () => {
  it.each(['text', 'input'])('stores %s forms, notifies each new request once and resumes the original stream', async (textType) => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetchMock = vi.fn(async (input: string) => input.includes('/subscribe')
      ? new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ success: true, data: input.includes('/submit') ? { runId: 'run-1' } : {} }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const state = structuredClone(INITIAL_WORKSPACE);
    const conversation = state.conversations[0]!;
    Object.assign(conversation, { id: 'c1', remoteUuid: 'remote-1', remoteTransport: 'internal-v2', remoteAgentUuid: agentUuid, remoteApiBase: WORKOS_INTERNAL_V2_BASE_URL });
    const question = { id: 'question', role: 'user' as const, content: '显示一个简单表单', createdAt: 1, status: 'complete' as const };
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
    const command = (sequence: number, value: Parameters<typeof runtime.handle>[0]['command']) => runtime.handle({
      type: 'executor:command', clientId: 'viewer', epoch: runtime.snapshot().epoch, sequence, command: value,
    });
    await command(1, { kind: 'submit', request: { conversationId: 'c1', messageId: 'answer', userMessage: question, needsPageRead: false } });
    await vi.advanceTimersByTimeAsync(0);
    closeViewer();
    const emit = (type: string, properties: object) => streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
      runId: 'run-1', data: JSON.stringify({ type, properties }),
    })}\n\n`));
    const form = (id: string) => ({ id, sessionID: 'session-1', type: 'a2ui', payload: {
      title: '简单确认', fields: [{ type: textType, label: '补充需求', default: '' }],
    }, tool: { messageID: 'message-1', callID: 'call-1' } });
    const answer = () => runtime.snapshot().workspace.conversations[0]!.messages[1]!;
    emit('interrupt', form('form-1'));
    await vi.advanceTimersByTimeAsync(300);
    expect(answer()).toMatchObject({ status: 'streaming', stage: 'waiting-user-input', interactions: [{ id: 'form-1', status: 'pending' }] });
    expect(events.map((entry) => entry.kind)).toEqual(['waiting-user-input']);
    // Repeated snapshots are not another request for attention.
    emit('interrupt', form('form-1'));
    await vi.advanceTimersByTimeAsync(300);
    expect(events).toHaveLength(1);
    // A second request needs its own reminder even without an intervening stage update.
    emit('interrupt', form('form-2'));
    await vi.advanceTimersByTimeAsync(300);
    expect(events.map((entry) => entry.kind)).toEqual(['waiting-user-input', 'waiting-user-input']);
    expect(new Set(events.map((entry) => entry.id)).size).toBe(2);
    await command(2, { kind: 'decision', conversationId: 'c1', messageId: 'answer', decisionId: 'form-2', action: 'reply', answers: { 补充需求: '测试回答' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledWith(`${WORKOS_INTERNAL_V2_BASE_URL}/conversations/remote-1/interrupt/form-2/reply`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ 补充需求: '测试回答' }),
    }));
    emit('interrupt.replied', { requestID: 'form-2', sessionID: 'session-1', data: { 补充需求: '测试回答' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(answer().stage).toBe('streaming');
    expect(answer().interactions?.at(-1)).toMatchObject({ status: 'replied', answers: { 补充需求: '测试回答' } });
    emit('message.part.updated', { part: { id: 'text', type: 'text', text: '已确认' } });
    emit('run.terminal', { status: 'run_succeeded' });
    streamController.enqueue(new TextEncoder().encode('event: xybot-stream-complete\ndata: {"runId":"run-1"}\n\n'));
    await vi.advanceTimersByTimeAsync(300);
    expect(events.map((entry) => entry.kind)).toEqual(['waiting-user-input', 'waiting-user-input', 'complete']);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/submit'))).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
