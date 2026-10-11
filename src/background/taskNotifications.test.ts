import { describe, expect, it, vi } from 'vitest';
import { TaskNotificationCenter, type TaskNotificationState } from './taskNotifications';
import type { BackgroundTaskEvent } from './taskEvents';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';

function event(id = 'event-1', conversationId = 'c1'): BackgroundTaskEvent {
  return { id, conversationId, messageId: 'answer', kind: 'complete', createdAt: Number(id.split('-').at(-1)) || 1 };
}
function fixture(initial: TaskNotificationState = { entries: [], enabled: true }) {
  let stored = structuredClone(initial);
  const dependencies = { load: vi.fn(async () => structuredClone(stored)), save: vi.fn(async (state: TaskNotificationState) => { stored = structuredClone(state); }),
    badge: vi.fn(async (_count: number) => undefined), notify: vi.fn(async (): Promise<void> => undefined), dismiss: vi.fn(async () => undefined) };
  return { center: new TaskNotificationCenter(dependencies), dependencies, stored: () => stored };
}
function view(conversationId: string, seenEventIds: string[] = [], visible = true) {
  return { kind: 'view' as const, view: { conversationId, visible, seenEventIds, windowId: 7 } };
}

describe('TaskNotificationCenter', () => {
  it('summarizes the question for this answer instead of the conversation title or a later queued question', async () => {
    const f = fixture();
    const state = structuredClone(INITIAL_WORKSPACE);
    state.conversations[0]!.id = 'c1';
    state.conversations[0]!.title = '第一个任务的固定标题';
    state.conversations[0]!.messages = [
      { id: 'first-question', role: 'user', content: '第一次提问', status: 'complete', createdAt: 1 },
      { id: 'first-answer', role: 'assistant', content: '第一个回答', status: 'complete', createdAt: 2 },
      { id: 'current-question', role: 'user', content: ' 请比较\n这两个方案\t的改造成本 ', status: 'complete', createdAt: 3 },
      { id: 'answer', role: 'assistant', content: '回答正文不应进入通知', status: 'complete', createdAt: 4 },
      { id: 'queued-question', role: 'user', content: '之后排队的新问题', status: 'complete', createdAt: 5 },
      { id: 'queued-answer', role: 'assistant', content: '', status: 'queued', createdAt: 6 },
    ];
    await f.center.reconcile(state);
    await f.center.record([event()]);
    await f.center.whenPresented();
    expect(f.dependencies.notify).toHaveBeenCalledWith(expect.objectContaining(event()), '请比较 这两个方案 的改造成本', undefined, expect.any(Function));
  });
  it('limits long summaries without splitting emoji characters', async () => {
    const f = fixture();
    const state = structuredClone(INITIAL_WORKSPACE);
    state.conversations[0]!.id = 'c1';
    state.conversations[0]!.messages = [
      { id: 'question', role: 'user', content: '😀'.repeat(120), status: 'complete', createdAt: 1 },
      { id: 'answer', role: 'assistant', content: '', status: 'complete', createdAt: 2 },
    ];
    await f.center.reconcile(state);
    await f.center.record([event()]);
    await f.center.whenPresented();
    expect(f.dependencies.notify).toHaveBeenCalledWith(expect.objectContaining(event()), '😀'.repeat(99) + '…', undefined, expect.any(Function));
  });
  it('falls back to a cleaned title for an attachment-only question instead of reusing an earlier question', async () => {
    const f = fixture();
    const state = structuredClone(INITIAL_WORKSPACE);
    state.conversations[0]!.id = 'c1';
    state.conversations[0]!.title = '  附件\n分析  ';
    state.conversations[0]!.messages = [
      { id: 'earlier-question', role: 'user', content: '不相关的旧问题', status: 'complete', createdAt: 1 },
      { id: 'earlier-answer', role: 'assistant', content: '', status: 'complete', createdAt: 2 },
      { id: 'question', role: 'user', content: ' \n ', status: 'complete', createdAt: 3 },
      { id: 'answer', role: 'assistant', content: '', status: 'complete', createdAt: 4 },
    ];
    await f.center.reconcile(state);
    await f.center.record([event()]);
    await f.center.whenPresented();
    expect(f.dependencies.notify).toHaveBeenCalledWith(expect.objectContaining(event()), '附件 分析', undefined, expect.any(Function));
    state.conversations[0]!.title = '  ';
    await f.center.reconcile(state);
    await f.center.record([event('event-2')]);
    await f.center.whenPresented();
    expect(f.dependencies.notify).toHaveBeenLastCalledWith(expect.objectContaining(event('event-2')), '页脉对话', undefined, expect.any(Function));
  });
  it('does not notify an actively viewed conversation but notifies another conversation', async () => {
    const f = fixture();
    await f.center.command('viewer', view('c1'));
    await f.center.record([event(), event('event-2', 'c2')]);
    await f.center.whenPresented();
    expect(f.center.snapshot().unreadConversationIds).toEqual(['c2']);
    expect(f.dependencies.notify).toHaveBeenCalledOnce();
    expect(f.stored().entries[0]!.read).toBe(true);
  });
  it('deduplicates event IDs and counts a conversation only once', async () => {
    const f = fixture();
    await f.center.record([event(), event(), event('event-2')]);
    await f.center.record([event('event-2')]);
    await f.center.whenPresented();
    expect(f.stored().entries).toHaveLength(2);
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(1);
    expect(f.dependencies.notify).toHaveBeenCalledOnce();
  });
  it('does not clear a newer unread event using a late view report', async () => {
    const f = fixture();
    await f.center.record([event(), event('event-2')]);
    await f.center.whenPresented();
    f.dependencies.dismiss.mockClear();
    await f.center.command('viewer', view('c1', ['event-1']));
    expect(f.center.snapshot().unreadEvents).toEqual([{ id: 'event-2', conversationId: 'c1' }]);
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1']);
    await f.center.command('viewer', view('c1', ['event-1', 'event-2']));
    await f.center.whenPresented();
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1', 'event-2']);
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(0);
  });
  it('retains badge when system notifications are disabled and does not replay on enabling', async () => {
    const f = fixture();
    await f.center.command('viewer', { kind: 'preference', enabled: false });
    await f.center.record([event()]);
    await f.center.whenPresented();
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(1);
    expect(f.dependencies.notify).not.toHaveBeenCalled();
    await f.center.command('viewer', { kind: 'preference', enabled: true });
    await f.center.whenPresented();
    expect(f.dependencies.notify).not.toHaveBeenCalled();
  });
  it('restores unread badge on restart without replaying old popups', async () => {
    const f = fixture({ entries: [{ ...event(), read: false }], enabled: true });
    await f.center.start();
    await f.center.record([event()]);
    await f.center.whenPresented();
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(1);
    expect(f.dependencies.notify).not.toHaveBeenCalled();
  });
  it('disconnect clears presence and each viewer is independent', async () => {
    const f = fixture();
    const stop = f.center.connect('a', () => undefined);
    f.center.connect('b', () => undefined);
    await f.center.command('a', view('c1'));
    await f.center.command('b', view('c2'));
    stop();
    await f.center.record([event(), event('event-2', 'c2')]);
    expect(f.center.snapshot().unreadConversationIds).toEqual(['c1']);
  });
  it('notification failure preserves durable unread data and does not fail record', async () => {
    const f = fixture();
    f.dependencies.notify.mockRejectedValueOnce(new Error('OS denied'));
    await expect(f.center.record([event()])).resolves.toBeUndefined();
    await f.center.whenPresented();
    expect(f.stored().entries[0]!.read).toBe(false);
    expect(f.center.snapshot().issue).toContain('未读标记仍会保留');
  });
  it('clear invalidates pending record operations and retains preference', async () => {
    const f = fixture();
    await f.center.command('a', { kind: 'preference', enabled: false });
    await f.center.record([event()]);
    const pending = f.center.record([event('event-2')]);
    const cleared = f.center.clear();
    await Promise.all([pending, cleared]);
    await f.center.whenPresented();
    expect(f.stored()).toEqual({ entries: [], enabled: false });
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1']);
  });
  it('prunes deleted messages and prevents a late record from resurrecting them', async () => {
    const f = fixture();
    await f.center.record([event()]);
    const state = structuredClone(INITIAL_WORKSPACE);
    state.conversations = [];
    await f.center.reconcile(state);
    await f.center.record([event('event-2')]);
    await f.center.whenPresented();
    expect(f.stored().entries).toEqual([]);
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1']);
  });
  it('consumes target only after matching token and active target conversation', async () => {
    const f = fixture();
    f.center.setTarget(7, { token: 'target-1', conversationId: 'c1' });
    await f.center.command('viewer', view('c2'));
    await f.center.command('viewer', { kind: 'target-seen', token: 'target-1' });
    expect(f.center.snapshot('viewer').target).toBeDefined();
    await f.center.command('viewer', view('c1'));
    await f.center.command('viewer', { kind: 'target-seen', token: 'older-token' });
    expect(f.center.snapshot('viewer').target).toBeDefined();
    await f.center.command('viewer', { kind: 'target-seen', token: 'target-1' });
    expect(f.center.snapshot('viewer').target).toBeUndefined();
  });
  it('does not wait for a slow OS notification before persisting or clearing unread state', async () => {
    const f = fixture();
    let finish!: () => void;
    const notification = new Promise<void>((resolve) => { finish = resolve; });
    f.dependencies.notify.mockImplementationOnce(() => notification);
    await f.center.record([event()]);
    await vi.waitFor(() => expect(f.dependencies.notify).toHaveBeenCalledOnce());
    // The notification remains unresolved, while durable state can still clear.
    await f.center.clear();
    expect(f.stored().entries).toEqual([]);
    finish();
    await f.center.whenPresented();
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1']);
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(0);
  });
  it('does not update browser presentation for an unchanged workspace snapshot', async () => {
    const f = fixture();
    await f.center.start();
    await f.center.whenPresented();
    f.dependencies.badge.mockClear();
    await f.center.reconcile(structuredClone(INITIAL_WORKSPACE));
    await f.center.reconcile(structuredClone(INITIAL_WORKSPACE));
    await f.center.whenPresented();
    expect(f.dependencies.badge).not.toHaveBeenCalled();
  });
  it('retries a failed event save and only notifies once after a successful commit', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.dependencies.save.mockRejectedValueOnce(new Error('temporary storage failure'));
      await f.center.record([event()]);
      expect(f.stored().entries).toEqual([]);
      expect(f.center.snapshot().unreadEvents).toEqual([]);
      expect(f.center.snapshot().issue).toContain('任务结果已保存');
      await vi.advanceTimersByTimeAsync(5_000);
      await f.center.whenPresented();
      expect(f.stored().entries).toHaveLength(1);
      expect(f.dependencies.notify).toHaveBeenCalledOnce();
      await f.center.record([event()]);
      await f.center.whenPresented();
      expect(f.dependencies.notify).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('retries a temporary load failure and cancels failed-record retries when history clears', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.dependencies.load.mockRejectedValueOnce(new Error('temporary load failure'));
      await f.center.record([event()]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(f.stored().entries).toHaveLength(1);
      f.dependencies.save.mockRejectedValueOnce(new Error('temporary save failure'));
      await f.center.record([event('event-2')]);
      await f.center.clear();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(f.stored().entries).toEqual([]);
      expect(f.center.snapshot().unreadEvents).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('preserves a later event submitted after clear while discarding an earlier pending event', async () => {
    const f = fixture();
    const before = f.center.record([event()]);
    const clear = f.center.clear();
    const after = f.center.record([event('event-2')]);
    await Promise.all([before, clear, after]);
    expect(f.stored().entries.map((entry) => entry.id)).toEqual(['event-2']);
  });
  it('prunes an old message without dismissing a newer unread message in the same conversation', async () => {
    const f = fixture();
    await f.center.record([{ ...event(), messageId: 'old' }, { ...event('event-2'), messageId: 'new' }]);
    await f.center.whenPresented();
    f.dependencies.dismiss.mockClear();
    const state = structuredClone(INITIAL_WORKSPACE);
    state.conversations[0]!.id = 'c1';
    state.conversations[0]!.messages = [{ id: 'new', role: 'assistant', content: 'answer', status: 'complete', createdAt: 2 }];
    f.center.setTarget(7, { token: 'target', conversationId: 'removed' });
    await f.center.reconcile(state);
    await f.center.whenPresented();
    expect(f.center.snapshot().unreadEvents).toEqual([{ id: 'event-2', conversationId: 'c1' }]);
    expect(f.dependencies.dismiss).toHaveBeenCalledWith('c1', ['event-1']);
    expect(f.dependencies.badge).toHaveBeenLastCalledWith(1);
    expect(f.center.pendingTargets()).toEqual({});
  });
  it('bounds automatic persistence retries and allows a later connection to retry', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.dependencies.save.mockRejectedValue(new Error('storage unavailable'));
      await f.center.record([event()]);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(f.dependencies.save).toHaveBeenCalledTimes(4);
      expect(f.center.snapshot().issue).toContain('重新打开插件重试');
      f.dependencies.save.mockImplementation(async (state) => { f.stored().entries = structuredClone(state.entries); });
      await f.center.start();
      await f.center.whenPresented();
      expect(f.center.snapshot().unreadEvents).toEqual([{ id: 'event-1', conversationId: 'c1' }]);
      expect(f.dependencies.notify).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
