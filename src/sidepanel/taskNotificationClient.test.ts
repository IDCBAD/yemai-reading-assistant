import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_TASK_NOTIFICATIONS, TASK_NOTIFICATION_PORT } from '../shared/taskNotifications';

const mock = vi.hoisted(() => {
  const ports: { emit: (state: unknown) => void; close: () => void; postMessage: ReturnType<typeof vi.fn> }[] = [];
  return { ports, connect: vi.fn(() => {
    let message: (state: unknown) => void = () => undefined;
    let disconnected = () => undefined;
    const port = { postMessage: vi.fn(), onMessage: { addListener: (callback: typeof message) => { message = callback; } },
      onDisconnect: { addListener: (callback: typeof disconnected) => { disconnected = callback; } }, disconnect: vi.fn(),
      emit: (state: unknown) => message(state), close: () => disconnected() };
    ports.push(port);
    return port;
  }) };
});
vi.mock('wxt/browser', () => ({ browser: { runtime: { connect: mock.connect } } }));
import { TaskNotificationClient } from './taskNotificationClient';

beforeEach(() => { mock.ports.length = 0; mock.connect.mockClear(); });
describe('task notification presentation client', () => {
  it('queues navigation acknowledgement until hydration and a matching window view were reported', () => {
    const client = new TaskNotificationClient(vi.fn());
    client.connect();
    client.acknowledgeTarget('target-1');
    mock.ports[0]!.emit(INITIAL_TASK_NOTIFICATIONS);
    expect(mock.ports[0]!.postMessage.mock.calls.some(([command]) => command.kind === 'target-seen')).toBe(false);
    client.report({ visible: false, conversationId: 'c1', windowId: 7, seenEventIds: [] });
    expect(mock.ports[0]!.postMessage.mock.calls.slice(-2).map(([command]) => command.kind)).toEqual(['view', 'target-seen']);
    client.disconnect();
  });
  it('uses the trusted notification port and waits for hydration before reporting the latest view', () => {
    const client = new TaskNotificationClient(vi.fn());
    client.report({ visible: true, conversationId: 'c1', windowId: 7, seenEventIds: ['seen-1'] });
    expect(mock.connect).toHaveBeenCalledWith({ name: TASK_NOTIFICATION_PORT });
    expect(mock.ports[0]!.postMessage).not.toHaveBeenCalled();
    mock.ports[0]!.emit(INITIAL_TASK_NOTIFICATIONS);
    expect(mock.ports[0]!.postMessage).toHaveBeenCalledWith({ kind: 'view', view: { visible: true, conversationId: 'c1', windowId: 7, seenEventIds: ['seen-1'] } });
    client.disconnect();
  });
  it('reconnects on a later report and ignores callbacks from the retired port', () => {
    const changed = vi.fn();
    const client = new TaskNotificationClient(changed);
    const view = { visible: true, conversationId: 'c1', seenEventIds: [] };
    client.report(view);
    mock.ports[0]!.emit(INITIAL_TASK_NOTIFICATIONS);
    mock.ports[0]!.close();
    client.report(view);
    mock.ports[1]!.emit({ ...INITIAL_TASK_NOTIFICATIONS, unreadConversationIds: ['c2'] });
    mock.ports[0]!.emit({ ...INITIAL_TASK_NOTIFICATIONS, unreadConversationIds: ['stale'] });
    expect(changed.mock.lastCall?.[0].unreadConversationIds).toEqual(['c2']);
    expect(mock.ports[1]!.postMessage).toHaveBeenCalledWith({ kind: 'view', view });
    client.disconnect();
  });
  it('does not report identical snapshots repeatedly or reconnect after disposal', () => {
    const client = new TaskNotificationClient(vi.fn());
    const view = { visible: true, conversationId: 'c1', seenEventIds: ['event-1'] };
    client.report(view);
    mock.ports[0]!.emit(INITIAL_TASK_NOTIFICATIONS);
    client.report(view);
    expect(mock.ports[0]!.postMessage).toHaveBeenCalledOnce();
    client.disconnect();
    mock.ports[0]!.close();
    client.setEnabled(false);
    client.report(view);
    expect(mock.connect).toHaveBeenCalledOnce();
  });
});
