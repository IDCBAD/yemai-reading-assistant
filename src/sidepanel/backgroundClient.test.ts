import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorSnapshot } from '../shared/backgroundTasks';
import type { WorkspaceState } from './types';

const browserMock = vi.hoisted(() => {
  const ports: Array<{
    messageListeners: Array<(message: unknown) => void>;
    disconnectListeners: Array<() => void>;
    onMessage: { addListener: ReturnType<typeof vi.fn> };
    onDisconnect: { addListener: ReturnType<typeof vi.fn> };
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    ports,
    connect: vi.fn(() => {
      const messageListeners: Array<(message: unknown) => void> = [];
      const disconnectListeners: Array<() => void> = [];
      const port = {
        messageListeners,
        disconnectListeners,
        onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)) },
        onDisconnect: { addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)) },
        disconnect: vi.fn(),
      };
      ports.push(port);
      return port;
    }),
    sendMessage: vi.fn(),
  };
});

vi.mock('wxt/browser', () => ({ browser: { runtime: {
  connect: browserMock.connect,
  sendMessage: browserMock.sendMessage,
} } }));

import { BackgroundWorkspaceClient } from './backgroundClient';

function workspace(draftInput = ''): WorkspaceState {
  return {
    conversations: [{
      id: 'c1', title: '对话', subtitle: '', updatedAt: 1, page: { title: '', site: '', url: '', status: 'not-read' }, pages: [],
      messages: [], draftInput, draftContextItems: [],
    }],
    openTabs: [{ id: 'tab1', conversationId: 'c1', openedAt: 1 }],
    activeOpenTabId: 'tab1',
  };
}

function snapshot(revision: number, state: WorkspaceState, confirmed: Record<string, number> = {}, extra: Partial<ExecutorSnapshot> = {}): ExecutorSnapshot {
  return { epoch: 'epoch-1', revision, confirmed, workspace: state, ...extra };
}

function emit(message: unknown) {
  const port = browserMock.ports.at(-1);
  port?.messageListeners.forEach((listener) => listener(message));
}

function emitOn(portIndex: number, message: unknown) {
  browserMock.ports[portIndex]?.messageListeners.forEach((listener) => listener(message));
}

function disconnectPort(portIndex: number) {
  browserMock.ports[portIndex]?.disconnectListeners.forEach((listener) => listener());
}

