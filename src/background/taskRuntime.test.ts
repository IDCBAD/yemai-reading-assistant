import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskRuntime, MAX_BACKGROUND_RUN_MS, type RuntimeDependencies } from './taskRuntime';
import type { AgentRequestHost, SerializableAgentRequest } from './runAgentRequest';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { ChatMessage, WorkspaceState } from '../sidepanel/types';
import type { ExecutorCommand, ExecutorRequest } from '../shared/backgroundTasks';
import { workspaceDelta } from './workspaceDelta';
import { WORKOS_INTERNAL_V2_BASE_URL, WORKOS_USER_STOP_REASON } from '../services/workosTransport';
import { settleAgentInteraction } from '../sidepanel/agentDecision';

const decisionTransport = vi.hoisted(() => ({
  replyInterrupt: vi.fn(async (_conversation: string, _request: string, _answers: Record<string, string | string[]>, _signal?: AbortSignal) => undefined),
}));
vi.mock('./createTransport', () => ({ createBackgroundTransport: () => decisionTransport }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function workspace(messageCount = 1): WorkspaceState {
  const state = structuredClone(INITIAL_WORKSPACE);
  state.conversations[0]!.id = 'conversation-1';
  state.conversations[0]!.messages = Array.from({ length: messageCount }, (_, index) => [
    { id: `user-${index + 1}`, role: 'user', content: `question ${index + 1}`, createdAt: 1, status: 'complete' },
    { id: `answer-${index + 1}`, role: 'assistant', content: '', createdAt: 2, status: 'queued' },
  ] satisfies ChatMessage[]).flat();
  state.openTabs = [{ id: 'tab-1', conversationId: 'conversation-1', openedAt: 1 }];
  state.activeOpenTabId = 'tab-1';
  return state;
}

function request(index = 1): SerializableAgentRequest {
  return { conversationId: 'conversation-1', messageId: `answer-${index}`, needsPageRead: false,
    userMessage: { id: `user-${index}`, role: 'user', content: `question ${index}`, createdAt: 1, status: 'complete' } };
}

function fixture(runner: NonNullable<RuntimeDependencies['run']>, initial = workspace(), extra: Partial<RuntimeDependencies> = {}) {
  let stored = structuredClone(initial);
  const save = vi.fn(async (state: WorkspaceState) => { stored = structuredClone(state); });
  const load = vi.fn(async () => structuredClone(stored));
  const run = vi.fn(runner);
  const keepAlive = vi.fn(async () => undefined);
  const preparePage = vi.fn(async (_request: SerializableAgentRequest, _signal: AbortSignal) => ({ error: 'test page unavailable' }));
  const connection = vi.fn(async () => ({ schemaVersion: 2 as const, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2' as const,
    publicApiToken: '', internalV2: { accessToken: 'synthetic-token', userUuid: 'user-1', organizationUuid: 'org-1' } }));
  const runtime = new BackgroundTaskRuntime({ load, save, run, keepAlive, preparePage, connection, ...extra });
  let sequence = 0;
  const command = (command: ExecutorCommand) => runtime.handle({ type: 'executor:command', clientId: 'client-1',
    epoch: runtime.snapshot().epoch, sequence: ++sequence, command });
  return { runtime, run, save, load, keepAlive, preparePage, connection, command, stored: () => stored };
}

function updateAnswer(host: AgentRequestHost, messageId: string, content: string, status: ChatMessage['status']) {
  host.updateConversation('conversation-1', (conversation) => ({ ...conversation, messages: conversation.messages.map((message) =>
    message.id === messageId ? { ...message, content, status } : message) }));
}

beforeEach(() => { vi.useFakeTimers(); decisionTransport.replyInterrupt.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('BackgroundTaskRuntime', () => {
  it('serializes knowledge writes with maintenance and recovers the queue after a rejected write', async () => {
    const f = fixture(async () => undefined);
    const entered = deferred<void>();
    const release = deferred<void>();
    const first = f.runtime.runKnowledgeWrite(async () => { entered.resolve(); await release.promise; return 'saved'; });
    await entered.promise;
    let maintenanceStarted = false;
    const maintenance = f.command({ kind: 'maintenance-start' }).then((result) => { maintenanceStarted = true; return result; });
    await Promise.resolve();
    expect(maintenanceStarted).toBe(false);
    release.resolve();
    expect(await first).toBe('saved');
    expect(await maintenance).toMatchObject({ ok: true });
    const write = vi.fn(async () => 'not saved');
    await expect(f.runtime.runKnowledgeWrite(write)).rejects.toThrow('导入本地备份');
    expect(write).not.toHaveBeenCalled();
    expect(await f.command({ kind: 'maintenance-end' })).toMatchObject({ ok: true });
    expect(await f.runtime.runKnowledgeWrite(async () => 'after import')).toBe('after import');
  });
  it.each(['connection', 'save'] as const)('rejects a question when the previous stream disconnects during awaited %s', async (phase) => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise, workspace(2));
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    const pending = deferred<void>();
    const entered = deferred<void>();
    if (phase === 'connection') {
      const settings = await f.connection();
      f.connection.mockImplementationOnce(async () => { entered.resolve(); await pending.promise; return settings; });
    } else f.save.mockImplementationOnce(async () => { entered.resolve(); await pending.promise; });
    const submitting = f.command({ kind: 'submit', request: request(2) });
    await entered.promise;
    const host = f.run.mock.calls[0]![2];
    host.updateConversation('conversation-1', (c) => ({ ...c, remoteUuid: 'remote-1', messages: c.messages.map((m) => m.id === 'answer-1'
      ? { ...m, status: 'stopped', remoteRunUnconfirmed: { conversationUuid: 'remote-1', runId: 'run-1', transport: 'internal-v2',
        agentUuid: '11111111-1111-4111-8111-111111111111', apiBase: WORKOS_INTERNAL_V2_BASE_URL, disconnectedAt: 10 } } : m) }));
    pending.resolve();
    expect(await submitting).toMatchObject({ ok: false, error: expect.stringContaining('状态未确认') });
    expect(f.run).toHaveBeenCalledOnce();
    expect(f.stored().conversations[0]!.messages[3]).toMatchObject({ status: 'stopped', stopStatus: 'local-only', errorMessage: expect.stringContaining('未发送') });
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('records progress loss once and refuses later submissions to the same target, including after restart', async () => {
    const recordEvents = vi.fn(async (_events: import('./taskEvents').BackgroundTaskEvent[]) => undefined);
    const f = fixture(async (_request, _signal, host) => {
      host.updateConversation('conversation-1', (c) => ({ ...c, remoteUuid: 'remote-1', messages: c.messages.map((m) => m.id === 'answer-1' ? {
        ...m, status: 'stopped', remoteRunUnconfirmed: { conversationUuid: 'remote-1', runId: 'run-1', transport: 'internal-v2',
          agentUuid: '11111111-1111-4111-8111-111111111111', apiBase: WORKOS_INTERNAL_V2_BASE_URL, disconnectedAt: 10 },
      } : m) }));
      host.updateConversation('conversation-1', (c) => ({ ...c, title: 'another update' }));
    }, workspace(2), { recordEvents });
    await f.runtime.subscribe(vi.fn());
    expect((await f.command({ kind: 'submit', request: request() })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const events = recordEvents.mock.calls.flatMap((call) => call[0]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('connection-lost');
    expect(await f.command({ kind: 'submit', request: request(2) })).toMatchObject({ ok: false, error: expect.stringContaining('状态未确认') });
    expect(f.run).toHaveBeenCalledOnce();
    const restarted = fixture(async () => undefined, f.stored());
    await restarted.runtime.subscribe(vi.fn());
    expect(await restarted.command({ kind: 'submit', request: request(2) })).toMatchObject({ ok: false });
    expect(restarted.run).not.toHaveBeenCalled();
  });
  it('recovers a temporary first-save failure without caching a rejected initialization', async () => {
    const f = fixture(async () => undefined);
    f.save.mockRejectedValueOnce(new Error('initial storage unavailable'));
    const first = vi.fn();
    await f.runtime.subscribe(first);
    expect(first.mock.calls[0]![0].storageIssue).toContain('正在重试');
    expect(f.load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(f.runtime.snapshot().storageIssue).toBeUndefined();
    const reconnect = vi.fn();
    await f.runtime.subscribe(reconnect);
    expect(reconnect.mock.calls[0]![0].storageIssue).toBeUndefined();
    expect((await f.command({ kind: 'flush' })).ok).toBe(true);
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledTimes(3);
    expect(f.run).not.toHaveBeenCalled();
  });

  it('continues and persists after its subscriber disconnects; reconnect receives current progress', async () => {
    const completion = deferred<void>();
    const f = fixture(async (_request, _signal, _host) => completion.promise);
    const firstListener = vi.fn();
    const disconnect = await f.runtime.subscribe(firstListener);
    expect((await f.command({ kind: 'submit', request: request() })).ok).toBe(true);
    const [, signal, host] = f.run.mock.calls[0]!;
    disconnect();
    const callsAtDisconnect = firstListener.mock.calls.length;
    updateAnswer(host, 'answer-1', 'answer while closed', 'streaming');
    await vi.advanceTimersByTimeAsync(300);
    expect(signal.aborted).toBe(false);
    expect(firstListener).toHaveBeenCalledTimes(callsAtDisconnect);
    expect(f.stored().conversations[0]!.messages[1]!.content).toBe('answer while closed');
    const reconnect = vi.fn();
    await f.runtime.subscribe(reconnect);
    expect(reconnect.mock.calls[0]![0].workspace.conversations[0].messages[1]).toMatchObject({ content: 'answer while closed', status: 'streaming' });
    updateAnswer(host, 'answer-1', 'final answer', 'complete');
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.stored().conversations[0]!.messages[1]).toMatchObject({ content: 'final answer', status: 'complete' });
  });

  it('waits for the queued question to be persisted before executing it', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    const saved = deferred<void>();
    f.save.mockImplementationOnce(async () => saved.promise);
    const response = f.command({ kind: 'submit', request: request() });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.save.mock.calls[1]![0].conversations[0]!.messages[1]!.status).toBe('queued');
    expect(f.run).not.toHaveBeenCalled();
    saved.resolve();
    expect((await response).ok).toBe(true);
    expect(f.run).toHaveBeenCalledTimes(1);
    completion.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('does not execute when saving the question fails, while retaining the bounded save retry', async () => {
    const f = fixture(async () => undefined);
    await f.runtime.subscribe(vi.fn());
    f.save.mockRejectedValueOnce(new Error('disk full'));
    const response = await f.command({ kind: 'submit', request: request() });
    expect(response.ok).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().storageIssue).toContain('正在重试');
    expect(f.keepAlive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.run).not.toHaveBeenCalled();
  });

  it('serializes immediately issued patch and submit commands, saving frozen messages before execution', async () => {
    const completion = deferred<void>();
    const initial = workspace();
    initial.conversations[0]!.messages = [];
    const f = fixture(async () => completion.promise, initial);
    await f.runtime.subscribe(vi.fn());
    const saved = deferred<void>();
    f.save.mockImplementationOnce(async () => saved.promise);
    const patchResponse = f.command({ kind: 'patch', delta: workspaceDelta(initial, workspace()) });
    const submitResponse = f.command({ kind: 'submit', request: request() });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.connection).not.toHaveBeenCalled();
    saved.resolve();
    expect((await patchResponse).ok).toBe(true);
    expect((await submitResponse).ok).toBe(true);
    expect(f.run).toHaveBeenCalledTimes(1);
    const savedMessages = f.save.mock.calls[1]![0].conversations[0]!.messages;
    expect(savedMessages.map((m) => m.id)).toEqual(['user-1', 'answer-1']);
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
  });

  it('blocks an already issued submit when its preceding patch could not be saved', async () => {
    const initial = workspace();
    initial.conversations[0]!.messages = [];
    const f = fixture(async () => undefined, initial);
    await f.runtime.subscribe(vi.fn());
    f.save.mockRejectedValueOnce(new Error('disk full'));
    const patchResponse = f.command({ kind: 'patch', delta: workspaceDelta(initial, workspace()) });
    const submitResponse = f.command({ kind: 'submit', request: request() });
    expect((await patchResponse).ok).toBe(false);
    expect((await submitResponse).ok).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.connection).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().storageIssue).toContain('正在重试');
  });

  it('deduplicates a retried operation even after the task has finished', async () => {
    const f = fixture(async (r, _signal, host) => updateAnswer(host, r.messageId, 'answer', 'complete'));
    await f.runtime.subscribe(vi.fn());
    const operation: ExecutorRequest = { type: 'executor:command', clientId: 'client-1', epoch: f.runtime.snapshot().epoch,
      sequence: 1, command: { kind: 'submit', request: request() } };
    const first = await f.runtime.handle(operation);
    await vi.advanceTimersByTimeAsync(0);
    const repeated = await f.runtime.handle(operation);
    expect(first.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(repeated.snapshot?.confirmed['client-1']).toBe(1);
  });

  it('does not resubmit a finished operation when persistence fails after execution has started', async () => {
    const f = fixture(async (r, _signal, host) => updateAnswer(host, r.messageId, 'answer', 'complete'));
    await f.runtime.subscribe(vi.fn());
    const normalSave = f.save.getMockImplementation()!;
    let failed = false;
    f.save.mockImplementation(async (state) => {
      if (f.run.mock.calls.length && !failed) { failed = true; throw new Error('save after dispatch failed'); }
      await normalSave(state);
    });
    const operation: ExecutorRequest = { type: 'executor:command', clientId: 'client-1', epoch: f.runtime.snapshot().epoch,
      sequence: 1, command: { kind: 'submit', request: request() } };
    await f.runtime.handle(operation);
    await vi.advanceTimersByTimeAsync(300);
    await f.runtime.handle(operation);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('retries a final result which could not be saved and clears its visible storage warning on recovery', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    const normalSave = f.save.getMockImplementation()!;
    f.save.mockRejectedValue(new Error('temporary storage failure'));
    updateAnswer(f.run.mock.calls[0]![2], 'answer-1', 'final answer retained in memory', 'complete');
    completion.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.runtime.snapshot().storageIssue).toContain('正在重试');
    expect(f.stored().conversations[0]!.messages[1]!.content).toBe('');
    const listener = vi.fn();
    await f.runtime.subscribe(listener);
    expect(listener.mock.calls[0]![0].storageIssue).toContain('正在重试');
    f.save.mockImplementation(normalSave);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(f.stored().conversations[0]!.messages[1]).toMatchObject({ content: 'final answer retained in memory', status: 'complete' });
    expect(f.runtime.snapshot().storageIssue).toBeUndefined();
    const aliveCount = f.keepAlive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.keepAlive).toHaveBeenCalledTimes(aliveCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops retrying and releases keepalive after 90 seconds of persistent save failure', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    f.save.mockRejectedValue(new Error('storage quota exceeded'));
    updateAnswer(f.run.mock.calls[0]![2], 'answer-1', 'unsaved final answer', 'complete');
    completion.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(f.runtime.snapshot().storageIssue).toContain('正在重试');
    await vi.advanceTimersByTimeAsync(101);
    expect(f.runtime.snapshot().storageIssue).toContain('已停止自动重试');
    expect(f.runtime.snapshot().workspace.conversations[0]!.messages[1]!.content).toBe('unsaved final answer');
    const saves = f.save.mock.calls.length;
    const aliveCount = f.keepAlive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.save).toHaveBeenCalledTimes(saves);
    expect(f.keepAlive).toHaveBeenCalledTimes(aliveCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects the maintenance owner own stale patches without poisoning the client and reloads imported data on end', async () => {
    const f = fixture(async () => undefined);
    await f.runtime.subscribe(vi.fn());
    expect((await f.command({ kind: 'maintenance-start' })).ok).toBe(true);
    expect(f.runtime.snapshot().maintenance).toBe(true);
    const old = f.runtime.snapshot().workspace;
    const stale = structuredClone(old);
    stale.conversations[0]!.draftInput = 'old client draft during import';
    const rejected = await f.command({ kind: 'patch', delta: workspaceDelta(old, stale) });
    expect(rejected).toMatchObject({ ok: false, retryable: true });
    expect(f.runtime.snapshot().workspace.conversations[0]!.draftInput).toBe('');
    const imported = workspace();
    imported.conversations[0]!.title = 'imported title';
    imported.conversations[0]!.draftInput = 'imported draft';
    imported.conversations[0]!.messages[1]!.content = 'imported answer';
    imported.conversations[0]!.messages[1]!.status = 'complete';
    f.load.mockResolvedValueOnce(imported);
    expect((await f.command({ kind: 'maintenance-end' })).ok).toBe(true);
    expect(f.runtime.snapshot().maintenance).toBe(false);
    expect(f.runtime.snapshot().workspace).toEqual(imported);
    const edited = structuredClone(imported);
    edited.conversations[0]!.draftInput = 'new draft after import';
    expect((await f.command({ kind: 'patch', delta: workspaceDelta(imported, edited) })).ok).toBe(true);
    expect(f.stored().conversations[0]).toMatchObject({ title: 'imported title', draftInput: 'new draft after import' });
    expect(f.stored().conversations[0]!.messages[1]!.content).toBe('imported answer');
  });

  it('waits for a stopped execution to settle before starting the next queued question', async () => {
    const firstDone = deferred<void>();
    const secondDone = deferred<void>();
    const f = fixture(async (r) => r.messageId === 'answer-1' ? firstDone.promise : secondDone.promise, workspace(2));
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request(1) });
    await f.command({ kind: 'submit', request: request(2) });
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.command({ kind: 'stop', conversationId: 'conversation-1', messageId: 'answer-1' });
    expect(f.run.mock.calls[0]![1].reason).toBe(WORKOS_USER_STOP_REASON);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.run).toHaveBeenCalledTimes(1);
    firstDone.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.run.mock.calls[1]![0].messageId).toBe('answer-2');
    secondDone.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('does not resurrect a deleted conversation when a late stream update arrives', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    const host = f.run.mock.calls[0]![2];
    const before = f.runtime.snapshot().workspace;
    const removed: WorkspaceState = { conversations: [], openTabs: [], activeOpenTabId: '' };
    await f.command({ kind: 'patch', delta: workspaceDelta(before, removed) });
    updateAnswer(host, 'answer-1', 'late final content', 'complete');
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.runtime.snapshot().workspace.conversations).toEqual([]);
    expect(f.stored().conversations).toEqual([]);
  });

  it('does not replay stored running questions after worker restart and rejects an old epoch', async () => {
    const stored = workspace();
    stored.conversations[0]!.messages[1]!.status = 'streaming';
    stored.conversations[0]!.messages[1]!.content = 'partial result';
    const oldEpoch = fixture(async () => undefined).runtime.snapshot().epoch;
    const restarted = fixture(async () => undefined, stored);
    await restarted.runtime.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(restarted.run).not.toHaveBeenCalled();
    expect(restarted.runtime.snapshot().workspace.conversations[0]!.messages[1]!.content).toBe('partial result');
    const response = await restarted.runtime.handle({ type: 'executor:command', epoch: oldEpoch, clientId: 'old-client',
      sequence: 1, command: { kind: 'submit', request: request() } });
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining('重启') });
    expect(restarted.run).not.toHaveBeenCalled();
  });

  it('rejects an old-epoch patch without poisoning the same client new-epoch draft and tab updates', async () => {
    const oldEpoch = fixture(async () => undefined).runtime.snapshot().epoch;
    const f = fixture(async () => undefined);
    await f.runtime.subscribe(vi.fn());
    const before = f.runtime.snapshot().workspace;
    const draft = structuredClone(before);
    draft.conversations[0]!.draftInput = 'draft restored after restart';
    const clientId = 'same-panel-client';
    const rejected = await f.runtime.handle({ type: 'executor:command', epoch: oldEpoch, clientId, sequence: 1,
      command: { kind: 'patch', delta: workspaceDelta(before, draft) } });
    expect(rejected).toMatchObject({ ok: false, snapshot: { epoch: f.runtime.snapshot().epoch } });
    expect(f.runtime.snapshot().workspace.conversations[0]!.draftInput).toBe('');
    const recovered = await f.runtime.handle({ type: 'executor:command', epoch: f.runtime.snapshot().epoch, clientId, sequence: 2,
      command: { kind: 'patch', delta: workspaceDelta(before, draft) } });
    expect(recovered.ok).toBe(true);
    const current = f.runtime.snapshot().workspace;
    const switched = structuredClone(current);
    switched.openTabs.push({ id: 'tab-2', conversationId: 'conversation-1', openedAt: 2 });
    switched.activeOpenTabId = 'tab-2';
    const switchResult = await f.runtime.handle({ type: 'executor:command', epoch: f.runtime.snapshot().epoch, clientId, sequence: 3,
      command: { kind: 'patch', delta: workspaceDelta(current, switched) } });
    expect(switchResult.ok).toBe(true);
    expect(f.stored()).toMatchObject({ activeOpenTabId: 'tab-2', conversations: [{ draftInput: 'draft restored after restart' }] });
    expect(f.run).not.toHaveBeenCalled();
  });

  it('keeps alive every 25 seconds and clears keepalive and deadline after execution finishes', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    expect(f.keepAlive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(f.keepAlive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.keepAlive).toHaveBeenCalledTimes(2);
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    const count = f.keepAlive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MAX_BACKGROUND_RUN_MS);
    expect(f.keepAlive).toHaveBeenCalledTimes(count);
    expect(f.run.mock.calls[0]![1].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requests remote stop at the six-hour deadline and releases timers once stop settles', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    const signal = f.run.mock.calls[0]![1];
    await vi.advanceTimersByTimeAsync(MAX_BACKGROUND_RUN_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.reason).toBe(WORKOS_USER_STOP_REASON);
    expect(f.runtime.snapshot().workspace.conversations[0]!.messages[1]).toMatchObject({ status: 'stopped', errorMessage: expect.stringContaining('6 小时') });
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    const count = f.keepAlive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.keepAlive).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('captures page preparation once and exposes the same result to the runner', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    const r = { ...request(), needsPageRead: true, pageTarget: { tabId: 7, expectedUrl: 'https://example.com/original' } };
    await f.command({ kind: 'submit', request: r });
    expect(f.preparePage).toHaveBeenCalledTimes(1);
    expect(f.preparePage.mock.calls[0]![0]).toMatchObject({ pageTarget: r.pageTarget });
    const [, signal, host] = f.run.mock.calls[0]!;
    expect(await host.preparePage(r, signal)).toEqual({ error: 'test page unavailable' });
    expect(await host.preparePage(r, signal)).toEqual({ error: 'test page unavailable' });
    expect(f.preparePage).toHaveBeenCalledTimes(1);
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
  });

  it('responds to stop while page preparation is still pending', async () => {
    const completion = deferred<void>();
    const f = fixture(async () => completion.promise);
    await f.runtime.subscribe(vi.fn());
    const pageDone = deferred<{ error: string }>();
    f.preparePage.mockImplementationOnce(async () => pageDone.promise);
    const r = { ...request(), needsPageRead: true };
    const submit = await f.command({ kind: 'submit', request: r });
    expect(submit.ok).toBe(true);
    expect(f.preparePage).toHaveBeenCalledTimes(1);
    const [, signal, host] = f.run.mock.calls[0]!;
    const awaitingPage = expect(host.preparePage(r, signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await f.command({ kind: 'stop', conversationId: 'conversation-1', messageId: 'answer-1' })).ok).toBe(true);
    await awaitingPage;
    expect(signal.reason).toBe(WORKOS_USER_STOP_REASON);
    expect(f.preparePage.mock.calls[0]![1].aborted).toBe(true);
    pageDone.resolve({ error: 'page read cancelled' });
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
  });

  it('handles stop immediately while a decision HTTP response is still pending', async () => {
    const completion = deferred<void>();
    const reply = deferred<undefined>();
    decisionTransport.replyInterrupt.mockImplementationOnce(async () => reply.promise);
    const f = fixture(async (_r, _signal, host) => {
      host.updateConversation('conversation-1', (c) => ({ ...c, remoteUuid: 'remote-1', messages: c.messages.map((m) => m.id === 'answer-1'
        ? { ...m, status: 'running', stage: 'waiting-user-input', interactions: [{ id: 'decision-1', sessionId: 'session-1', title: 'choose',
          fields: [{ type: 'text', label: 'choice', defaultValue: '' }], status: 'pending' }] } : m) }));
      await completion.promise;
    });
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    expect((await f.command({ kind: 'decision', conversationId: 'conversation-1', messageId: 'answer-1', decisionId: 'decision-1',
      action: 'reply', answers: { choice: 'selected' } })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(decisionTransport.replyInterrupt).toHaveBeenCalledTimes(1);
    expect(f.runtime.snapshot().workspace.conversations[0]!.messages[1]!.interactions![0]!.status).toBe('submitting');
    const stop = await f.command({ kind: 'stop', conversationId: 'conversation-1', messageId: 'answer-1' });
    expect(stop.ok).toBe(true);
    expect(f.run.mock.calls[0]![1].reason).toBe(WORKOS_USER_STOP_REASON);
    expect(decisionTransport.replyInterrupt.mock.calls[0]![3]!.aborted).toBe(true);
    reply.resolve(undefined);
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.runtime.snapshot().workspace.conversations[0]!.messages[1]!.status).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an SSE replied resolution which arrives before decision HTTP success', async () => {
    const completion = deferred<void>();
    const reply = deferred<undefined>();
    decisionTransport.replyInterrupt.mockImplementationOnce(async () => reply.promise);
    const f = fixture(async (_r, _signal, host) => {
      host.updateConversation('conversation-1', (c) => ({ ...c, remoteUuid: 'remote-1', messages: c.messages.map((m) => m.id === 'answer-1'
        ? { ...m, status: 'running', stage: 'waiting-user-input', interactions: [{ id: 'decision-1', sessionId: 'session-1', title: 'choose',
          fields: [{ type: 'text', label: 'choice', defaultValue: '' }], status: 'pending' }] } : m) }));
      await completion.promise;
    });
    await f.runtime.subscribe(vi.fn());
    await f.command({ kind: 'submit', request: request() });
    await f.command({ kind: 'decision', conversationId: 'conversation-1', messageId: 'answer-1', decisionId: 'decision-1',
      action: 'reply', answers: { choice: 'selected' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(decisionTransport.replyInterrupt).toHaveBeenCalledTimes(1);
    const host = f.run.mock.calls[0]![2];
    host.updateConversation('conversation-1', (c) => ({ ...c, messages: c.messages.map((m) => m.id === 'answer-1' ? {
      ...m, stage: 'streaming', interactions: settleAgentInteraction(m.interactions ?? [], {
        requestId: 'decision-1', sessionId: 'session-1', outcome: 'replied', data: { choice: 'server-confirmed' },
      }),
    } : m) }));
    reply.resolve(undefined);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.runtime.snapshot().workspace.conversations[0]!.messages[1]!.interactions![0]).toMatchObject({
      status: 'replied', answers: { choice: 'server-confirmed' },
    });
    completion.resolve();
    await vi.advanceTimersByTimeAsync(300);
    expect(vi.getTimerCount()).toBe(0);
  });
});
