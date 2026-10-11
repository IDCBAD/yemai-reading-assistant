import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorRequest, ExecutorResponse, ExecutorSnapshot } from '../shared/backgroundTasks';
import type { WorkspaceState } from './types';

const browserMock = vi.hoisted(() => ({ connect: vi.fn(), sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: browserMock } }));

import { BackgroundWorkspaceClient } from './backgroundClient';
import { BackgroundTaskRuntime } from '../background/taskRuntime';

function workspace(): WorkspaceState {
  return {
    conversations: ['c1', 'c2'].map((id) => ({ id, title: id, subtitle: '', updatedAt: 1,
      page: { title: '', site: '', url: '', status: 'not-read' as const }, pages: [], messages: [], draftInput: '', draftContextItems: [] })),
    openTabs: ['c1', 'c2'].map((conversationId, index) => ({ id: `tab${index + 1}`, conversationId, openedAt: 1 })),
    activeOpenTabId: 'tab1',
  };
}

function deferred<T>() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, fail) => { reject = fail; });
  return { promise, reject };
}

function fixture() {
  let stored = workspace();
  const run = vi.fn(async () => undefined);
  const connection = vi.fn(async () => ({ schemaVersion: 2 as const, agentUuid: '', transport: 'internal-v2' as const,
    publicApiToken: '', internalV2: { accessToken: '', userUuid: '', organizationUuid: '' } }));
  const createRuntime = () => new BackgroundTaskRuntime({
    load: async () => structuredClone(stored),
    save: async (state) => { stored = structuredClone(state); },
    run, connection, preparePage: async () => ({}), keepAlive: async () => undefined,
  });
  let runtime = createRuntime();
  const ports: Array<{ disconnect(): void }> = [];
  browserMock.connect.mockImplementation(({ name }: { name: string }) => {
    const server = runtime;
    const clientId = name.slice(name.indexOf(':') + 1);
    const messageListeners: Array<(snapshot: ExecutorSnapshot) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    server.attachClient(clientId);
    const port = {
      onMessage: { addListener: (listener: (snapshot: ExecutorSnapshot) => void) => { messageListeners.push(listener); } },
      onDisconnect: { addListener: (listener: () => void) => { disconnectListeners.push(listener); } },
      disconnect() {
        if (!alive) return;
        alive = false;
        unsubscribe?.();
        void server.releaseClient(clientId);
        disconnectListeners.forEach((listener) => listener());
      },
    };
    ports.push(port);
    void server.subscribe((snapshot) => {
      if (alive) messageListeners.forEach((listener) => listener(snapshot));
    }).then((stop) => { unsubscribe = stop; if (!alive) stop(); });
    return port;
  });
  browserMock.sendMessage.mockImplementation((request: ExecutorRequest) => runtime.handle(request));
  const changed = vi.fn();
  const failed = vi.fn();
  const client = new BackgroundWorkspaceClient(workspace(), changed, failed);
  return {
    client, changed, failed, run, connection,
    server: () => runtime,
    stored: () => stored,
    state: () => changed.mock.lastCall![0] as WorkspaceState,
    restart(disconnect = true) { runtime = createRuntime(); if (disconnect) ports.forEach((port) => port.disconnect()); },
    close() { client.disconnect(); ports.forEach((port) => port.disconnect()); },
  };
}

const fixtures: Array<ReturnType<typeof fixture>> = [];
beforeEach(() => { browserMock.connect.mockReset(); browserMock.sendMessage.mockReset(); });
afterEach(() => { fixtures.splice(0).forEach((f) => f.close()); });

describe('BackgroundWorkspaceClient with the real BackgroundTaskRuntime', () => {
  it('migrates an unacknowledged draft after restart and ignores a late old transport failure', async () => {
    const f = fixture(); fixtures.push(f);
    await f.client.connect();
    const oldEpoch = f.server().snapshot().epoch;
    const oldRpc = deferred<ExecutorResponse>();
    browserMock.sendMessage.mockImplementationOnce(() => oldRpc.promise);
    f.client.update((state) => ({ ...state, conversations: state.conversations.map((c) => c.id === 'c1'
      ? { ...c, draftInput: '后台重启前尚未保存的草稿' } : c) }));
    expect(f.stored().conversations[0]!.draftInput).toBe('');

    f.restart();
    await f.client.connect();
    expect(f.server().snapshot().epoch).not.toBe(oldEpoch);
    await vi.waitFor(() => expect(f.server().snapshot().workspace.conversations[0]!.draftInput).toBe('后台重启前尚未保存的草稿'));
    f.client.update((state) => ({ ...state, activeOpenTabId: 'tab2' }));
    await vi.waitFor(() => expect(f.stored().activeOpenTabId).toBe('tab2'));

    oldRpc.reject(new Error('The message port closed before a response was received.'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.client.update((state) => ({ ...state, activeOpenTabId: 'tab1' }));
    await vi.waitFor(() => expect(f.stored().activeOpenTabId).toBe('tab1'));
    expect(f.state().conversations[0]!.draftInput).toBe('后台重启前尚未保存的草稿');
    expect(f.failed).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(browserMock.sendMessage.mock.calls.every(([request]) => (request as ExecutorRequest).command.kind === 'patch')).toBe(true);
  });

  it('recovers old-epoch message records as stopped without replaying the rejected submit', async () => {
    const f = fixture(); fixtures.push(f);
    await f.client.connect();
    const oldEpoch = f.server().snapshot().epoch;
    // Leave the existing port alive until the command response reveals the new epoch.
    f.restart(false);
    const userMessage = { id: 'u1', role: 'user' as const, content: '后台更换时发出的问题', createdAt: 2, status: 'complete' as const };
    f.client.update((state) => ({ ...state, conversations: state.conversations.map((c) => c.id === 'c1'
      ? { ...c, messages: [userMessage, { id: 'a1', role: 'assistant', content: '', createdAt: 3, status: 'queued', stage: 'queued' }] } : c) }));
    const submit = f.client.command({ kind: 'submit', request: { conversationId: 'c1', messageId: 'a1', userMessage, needsPageRead: false } });
    expect(browserMock.sendMessage.mock.calls.slice(0, 2).map(([request]) => (request as ExecutorRequest).epoch)).toEqual([oldEpoch, oldEpoch]);
    await expect(submit).rejects.toThrow('扩展后台已重启');

    await vi.waitFor(() => expect(f.stored().conversations[0]!.messages).toHaveLength(2));
    expect(f.stored().conversations[0]!.messages[1]).toMatchObject({ id: 'a1', status: 'stopped', errorMessage: expect.stringContaining('本次发送未确认') });
    expect(f.state().conversations[0]!.messages[1]!.status).toBe('stopped');
    f.client.update((state) => ({ ...state, activeOpenTabId: 'tab2' }));
    await vi.waitFor(() => expect(f.stored().activeOpenTabId).toBe('tab2'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(f.run).not.toHaveBeenCalled();
    expect(f.connection).not.toHaveBeenCalled();
    expect(browserMock.sendMessage.mock.calls.filter(([request]) => (request as ExecutorRequest).command.kind === 'submit')).toHaveLength(1);
    expect(f.stored().conversations[0]!.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
  });
});
