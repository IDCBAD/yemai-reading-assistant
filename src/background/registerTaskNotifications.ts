import { browser } from 'wxt/browser';
import { yemaiDatabase } from '../data/database';
import { TASK_NOTIFICATION_PORT, type TaskNotificationCommand } from '../shared/taskNotifications';
import { TaskNotificationCenter, type TaskNotificationState } from './taskNotifications';
import type { BackgroundTaskEvent } from './taskEvents';
import type { BackgroundTaskRuntime } from './taskRuntime';

export const TASK_NOTIFICATION_STATE_KEY = 'taskNotificationState';
const TARGET_KEY = 'taskNotificationTargets';
const PREFIX = 'yemai-task:';
const STATUS = { complete: '任务已完成', failed: '任务执行失败', 'waiting-user-input': '任务需要确认', 'connection-lost': '进度连接中断，任务状态未确认' } as const;

export function taskNotificationId(conversationId: string, windowId?: number, eventId?: string) {
  return `${PREFIX}${windowId ?? -1}:${encodeURIComponent(conversationId)}${eventId ? `:${encodeURIComponent(eventId)}` : ''}`;
}

export function parseTaskNotificationId(id: string) {
  if (!id.startsWith(PREFIX)) return undefined;
  const match = /^(-?\d+):([^:]+)(?::(.+))?$/.exec(id.slice(PREFIX.length));
  if (!match) return undefined;
  try { return { windowId: Number(match[1]), conversationId: decodeURIComponent(match[2]!), ...(match[3] ? { eventId: decodeURIComponent(match[3]) } : {}) }; } catch { return undefined; }
}

