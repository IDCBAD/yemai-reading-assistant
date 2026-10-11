export const TASK_NOTIFICATION_PORT = 'task-notifications';

export interface TaskNotificationTarget { token: string; conversationId: string }
export interface TaskNotificationSnapshot {
  unreadConversationIds: string[];
  unreadEvents: { id: string; conversationId: string }[];
  systemNotificationsEnabled: boolean;
  permission: 'granted' | 'denied' | 'unknown';
  issue?: string;
  target?: TaskNotificationTarget;
}
export interface TaskNotificationView {
  conversationId?: string;
  visible: boolean;
  windowId?: number;
  seenEventIds: string[];
}
export type TaskNotificationCommand =
  | { kind: 'view'; view: TaskNotificationView }
  | { kind: 'preference'; enabled: boolean }
  | { kind: 'target-seen'; token: string };

export const INITIAL_TASK_NOTIFICATIONS: TaskNotificationSnapshot = {
  unreadConversationIds: [], unreadEvents: [], systemNotificationsEnabled: true, permission: 'unknown',
};
