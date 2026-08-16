import { browser } from 'wxt/browser';
import type {
  ContentRequest,
  CommandResponse,
  ExtensionEvent,
  ExtensionRequest,
  PageResponse,
  PanelStatusResponse,
  SelectionConsumeResponse,
} from '../src/shared/extensionMessages';
import type { QuoteReference } from '../src/sidepanel/types';
import { hasDefiniteUrlMismatch, isDefinitelyUnsupportedPage } from '../src/shared/tabTarget';

const PENDING_QUOTES_KEY = 'pendingSelectionQuotes';
const SELECTION_BUBBLE_KEY = 'selectionBubbleEnabled';
const LEGACY_HIDDEN_PANEL_TABS_KEY = 'legacyHiddenPanelTabs';
const MAX_PENDING_QUOTES = 20;

interface SidePanelLifecycleInfo {
  path: string;
  tabId?: number;
  windowId: number;
}

interface SidePanelEvent<T> {
  addListener(listener: (info: T) => void): void;
}

type SidePanelWithLifecycle = typeof browser.sidePanel & {
  close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  onOpened?: SidePanelEvent<SidePanelLifecycleInfo>;
  onClosed?: SidePanelEvent<SidePanelLifecycleInfo>;
};

export default defineBackground(() => {
  let panelConnections = 0;
  let bubbleEnabled = true;
  const sidePanel = browser.sidePanel as SidePanelWithLifecycle;
  const openPanelWindows = new Set<number>();
  const openPanelTabs = new Set<number>();
  const legacyHiddenPanelTabs = new Set<number>();
  const hasNativePanelLifecycle = Boolean(sidePanel.onOpened && sidePanel.onClosed);

  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void browser.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => undefined);
  const legacyPanelHydration = browser.storage.session.get(LEGACY_HIDDEN_PANEL_TABS_KEY)
    .then(async (stored) => {
      const tabIds = Array.isArray(stored[LEGACY_HIDDEN_PANEL_TABS_KEY])
        ? stored[LEGACY_HIDDEN_PANEL_TABS_KEY].filter((value): value is number => Number.isInteger(value))
        : [];
      await Promise.all(tabIds.map(async (tabId) => {
        const tab = await browser.tabs.get(tabId).catch(() => undefined);
        if (tab) legacyHiddenPanelTabs.add(tabId);
      }));
    })
    .catch(() => undefined);
  void browser.storage.local.get(SELECTION_BUBBLE_KEY).then((stored) => {
    if (typeof stored[SELECTION_BUBBLE_KEY] === 'boolean') bubbleEnabled = stored[SELECTION_BUBBLE_KEY];
  }).catch(() => undefined);
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && typeof changes[SELECTION_BUBBLE_KEY]?.newValue === 'boolean') {
      bubbleEnabled = changes[SELECTION_BUBBLE_KEY].newValue as boolean;
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'yebian-sidepanel') return;
    panelConnections += 1;
    port.onDisconnect.addListener(() => {
      panelConnections = Math.max(0, panelConnections - 1);
    });
  });

  sidePanel.onOpened?.addListener((info) => {
    if (info.tabId === undefined) openPanelWindows.add(info.windowId);
    else openPanelTabs.add(info.tabId);
  });
  sidePanel.onClosed?.addListener((info) => {
    if (info.tabId === undefined) openPanelWindows.delete(info.windowId);
    else openPanelTabs.delete(info.tabId);
  });

  const persistLegacyHiddenPanelTabs = () => browser.storage.session.set({
    [LEGACY_HIDDEN_PANEL_TABS_KEY]: [...legacyHiddenPanelTabs],
  }).catch(() => undefined);

  const markLegacyPanelHidden = async (tabId: number) => {
    await legacyPanelHydration;
    legacyHiddenPanelTabs.add(tabId);
    await persistLegacyHiddenPanelTabs();
  };

  const clearLegacyPanelHidden = async (tabId: number) => {
    await legacyPanelHydration;
    legacyHiddenPanelTabs.delete(tabId);
    if (legacyHiddenPanelTabs.size) await persistLegacyHiddenPanelTabs();
    else await browser.storage.session.remove(LEGACY_HIDDEN_PANEL_TABS_KEY).catch(() => undefined);
  };

  browser.tabs.onRemoved.addListener((tabId) => {
    openPanelTabs.delete(tabId);
    if (legacyHiddenPanelTabs.delete(tabId)) void persistLegacyHiddenPanelTabs();
  });

  const enqueueQuote = async (quote: QuoteReference) => {
    const stored = await browser.storage.session.get(PENDING_QUOTES_KEY);
    const current = Array.isArray(stored[PENDING_QUOTES_KEY])
      ? stored[PENDING_QUOTES_KEY] as QuoteReference[]
      : [];
    const deduplicated = current.filter((item) => !(item.pageUrl === quote.pageUrl && item.text === quote.text));
    await browser.storage.session.set({
      [PENDING_QUOTES_KEY]: [...deduplicated, quote].slice(-MAX_PENDING_QUOTES),
    });
    const event: ExtensionEvent = { type: 'selection:available' };
    await browser.runtime.sendMessage(event).catch(() => undefined);
  };

  const consumeQuotes = async (): Promise<SelectionConsumeResponse> => {
    const stored = await browser.storage.session.get(PENDING_QUOTES_KEY);
    const quotes = Array.isArray(stored[PENDING_QUOTES_KEY])
      ? stored[PENDING_QUOTES_KEY] as QuoteReference[]
      : [];
    await browser.storage.session.remove(PENDING_QUOTES_KEY);
    return { quotes };
  };

  const sendToTab = async (
    message: ContentRequest,
    target?: { tabId?: number; expectedUrl?: string },
  ): Promise<PageResponse> => {
    const tab = target?.tabId === undefined
      ? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : await browser.tabs.get(target.tabId).catch(() => undefined);
    if (tab?.id === undefined) {
      return { page: null, error: '当前页面不支持读取。' };
    }
    if (isDefinitelyUnsupportedPage(tab.url)) {
      return { page: null, error: '当前页面不支持读取。' };
    }
    if (hasDefiniteUrlMismatch(tab.url, target?.expectedUrl)) {
      return { page: null, error: '页面已切换，本次没有读取旧页面。' };
    }

    for (const delay of [0, 150, 350]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const latestTab = await browser.tabs.get(tab.id).catch(() => undefined);
      if (!latestTab) return { page: null, error: '页面已关闭，本次没有继续读取。' };
      if (hasDefiniteUrlMismatch(latestTab.url, target?.expectedUrl)) {
        return { page: null, error: '页面已切换，本次没有读取旧页面。' };
      }
      try {
        const response = await browser.tabs.sendMessage(tab.id, message) as PageResponse;
        if (response.page && target?.expectedUrl && response.page.url !== target.expectedUrl) {
          return { page: null, error: '页面已切换，本次没有读取旧页面。' };
        }
        return response.page
          ? { ...response, page: { ...response.page, browserTabId: tab.id } }
          : response;
      } catch {
        // A freshly reloaded tab can finish loading just before its content script is ready.
      }
    }
    return { page: null, error: '无法连接当前网页，请刷新页面后重试。' };
  };

  const startSmartSelection = async (tabId?: number): Promise<CommandResponse> => {
    const tab = tabId === undefined
      ? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : await browser.tabs.get(tabId).catch(() => undefined);
    if (tab?.id === undefined || isDefinitelyUnsupportedPage(tab.url)) {
      return { ok: false, error: '当前页面不支持智能框选。' };
    }
    try {
      const response = await browser.tabs.sendMessage(tab.id, { type: 'selection:smart-start' } satisfies ContentRequest) as CommandResponse;
      if (!response?.ok) return { ok: false, error: response?.error ?? '无法在当前页面开始智能框选。' };
      let panelClosed = false;
      if (typeof sidePanel.close === 'function') {
        try {
          await sidePanel.close({ windowId: tab.windowId });
          panelClosed = true;
        } catch {
          try {
            await sidePanel.close({ tabId: tab.id });
            panelClosed = true;
          } catch {
            // Chrome 140 and older do not expose close(); fall through to the compatibility path.
          }
        }
      }
      if (!panelClosed) {
        await markLegacyPanelHidden(tab.id);
        try {
          await browser.sidePanel.setOptions({ tabId: tab.id, enabled: false });
        } catch {
          await clearLegacyPanelHidden(tab.id);
          await browser.tabs.sendMessage(tab.id, { type: 'selection:smart-cancel' } satisfies ContentRequest).catch(() => undefined);
          return { ok: false, error: '无法暂时隐藏侧边栏，请重新加载扩展后重试。' };
        }
      }
      return { ok: true };
    } catch {
      return { ok: false, error: '无法连接当前网页，请刷新页面后重试。' };
    }
  };

  const cancelSmartSelection = async (tabId?: number): Promise<CommandResponse> => {
    const tab = tabId === undefined
      ? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : await browser.tabs.get(tabId).catch(() => undefined);
    if (tab?.id === undefined) return { ok: false, error: '没有可取消的智能框选。' };
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'selection:smart-cancel' } satisfies ContentRequest);
      return { ok: true };
    } catch {
      return { ok: false, error: '智能框选已经结束。' };
    }
  };

  const openPanelForTab = (tab: { id?: number; windowId: number } | undefined) => {
    if (!tab) return Promise.resolve();
    const primaryOpen = tab.id !== undefined
      ? browser.sidePanel.open({ tabId: tab.id })
      : browser.sidePanel.open({ windowId: tab.windowId });
    return primaryOpen
      .catch(() => browser.sidePanel.open({ windowId: tab.windowId }))
      .catch(() => undefined);
  };

  const openSmartSelectionPanel = (tab: { id?: number; windowId: number } | undefined) => {
    if (!tab) return Promise.resolve();
    return browser.sidePanel.open({ windowId: tab.windowId })
      .catch(() => tab.id === undefined ? undefined : browser.sidePanel.open({ tabId: tab.id }))
      .catch(() => undefined);
  };

  const restoreSmartSelectionPanel = async (
    tab: { id?: number; windowId: number } | undefined,
    reopenPanel: boolean,
  ) => {
    await legacyPanelHydration;
    if (tab?.id !== undefined && legacyHiddenPanelTabs.has(tab.id)) {
      await browser.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true,
      }).catch(() => undefined);
      await clearLegacyPanelHidden(tab.id);
      if (reopenPanel) await openPanelForTab(tab);
    }
  };

  browser.runtime.onMessage.addListener((message: ExtensionRequest, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;
    if (message.type === 'panel:status') {
      const senderTabId = sender.tab?.id;
      const senderWindowId = sender.tab?.windowId;
      const trackedOpen = (senderTabId !== undefined && openPanelTabs.has(senderTabId))
        || (senderWindowId !== undefined && openPanelWindows.has(senderWindowId));
      sendResponse({
        open: trackedOpen || (!hasNativePanelLifecycle && panelConnections > 0),
        bubbleEnabled,
      } satisfies PanelStatusResponse);
      return false;
    }
    if (message.type === 'selection:commit') {
      const openPromise = message.openPanel && sender.tab?.id !== undefined
        ? openPanelForTab(sender.tab)
        : Promise.resolve();
      void Promise.all([enqueueQuote(message.quote), openPromise])
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (message.type === 'selection:smart-finish') {
      // Chrome requires sidePanel.open() to run directly from the user's click/key gesture.
      // Start reopening before storage or quote work yields control to another task.
      const immediateOpenPromise = message.reopenPanel
        ? openSmartSelectionPanel(sender.tab)
        : Promise.resolve();
      void Promise.all([
        immediateOpenPromise,
        restoreSmartSelectionPanel(sender.tab, message.reopenPanel),
        message.quote ? enqueueQuote(message.quote) : Promise.resolve(),
      ]).then(async () => {
        const event: ExtensionEvent = { type: 'selection:smart-finished', outcome: message.outcome };
        await browser.runtime.sendMessage(event).catch(() => undefined);
        sendResponse({ ok: true });
      }).catch(() => sendResponse({ ok: false }));
      return true;
    }
    const isSelectionConsume = message.type === 'selection:consume';
    const responsePromise = isSelectionConsume
      ? consumeQuotes()
      : message.type === 'selection:smart-active'
        ? startSmartSelection(message.tabId)
      : message.type === 'selection:smart-cancel-active'
        ? cancelSmartSelection(message.tabId)
      : message.type === 'page:get-active-metadata'
        ? sendToTab({ type: 'page:get-metadata' }, { tabId: message.tabId })
        : message.type === 'page:extract-active'
          ? sendToTab(
              { type: 'page:extract' },
              { tabId: message.tabId, expectedUrl: message.expectedUrl },
            )
          : null;
    if (!responsePromise) return false;
    void responsePromise
      .then(sendResponse)
      .catch(() => sendResponse(isSelectionConsume
        ? { quotes: [] }
        : message.type === 'selection:smart-active' || message.type === 'selection:smart-cancel-active'
          ? { ok: false, error: '扩展后台处理请求失败。' }
          : { page: null, error: '扩展后台处理请求失败。' }));
    return true;
  });
});
