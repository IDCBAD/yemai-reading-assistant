import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yemaiDatabase } from '../data/database';
import { parseTaskNotificationId, registerTaskNotifications, taskNotificationId, TASK_NOTIFICATION_STATE_KEY } from './registerTaskNotifications';
import type { BackgroundTaskRuntime } from './taskRuntime';
import { TASK_NOTIFICATION_PORT } from '../shared/taskNotifications';

const api = vi.hoisted(() => ({
  connect: vi.fn(), clicked: vi.fn(), badge: vi.fn(async () => undefined), color: vi.fn(async () => undefined), textColor: vi.fn(async () => undefined), title: vi.fn(async () => undefined),
  create: vi.fn(async (_id: string, _options: unknown) => 'notice'), clear: vi.fn(async (_id: string) => true), getAll: vi.fn(async () => ({})), permission: vi.fn(async () => 'granted'),
  sessionGet: vi.fn(async (): Promise<Record<string, unknown>> => ({})), sessionSet: vi.fn(async () => undefined), open: vi.fn(async () => undefined), tabsCreate: vi.fn(async () => ({})),
  lastWindow: vi.fn(async () => ({ id: 7 })),
}));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`, onConnect: { addListener: api.connect } },
  notifications: { create: api.create, clear: api.clear, getAll: api.getAll, getPermissionLevel: api.permission, onClicked: { addListener: api.clicked } },
  action: { setBadgeText: api.badge, setBadgeBackgroundColor: api.color, setBadgeTextColor: api.textColor, setTitle: api.title }, windows: { getLastFocused: api.lastWindow },
  storage: { session: { get: api.sessionGet, set: api.sessionSet } }, sidePanel: { open: api.open }, tabs: { create: api.tabsCreate },
} }));
const runtime = {} as BackgroundTaskRuntime;
const event = { id: 'event-1', conversationId: 'conversation:1', messageId: 'answer-1', kind: 'complete' as const, createdAt: 1 };

beforeEach(async () => { vi.clearAllMocks(); api.create.mockResolvedValue('notice'); api.clear.mockResolvedValue(true); api.sessionGet.mockResolvedValue({}); api.permission.mockResolvedValue('granted'); api.open.mockResolvedValue(undefined); api.getAll.mockResolvedValue({}); await yemaiDatabase.meta.clear(); });

describe('notification browser adapter', () => {
  it('warns about lost progress without reporting task failure', async () => {
    const center = registerTaskNotifications(runtime);
    await center.start();
    await center.record([{ ...event, kind: 'connection-lost' }]);
    await center.whenPresented();
    expect(api.create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      title: '进度连接中断，任务状态未确认', message: expect.stringContaining('任务可能仍在运行'),
    }));
    expect(center.snapshot().unreadConversationIds).toEqual([event.conversationId]);
  });
  it('migrates legacy events as already read and saves both records atomically', async () => {
    await yemaiDatabase.meta.put({ key: 'backgroundTaskEvents', value: [event] });
    const center = registerTaskNotifications(runtime);
    await center.start();
    expect(center.snapshot().unreadEvents).toEqual([]);
    expect(api.create).not.toHaveBeenCalled();
    await center.record([{ ...event, id: 'event-2' }]);
    await center.whenPresented();
    const state = (await yemaiDatabase.meta.get(TASK_NOTIFICATION_STATE_KEY))!.value as { entries: unknown[] };
    const legacy = (await yemaiDatabase.meta.get('backgroundTaskEvents'))!.value as unknown[];
    expect(state.entries).toHaveLength(2);
    expect(legacy).toHaveLength(2);
    expect(api.create).toHaveBeenCalledWith(taskNotificationId(event.conversationId, 7, 'event-2'), expect.objectContaining({ title: '任务已完成', message: '页脉对话' }));
  });
  it('does not replay unread notices during startup and shows permission denial with badge', async () => {
    api.permission.mockResolvedValue('denied');
    await yemaiDatabase.meta.put({ key: TASK_NOTIFICATION_STATE_KEY, value: { entries: [{ ...event, read: false }], enabled: true } });
    const center = registerTaskNotifications(runtime);
    await center.start();
    await vi.waitFor(() => expect(center.snapshot().permission).toBe('denied'));
    expect(center.snapshot().issue).toContain('系统通知');
    expect(api.badge).toHaveBeenLastCalledWith({ text: '1' });
    await center.whenPresented();
    expect(api.color).toHaveBeenLastCalledWith({ color: '#000000' });
    expect(api.textColor).toHaveBeenLastCalledWith({ color: '#FFFFFF' });
    expect(api.title).toHaveBeenLastCalledWith({ title: '页脉 · 1 个会话有未读任务结果' });
    expect(api.create).not.toHaveBeenCalled();
  });
  it('calls sidePanel.open synchronously inside notification click and falls back with a target URL', async () => {
    api.open.mockRejectedValueOnce(new Error('window no longer exists'));
    const center = registerTaskNotifications(runtime);
    await center.start();
    const click = api.clicked.mock.calls[0]![0] as (id: string) => void;
    click(taskNotificationId('conversation:1', 7));
    expect(api.open).toHaveBeenCalledWith({ windowId: 7 });
    await vi.waitFor(() => expect(api.tabsCreate).toHaveBeenCalled());
    expect(api.tabsCreate).toHaveBeenCalledWith({ url: expect.stringContaining('sidepanel.html?taskConversation=conversation%3A1&taskTarget=') });
    expect(center.pendingTargets()['7']?.conversationId).toBe('conversation:1');
  });
  it('decodes notification IDs after a worker restart and ignores foreign IDs', () => {
    expect(parseTaskNotificationId(taskNotificationId('c/1', 5))).toEqual({ conversationId: 'c/1', windowId: 5 });
    expect(parseTaskNotificationId('other')).toBeUndefined();
    expect(parseTaskNotificationId('yemai-task:7:%bad%')).toBeUndefined();
  });
  it('replaces an old notice for the same conversation in another window', async () => {
    api.getAll.mockResolvedValue({ [taskNotificationId(event.conversationId, 3)]: true } as never);
    const center = registerTaskNotifications(runtime);
    await center.start();
    await center.record([event]);
    await center.whenPresented();
    expect(api.clear).toHaveBeenCalledWith(taskNotificationId(event.conversationId, 3));
    expect(api.create).toHaveBeenCalledWith(taskNotificationId(event.conversationId, 7, event.id), expect.anything());
  });
  it('does not overwrite a new click target with delayed startup session data', async () => {
    let restore!: (value: Record<string, unknown>) => void;
    api.sessionGet.mockImplementationOnce(() => new Promise((resolve) => { restore = resolve; }));
    const center = registerTaskNotifications(runtime);
    await center.start();
    const click = api.clicked.mock.calls[0]![0] as (id: string) => void;
    click(taskNotificationId('new-conversation', 7));
    const token = center.pendingTargets()['7']!.token;
    restore({ taskNotificationTargets: { 7: { token: 'old-token', conversationId: 'old-conversation' } } });
    await Promise.resolve();
    expect(center.pendingTargets()['7']).toEqual({ token, conversationId: 'new-conversation' });
    await center.clear();
    expect(api.sessionSet).toHaveBeenLastCalledWith({ taskNotificationTargets: {} });
  });
  it('restores an unconsumed target after startup without an attached viewer', async () => {
    api.sessionGet.mockResolvedValueOnce({ taskNotificationTargets: { 7: { token: 'saved-token', conversationId: 'c1' } } });
    const center = registerTaskNotifications(runtime);
    await center.start();
    await vi.waitFor(() => expect(center.pendingTargets()['7']).toEqual({ token: 'saved-token', conversationId: 'c1' }));
  });
  it('only accepts trusted extension ports and keeps a click target until a matching active view', async () => {
    const center = registerTaskNotifications(runtime);
    await center.start();
    const connect = api.connect.mock.calls[0]![0] as (port: unknown) => void;
    const messages = vi.fn();
    const port = { name: TASK_NOTIFICATION_PORT, sender: { id: 'test', url: 'https://external.test/' }, postMessage: vi.fn(), onMessage: { addListener: messages }, onDisconnect: { addListener: vi.fn() } };
    connect(port);
    expect(messages).not.toHaveBeenCalled();
    port.sender.url = 'chrome-extension://test/sidepanel.html';
    connect(port);
    center.setTarget(7, { token: 'token-1', conversationId: 'c1' });
    const command = messages.mock.calls[0]![0] as (message: unknown) => void;
    command({ kind: 'view', view: { visible: true, conversationId: 'c1', windowId: 7, seenEventIds: [] } });
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ target: { token: 'token-1', conversationId: 'c1' } })));
    command({ kind: 'target-seen', token: 'token-1' });
    await vi.waitFor(() => expect(center.pendingTargets()).toEqual({}));
  });
  it('a late timed-out notice can only clear itself and cannot overwrite a newer notice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const displayed: Record<string, boolean> = {};
      const idA = taskNotificationId(event.conversationId, 7, event.id);
      const idB = taskNotificationId(event.conversationId, 7, 'event-2');
      let finishA!: () => void;
      const pendingA = new Promise<void>((resolve) => { finishA = resolve; });
      api.getAll.mockImplementation(async () => ({ ...displayed }));
      api.clear.mockImplementation(async (id) => { delete displayed[id]; return true; });
      api.create.mockImplementation(async (id) => {
        if (id === idA) await pendingA;
        displayed[id] = true;
        return id;
      });
      const center = registerTaskNotifications(runtime);
      await center.start();
      await center.record([event]);
      await vi.waitFor(() => expect(api.create).toHaveBeenCalledWith(idA, expect.anything()));
      await vi.advanceTimersByTimeAsync(3_100);
      await center.clear();
      await center.record([{ ...event, id: 'event-2', createdAt: 2 }]);
      await center.whenPresented();
      expect(displayed[idB]).toBe(true);
      finishA();
      await vi.waitFor(() => expect(displayed[idA]).toBeUndefined());
      expect(displayed[idB]).toBe(true);
      expect(api.clear).not.toHaveBeenCalledWith(idB);
    } finally { vi.useRealTimers(); }
  });
});
