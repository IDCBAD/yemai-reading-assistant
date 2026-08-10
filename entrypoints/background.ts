import { browser } from 'wxt/browser';
import type {
  ContentRequest,
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
const MAX_PENDING_QUOTES = 20;

export default defineBackground(() => {
  let panelConnections = 0;
  let bubbleEnabled = true;

  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
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

  browser.runtime.onMessage.addListener((message: ExtensionRequest, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;
    if (message.type === 'panel:status') {
      sendResponse({ open: panelConnections > 0, bubbleEnabled } satisfies PanelStatusResponse);
      return false;
    }
    if (message.type === 'selection:commit') {
      const openPromise = message.openPanel && sender.tab?.id !== undefined
        ? browser.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined)
        : Promise.resolve();
      void Promise.all([enqueueQuote(message.quote), openPromise])
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    const isSelectionConsume = message.type === 'selection:consume';
    const responsePromise = isSelectionConsume
      ? consumeQuotes()
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
        : { page: null, error: '扩展后台处理请求失败。' }));
    return true;
  });
});
