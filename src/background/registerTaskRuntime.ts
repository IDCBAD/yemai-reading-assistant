import { browser } from 'wxt/browser';
import { BackgroundTaskRuntime } from './taskRuntime';
import { clearWorkspaceHistory, loadWorkspaceState, saveWorkspaceState } from '../services/workspaceStorage';
import { loadWorkosConnectionSettings } from '../services/workosConnection';
import { TASK_PORT, type ExecutorRequest } from '../shared/backgroundTasks';
import type { PageResponse } from '../shared/extensionMessages';
import type { SerializableAgentRequest } from './runAgentRequest';
import { registerTaskNotifications } from './registerTaskNotifications';

export function registerTaskRuntime(extractPage: (target: { tabId?: number; expectedUrl?: string }) => Promise<PageResponse>) {
  let notifications: ReturnType<typeof registerTaskNotifications>;
  const runtime = new BackgroundTaskRuntime({
    load: loadWorkspaceState,
    save: saveWorkspaceState,
    connection: loadWorkosConnectionSettings,
    keepAlive: () => browser.runtime.getPlatformInfo(),
    recordEvents: async (events) => {
      // Reminder delivery must never turn a saved answer into a task failure.
      // The display subscription is throttled; a fast task can finish before
      // its new message appears there. Validate against the current executor.
      await notifications.reconcile(runtime.snapshot().workspace).catch(() => undefined);
      await notifications.record(events).catch(() => notifications.reportIssue('任务提醒尚未保存，请重新打开插件检查。'));
    },
    clearHistory: async (replacement) => {
      await clearWorkspaceHistory(replacement);
      await notifications.clear().catch(() => notifications.reportIssue('任务提醒未能清除，请重新打开插件检查。'));
    },
    preparePage: async (request: SerializableAgentRequest, signal) => {
      if (request.pagePreparation) return request.pagePreparation;
      if (!request.needsPageRead) return {};
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (request.pageTarget?.tabId === undefined) return { error: '原页面无法定位，本次只发送已冻结的链接和引用。' };
      const response = await extractPage(request.pageTarget);
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      return response.page && 'markdown' in response.page ? { snapshot: response.page } : { error: response.error ?? '页面正文未能读取。' };
    },
  });
  notifications = registerTaskNotifications(runtime);
  void runtime.subscribe((snapshot) => {
    void notifications.reconcile(snapshot.workspace).catch(() => notifications.reportIssue('任务提醒状态未能更新，请重新打开插件检查。'));
  }).catch(() => undefined);
  const isExtensionPage = (sender: { id?: string; url?: string }) => sender.id === browser.runtime.id && Boolean(sender.url?.startsWith(browser.runtime.getURL('')));
  browser.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(`${TASK_PORT}:`) || !port.sender || !isExtensionPage(port.sender)) return;
    runtime.attachClient(port.name.slice(TASK_PORT.length + 1));
    let connected = true;
    let unsubscribe: (() => void) | undefined;
    port.onDisconnect.addListener(() => { connected = false; unsubscribe?.(); void runtime.releaseClient(port.name.slice(TASK_PORT.length + 1)); });
    void runtime.subscribe((snapshot) => { if (connected) port.postMessage(snapshot); })
      .then((stop) => { if (connected) unsubscribe = stop; else stop(); })
      .catch(() => { if (connected) port.postMessage({ error: '后台无法读取本地会话，请检查扩展存储权限。' }); });
  });
  browser.runtime.onMessage.addListener((message: ExecutorRequest, sender, sendResponse) => {
    if (message?.type !== 'executor:command') return false;
    if (!isExtensionPage(sender)) { sendResponse({ ok: false, error: '任务只能由扩展界面发起。' }); return false; }
    void runtime.handle(message).then(sendResponse);
    return true;
  });
  return runtime;
}