async function connected(initial = snapshot(1, workspace()), storageRecovered = vi.fn((_: string) => undefined)) {
  const changed = vi.fn();
  const failed = vi.fn();
  const client = new BackgroundWorkspaceClient(workspace(), changed, failed, storageRecovered);
  const ready = client.connect();
  emit(initial);
  await ready;
  return { client, changed, failed, storageRecovered };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('BackgroundWorkspaceClient', () => {
  beforeEach(() => {
    browserMock.ports.length = 0;
    browserMock.connect.mockClear();
    browserMock.sendMessage.mockReset();
  });

  it('replays pending draft edits over an older background snapshot until acknowledged', async () => {
    const send = deferred<ExecutorSnapshot>();
    browserMock.sendMessage.mockReturnValue(send.promise.then((value) => ({ ok: true, snapshot: value })));
    const { client, changed } = await connected();
    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '本地草稿' })),
    }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(1));

    emit(snapshot(2, workspace('旧快照')));
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('本地草稿');

    const request = browserMock.sendMessage.mock.calls[0]?.[0] as { clientId: string; sequence: number };
    send.resolve(snapshot(3, workspace('本地草稿'), { [request.clientId]: request.sequence }));
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('本地草稿'));
  });

  it('ignores snapshots with older revisions', async () => {
    const { client, changed } = await connected();
    emit(snapshot(4, workspace('最新')));
    emit(snapshot(3, workspace('过期')));
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('最新');
    client.disconnect();
  });

  it('keeps the newest acknowledged state when command ACK snapshots arrive out of order', async () => {
    const first = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    const second = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { client, changed } = await connected();
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '第一版' })) }));
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '第二版' })) }));
    const [firstRequest, secondRequest] = browserMock.sendMessage.mock.calls.map(([value]) => value as { clientId: string; sequence: number });
    second.resolve({ ok: true, snapshot: snapshot(3, workspace('第二版'), { [secondRequest!.clientId]: secondRequest!.sequence }) });
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('第二版'));
    first.resolve({ ok: true, snapshot: snapshot(2, workspace('第一版'), { [firstRequest!.clientId]: firstRequest!.sequence }) });
    await Promise.resolve();
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('第二版');
  });

  it('does not duplicate an appended message when the same snapshot is received again', async () => {
    const { client, changed } = await connected();
    const appended = { id: 'm1', role: 'user' as const, content: '问题', createdAt: 2, status: 'queued' as const };
    const next = workspace();
    next.conversations[0]!.messages.push(appended);
    browserMock.sendMessage.mockImplementation(async (request: { clientId: string; sequence: number }) => ({
      ok: true,
      snapshot: snapshot(2, next, { [request.clientId]: request.sequence }),
    }));
    client.update(next);
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.messages).toHaveLength(1));
    emit(snapshot(3, next));
    expect(changed.mock.lastCall?.[0].conversations[0]?.messages).toHaveLength(1);
  });

  it('issues a submit immediately while leaving failed-save enforcement to the background', async () => {
    const patch = deferred<{ ok: false; error: string; snapshot: ExecutorSnapshot }>();
    const submit = deferred<{ ok: false; error: string }>();
    browserMock.sendMessage.mockImplementation((request: { command: { kind: string } }) =>
      request.command.kind === 'patch' ? patch.promise : submit.promise);
    const { client, failed } = await connected();
    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '待保存' })),
    }));
    const command = client.command({ kind: 'submit', request: {
      conversationId: 'c1', messageId: 'a1',
      userMessage: { id: 'u1', role: 'user', content: '问题', createdAt: 1, status: 'complete' },
      needsPageRead: false,
    } });
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(2);
    expect(browserMock.sendMessage.mock.calls.map(([request]) => (request as { command: { kind: string } }).command.kind))
      .toEqual(['patch', 'submit']);
    patch.resolve({ ok: false, error: '保存失败', snapshot: snapshot(2, workspace()) });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('保存失败'));
    submit.resolve({ ok: false, error: '前序保存失败，未执行命令。' });
    await expect(command).rejects.toThrow('前序保存失败');
    await expect(client.command({ kind: 'submit', request: {
      conversationId: 'c1', messageId: 'a2',
      userMessage: { id: 'u2', role: 'user', content: '后续问题', createdAt: 2, status: 'complete' },
      needsPageRead: false,
    } })).rejects.toThrow('保存失败');
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not send patches in response to received snapshots', async () => {
    const { client } = await connected();
    emit(snapshot(2, workspace('后台更新')));
    expect(browserMock.sendMessage).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('disconnects the panel port without sending a stop command', async () => {
    const { client } = await connected();
    client.disconnect();
    expect(browserMock.ports[0]?.disconnect).toHaveBeenCalledOnce();
    expect(browserMock.sendMessage).not.toHaveBeenCalled();
  });

  it('drops UI workspace updates while the background is in maintenance', async () => {
    const { client, changed, failed } = await connected(snapshot(1, workspace(), {}, { maintenance: true }));
    changed.mockClear();
    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '维护期间编辑' })),
    }));
    expect(changed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(browserMock.sendMessage).not.toHaveBeenCalled();
  });

  it('drops a retryable rejected patch without permanently blocking later updates', async () => {
    const retryableSnapshot = snapshot(2, workspace(), {}, { storageIssue: '存储暂不可用' });
    browserMock.sendMessage
      .mockResolvedValueOnce({ ok: false, retryable: true, error: '后台正在维护', snapshot: retryableSnapshot })
      .mockResolvedValueOnce({ ok: true, snapshot: snapshot(3, workspace('稍后重试成功')) });
    const { client, failed } = await connected();
    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '首次编辑' })),
    }));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('存储暂不可用'));

    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '稍后重试成功' })),
    }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(2));
    expect((browserMock.sendMessage.mock.calls[1]?.[0] as { command: { kind: string } }).command.kind).toBe('patch');
  });

  it('rejects a retryable maintenance command without poisoning a later workspace patch', async () => {
    browserMock.sendMessage
      .mockResolvedValueOnce({ ok: false, retryable: true, error: '维护启动冲突', snapshot: snapshot(2, workspace(), {}, { maintenance: true }) })
      .mockResolvedValueOnce({ ok: true, snapshot: snapshot(4, workspace('维护后保存')) });
    const { client } = await connected();

    await expect(client.command({ kind: 'maintenance-start' })).rejects.toThrow('维护启动冲突');
    emit(snapshot(3, workspace(), {}, { maintenance: false }));
    client.update((current) => ({
      ...current,
      conversations: current.conversations.map((item) => ({ ...item, draftInput: '维护后保存' })),
    }));

    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(2));
    expect((browserMock.sendMessage.mock.calls[1]?.[0] as { command: { kind: string } }).command.kind).toBe('patch');
  });

  it('calls storage recovery with the previous issue when a later snapshot clears it', async () => {
    const issue = 'workspace 写入失败';
    const { client, failed, storageRecovered } = await connected(snapshot(1, workspace(), {}, { storageIssue: issue }));
    expect(failed).toHaveBeenCalledWith(issue);

    emit(snapshot(2, workspace()));

    expect(storageRecovered).toHaveBeenCalledOnce();
    expect(storageRecovered).toHaveBeenCalledWith(issue);
    expect(failed).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it('restores conversation switching after an idle background port disconnects', async () => {
    const initial = workspace();
    initial.conversations.push({ ...initial.conversations[0]!, id: 'c2' });
    initial.openTabs.push({ id: 'tab2', conversationId: 'c2', openedAt: 2 });
    browserMock.sendMessage.mockImplementation(async (request: { clientId: string; sequence: number; epoch: string }) => ({
      ok: true, snapshot: snapshot(2, { ...initial, activeOpenTabId: 'tab2' }, { [request.clientId]: request.sequence }, { epoch: request.epoch }),
    }));
    const { client, changed } = await connected(snapshot(1, initial));
    disconnectPort(0);
    client.update((current) => ({ ...current, activeOpenTabId: 'tab2' }));
    emit(snapshot(1, initial, {}, { epoch: 'epoch-2' }));
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].activeOpenTabId).toBe('tab2'));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(2));
    const migratedPatch = browserMock.sendMessage.mock.calls[1]?.[0] as { epoch: string; command: { kind: string; delta: { ui: { set: Record<string, unknown> } } } };
    expect(migratedPatch.epoch).toBe('epoch-2');
    expect(migratedPatch.command.kind).toBe('patch');
    expect(migratedPatch.command.delta.ui.set.activeOpenTabId).toBe('tab2');
    client.disconnect();
  });

  it('retries a rejected UI patch against a restarted worker without freezing later switching', async () => {
    const initial = workspace();
    initial.conversations.push({ ...initial.conversations[0]!, id: 'c2' });
    initial.openTabs.push({ id: 'tab2', conversationId: 'c2', openedAt: 2 });
    browserMock.sendMessage.mockResolvedValueOnce({ ok: false, error: '扩展后台已重启', snapshot: snapshot(1, initial, {}, { epoch: 'epoch-2' }) })
      .mockImplementation(async (request: { clientId: string; sequence: number }) => ({ ok: true,
        snapshot: snapshot(2, { ...initial, activeOpenTabId: 'tab2' }, { [request.clientId]: request.sequence }, { epoch: 'epoch-2' }),
      }));
    const { client, changed } = await connected(snapshot(1, initial));
    client.update((current) => ({ ...current, activeOpenTabId: 'tab2' }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(2));
    expect(changed.mock.lastCall?.[0].activeOpenTabId).toBe('tab2');
    client.disconnect();
  });

  it('does not disconnect a new port when an old RPC changes epoch during reconnect', async () => {
    const rpc = deferred<{ ok: false; error: string; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage.mockReturnValue(rpc.promise);
    const { client, changed } = await connected();
    const staleCommand = client.command({ kind: 'flush' }).catch(() => undefined);
    disconnectPort(0);
    const reconnecting = client.connect();
    expect(browserMock.ports).toHaveLength(2);

    rpc.resolve({ ok: false, error: '后台已重启', snapshot: snapshot(1, workspace('RPC 快照'), {}, { epoch: 'epoch-2' }) });
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('RPC 快照'));
    emitOn(0, snapshot(99, workspace('旧 port 迟到快照')));
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('RPC 快照');
    emitOn(1, snapshot(2, workspace('新 port 快照'), {}, { epoch: 'epoch-2' }));
    await reconnecting;
    await staleCommand;

    expect(browserMock.ports[1]?.disconnect).not.toHaveBeenCalled();
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('新 port 快照');
    client.disconnect();
  });

  it('merges multiple pending edits over a new epoch and ignores a late old-epoch success', async () => {
    const first = deferred<{ ok: false; error: string; snapshot: ExecutorSnapshot }>();
    const second = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    const recovery = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => recovery.promise);
    const { client, changed } = await connected();
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '较早草稿' })) }));
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '最新草稿' })) }));
    const [firstRequest, secondRequest] = browserMock.sendMessage.mock.calls.map(([value]) => value as { clientId: string; sequence: number; epoch: string; command: { kind: string } });
    first.resolve({ ok: false, error: 'epoch 已更新', snapshot: snapshot(1, workspace(), {}, { epoch: 'epoch-2' }) });
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(3));
    const recoveryRequest = browserMock.sendMessage.mock.calls[2]?.[0] as { clientId: string; sequence: number; epoch: string; command: { kind: string; delta: { changed: { fields: { set: Record<string, unknown> } }[] } } };
    expect(recoveryRequest.epoch).toBe('epoch-2');
    expect(recoveryRequest.command.kind).toBe('patch');
    expect(recoveryRequest.command.delta.changed[0]?.fields.set.draftInput).toBe('最新草稿');

    recovery.resolve({ ok: true, snapshot: snapshot(2, workspace('最新草稿'), { [recoveryRequest.clientId]: recoveryRequest.sequence }, { epoch: 'epoch-2' }) });
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('最新草稿'));
    emitOn(1, snapshot(2, workspace('最新草稿'), {}, { epoch: 'epoch-2' }));
    second.resolve({ ok: true, snapshot: snapshot(99, workspace('旧 epoch 内容'), { [secondRequest!.clientId]: secondRequest!.sequence }, { epoch: 'epoch-1' }) });
    await Promise.resolve();

    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('最新草稿');
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(3);
    client.disconnect();
  });

  it('keeps draft A when the E2 switch-to-B ACK arrives before A’s late E1 rejection', async () => {
    const oldPatch = deferred<{ ok: false; error: string }>();
    const migratedPatch = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    const switchPatch = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage
      .mockImplementationOnce(() => oldPatch.promise)
      .mockImplementationOnce(() => migratedPatch.promise)
      .mockImplementationOnce(() => switchPatch.promise);
    const initial = workspace();
    initial.conversations.push({ ...initial.conversations[0]!, id: 'c2' });
    initial.openTabs.push({ id: 'tab2', conversationId: 'c2', openedAt: 2 });
    const { client, changed, failed } = await connected(snapshot(1, initial));

    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '草稿 A' })) }));
    emitOn(0, snapshot(1, initial, {}, { epoch: 'epoch-2' }));
    await vi.waitFor(() => expect(browserMock.ports).toHaveLength(2));
    client.update((current) => ({ ...current, activeOpenTabId: 'tab2' }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(3));

    const migrationRequest = browserMock.sendMessage.mock.calls[1]?.[0] as { clientId: string; sequence: number; epoch: string };
    const switchRequest = browserMock.sendMessage.mock.calls[2]?.[0] as { clientId: string; sequence: number; epoch: string };
    expect(migrationRequest.epoch).toBe('epoch-2');
    expect(switchRequest.epoch).toBe('epoch-2');
    const switched = workspace('草稿 A');
    switched.conversations.push({ ...switched.conversations[0]!, id: 'c2' });
    switched.openTabs.push({ id: 'tab2', conversationId: 'c2', openedAt: 2 });
    switched.activeOpenTabId = 'tab2';
    switchPatch.resolve({ ok: true, snapshot: snapshot(3, switched, { [switchRequest.clientId]: switchRequest.sequence }, { epoch: 'epoch-2' }) });
    await vi.waitFor(() => {
      expect(changed.mock.lastCall?.[0].activeOpenTabId).toBe('tab2');
      expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('草稿 A');
    });

    oldPatch.resolve({ ok: false, error: '旧 epoch 草稿写入延迟拒绝' });
    migratedPatch.resolve({ ok: true, snapshot: snapshot(2, workspace('草稿 A'), { [migrationRequest.clientId]: migrationRequest.sequence }, { epoch: 'epoch-2' }) });
    emitOn(1, snapshot(4, switched, { [switchRequest.clientId]: switchRequest.sequence }, { epoch: 'epoch-2' }));
    await Promise.resolve();

    expect(changed.mock.lastCall?.[0].activeOpenTabId).toBe('tab2');
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('草稿 A');
    expect(failed).not.toHaveBeenCalledWith('旧 epoch 草稿写入延迟拒绝');
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(3);
    client.disconnect();
  });

  it('continues accepting edits after a transport rejection and reconnect in a new epoch', async () => {
    const recovery = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage
      .mockRejectedValueOnce(new Error('runtime port closed'))
      .mockImplementationOnce(() => recovery.promise)
      .mockImplementationOnce(async (request: { clientId: string; sequence: number }) => ({
        ok: true,
        snapshot: snapshot(3, workspace('草稿 B'), { [request.clientId]: request.sequence }, { epoch: 'epoch-2' }),
      }));
    const { client, changed, failed } = await connected();

    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '草稿 A' })) }));
    await vi.waitFor(() => expect(browserMock.ports).toHaveLength(2));
    emitOn(1, snapshot(1, workspace(), {}, { epoch: 'epoch-2' }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(2));
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '草稿 B' })) }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(3));

    const recoveryRequest = browserMock.sendMessage.mock.calls[1]?.[0] as { epoch: string };
    const nextEditRequest = browserMock.sendMessage.mock.calls[2]?.[0] as { epoch: string };
    expect(recoveryRequest.epoch).toBe('epoch-2');
    expect(nextEditRequest.epoch).toBe('epoch-2');
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('草稿 B'));
    recovery.resolve({ ok: true, snapshot: snapshot(2, workspace('草稿 A'), {}, { epoch: 'epoch-2' }) });
    await Promise.resolve();

    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('草稿 B');
    expect(failed).not.toHaveBeenCalledWith('runtime port closed');
    client.disconnect();
  });

  it('keeps a reconnecting port when two pending RPCs reject before hydration', async () => {
    const first = deferred<never>();
    const second = deferred<never>();
    browserMock.sendMessage.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
      .mockImplementation(async (request: { clientId: string; sequence: number }) => ({ ok: true,
        snapshot: snapshot(2, workspace('草稿 B'), { [request.clientId]: request.sequence }, { epoch: 'epoch-2' }) }));
    const { client, changed } = await connected();
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '草稿 A' })) }));
    client.update((current) => ({ ...current, conversations: current.conversations.map((item) => ({ ...item, draftInput: '草稿 B' })) }));
    first.reject(new Error('first port closed'));
    await vi.waitFor(() => expect(browserMock.ports).toHaveLength(2));
    second.reject(new Error('second port closed'));
    await Promise.resolve();
    await Promise.resolve();
    emitOn(1, snapshot(1, workspace(), {}, { epoch: 'epoch-2' }));
    await vi.waitFor(() => expect(browserMock.sendMessage).toHaveBeenCalledTimes(3));
    expect(changed.mock.lastCall?.[0].conversations[0]?.draftInput).toBe('草稿 B');
    expect(browserMock.ports[1]!.disconnect).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('never automatically resends stale submit, decision, or clear commands after an epoch change', async () => {
    const replies = [0, 1, 2].map(() => deferred<{ ok: false; error: string; snapshot: ExecutorSnapshot }>());
    replies.forEach((reply, index) => browserMock.sendMessage.mockImplementationOnce(() => reply.promise));
    const { client } = await connected();
    const commands = [
      client.command({ kind: 'submit', request: {
        conversationId: 'c1', messageId: 'a1',
        userMessage: { id: 'u1', role: 'user' as const, content: '问题', createdAt: 1, status: 'complete' as const },
        needsPageRead: false,
      } }),
      client.command({ kind: 'decision', conversationId: 'c1', messageId: 'a1', decisionId: 'd1', action: 'reply', answers: {} }),
      client.command({ kind: 'clear-history' }),
    ].map((promise) => promise.catch(() => undefined));
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(3);

    replies.forEach((reply, index) => reply.resolve({
      ok: false, error: '后台已重启',
      snapshot: snapshot(index + 1, workspace(`新 epoch ${index + 1}`), {}, { epoch: 'epoch-2' }),
    }));
    await Promise.all(commands);
    await vi.waitFor(() => expect(browserMock.ports).toHaveLength(2));
    emitOn(1, snapshot(4, workspace('恢复快照'), {}, { epoch: 'epoch-2' }));
    expect(browserMock.sendMessage).toHaveBeenCalledTimes(3);
    expect(browserMock.sendMessage.mock.calls.map(([request]) => (request as { command: { kind: string } }).command.kind))
      .toEqual(['submit', 'decision', 'clear-history']);
    client.disconnect();
  });

  it('does not reconnect or apply late callbacks after explicit disconnect', async () => {
    const { client, changed } = await connected();
    const changedCount = changed.mock.calls.length;
    client.disconnect();
    emitOn(0, snapshot(2, workspace('迟到内容')));
    disconnectPort(0);

    expect(changed).toHaveBeenCalledTimes(changedCount);
    expect(browserMock.connect).toHaveBeenCalledOnce();
    expect(browserMock.ports).toHaveLength(1);
    expect(browserMock.sendMessage).not.toHaveBeenCalled();
  });

  it('receives streaming snapshots through a port reopened after idle disconnect', async () => {
    const rpc = deferred<{ ok: true; snapshot: ExecutorSnapshot }>();
    browserMock.sendMessage.mockReturnValue(rpc.promise);
    const { client, changed } = await connected();
    disconnectPort(0);
    const command = client.command({ kind: 'flush' });
    expect(browserMock.ports).toHaveLength(2);
    const streaming = workspace();
    streaming.conversations[0]!.messages.push({ id: 'a1', role: 'assistant', content: '流式进度', createdAt: 2, status: 'streaming' });
    emitOn(1, snapshot(2, streaming));
    expect(changed.mock.lastCall?.[0].conversations[0]?.messages[0]?.content).toBe('流式进度');
    rpc.resolve({ ok: true, snapshot: snapshot(3, streaming) });
    await command;
    client.disconnect();
  });
});