export function registerTaskNotifications(_runtime: BackgroundTaskRuntime) {
  let targetsChangedSinceStartup = false;
  const center = new TaskNotificationCenter({
    load: async () => {
      return yemaiDatabase.transaction('rw', yemaiDatabase.meta, async () => {
        const current = (await yemaiDatabase.meta.get(TASK_NOTIFICATION_STATE_KEY))?.value as TaskNotificationState | undefined;
        if (current && Array.isArray(current.entries)) return current;
        const legacy = (await yemaiDatabase.meta.get('backgroundTaskEvents'))?.value;
        const state: TaskNotificationState = { enabled: true, entries: Array.isArray(legacy) ? (legacy as BackgroundTaskEvent[]).slice(-100).map((event) => ({ ...event, read: true })) : [] };
        await yemaiDatabase.meta.put({ key: TASK_NOTIFICATION_STATE_KEY, value: state });
        return state;
      });
    },
    save: async (state) => {
      await yemaiDatabase.transaction('rw', yemaiDatabase.meta, async () => {
        await yemaiDatabase.meta.put({ key: TASK_NOTIFICATION_STATE_KEY, value: state });
        await yemaiDatabase.meta.put({ key: 'backgroundTaskEvents', value: state.entries.map(({ read: _read, ...event }) => event) });
      });
    },
    badge: async (count) => {
      await browser.action.setBadgeBackgroundColor({ color: '#000000' });
      await browser.action.setBadgeTextColor({ color: '#FFFFFF' });
      await browser.action.setBadgeText({ text: count ? String(count) : '' });
      await browser.action.setTitle({ title: count ? `页脉 · ${count} 个会话有未读任务结果` : '打开页脉' });
    },
    notify: async (event, summary, windowId, eligible) => {
      let window = windowId;
      if (window === undefined) { try { window = (await browser.windows.getLastFocused()).id; } catch { /* open a normal extension tab on click */ } }
      if (!eligible()) return;
      const old = await browser.notifications.getAll();
      if (!eligible()) return;
      for (const id of Object.keys(old).filter((id) => parseTaskNotificationId(id)?.conversationId === event.conversationId)) {
        if (!eligible()) return;
        await browser.notifications.clear(id);
      }
      if (!eligible()) return;
      const id = taskNotificationId(event.conversationId, window, event.id);
      await browser.notifications.create(id, {
        type: 'basic', iconUrl: browser.runtime.getURL('/icons/extension/icon-128.png'), title: STATUS[event.kind],
        message: event.kind === 'connection-lost' ? `${summary} · WorkOS 任务可能仍在运行，请打开查看。` : summary,
      });
      if (!eligible()) await browser.notifications.clear(id);
    },
    dismiss: async (conversationId, eventIds) => {
      const captured = new Set(eventIds);
      const notifications = await browser.notifications.getAll();
      await Promise.all(Object.keys(notifications).filter((id) => {
        const decoded = parseTaskNotificationId(id);
        return decoded?.conversationId === conversationId && (decoded.eventId ? captured.has(decoded.eventId) : !center.snapshot().unreadConversationIds.includes(conversationId));
      }).map((id) => browser.notifications.clear(id)));
    },
    targetsChanged: (targets) => { targetsChangedSinceStartup = true; return browser.storage.session.set({ [TARGET_KEY]: targets }); },
  });
  const persistTargets = () => browser.storage.session.set({ [TARGET_KEY]: center.pendingTargets() });
  void browser.storage.session.get(TARGET_KEY).then((stored) => {
    if (targetsChangedSinceStartup) return;
    const targets = stored[TARGET_KEY] as Record<string, { token: string; conversationId: string }> | undefined;
    for (const [windowId, target] of Object.entries(targets ?? {})) if (!center.pendingTargets()[windowId]) center.setTarget(Number(windowId), target);
  }).catch(() => center.reportIssue('提醒定位状态无法恢复，请从对话列表查看结果。'));
  void center.start().catch(() => center.reportIssue('无法读取提醒状态，请重新打开插件。'));
  void browser.notifications.getPermissionLevel().then((permission) => center.setPermission(permission)).catch(() => center.reportIssue('无法检查系统通知权限，工具栏提醒仍可使用。'));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== TASK_NOTIFICATION_PORT || port.sender?.id !== browser.runtime.id || !port.sender.url?.startsWith(browser.runtime.getURL(''))) return;
    const clientId = crypto.randomUUID();
    const disconnect = center.connect(clientId, (snapshot) => port.postMessage(snapshot));
    port.onDisconnect.addListener(disconnect);
    port.onMessage.addListener((message: TaskNotificationCommand) => {
      if (!message || !['view', 'preference', 'target-seen'].includes(message.kind)) return;
      if (message.kind === 'view' && (!message.view || typeof message.view.visible !== 'boolean' || !Array.isArray(message.view.seenEventIds))) return;
      if (message.kind === 'preference' && typeof message.enabled !== 'boolean') return;
      if (message.kind === 'target-seen' && typeof message.token !== 'string') return;
      void center.command(clientId, message).then(persistTargets).catch(() => center.reportIssue('提醒状态未能保存，请重新打开插件。'));
    });
  });
  browser.notifications.onClicked.addListener((id) => {
    const decoded = parseTaskNotificationId(id);
    if (!decoded) return;
    const target = { token: crypto.randomUUID(), conversationId: decoded.conversationId };
    center.setTarget(decoded.windowId, target);
    void persistTargets().catch(() => undefined);
    const fallback = () => browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') + `?taskConversation=${encodeURIComponent(target.conversationId)}&taskTarget=${encodeURIComponent(target.token)}` });
    // Call open during the notification click's user gesture, before awaiting
    // storage or any other API. A worker restart can decode the ID itself.
    if (decoded.windowId >= 0) {
      try { void browser.sidePanel.open({ windowId: decoded.windowId }).catch(() => fallback()).catch(() => center.reportIssue('无法打开结果，请手动打开插件查看。')); }
      catch { void fallback().catch(() => center.reportIssue('无法打开结果，请手动打开插件查看。')); }
    } else void fallback().catch(() => center.reportIssue('无法打开结果，请手动打开插件查看。'));
  });
  return center;
}
