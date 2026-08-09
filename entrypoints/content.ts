import { browser } from 'wxt/browser';
import { extractPageSnapshot, getPageMetadata } from '../src/content/pageExtractor';
import type { ContentRequest, ExtensionRequest, PanelStatusResponse } from '../src/shared/extensionMessages';
import type { QuoteReference } from '../src/sidepanel/types';

const MIN_SELECTION_LENGTH = 2;
const MAX_SELECTION_LENGTH = 8_000;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main(ctx) {
    const host = document.createElement('div');
    host.dataset.yebianSelection = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      button {
        position: fixed;
        display: inline-flex;
        height: 30px;
        align-items: center;
        gap: 5px;
        padding: 0 10px;
        border: 1px solid rgba(39, 94, 254, .28);
        border-radius: 7px;
        color: #163273;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 8px 24px rgba(15, 31, 61, .16), 0 1px 2px rgba(15, 31, 61, .08);
        cursor: pointer;
        pointer-events: auto;
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        transform: translateY(-2px) scale(.97);
        transform-origin: 50% 0;
        transition: opacity 120ms cubic-bezier(.23, 1, .32, 1), transform 120ms cubic-bezier(.23, 1, .32, 1);
      }
      button[data-visible="true"] { opacity: 1; transform: translateY(0) scale(1); }
      button:active { transform: translateY(0) scale(.97); }
      button:focus-visible { outline: 2px solid #275efe; outline-offset: 2px; }
      .mark { color: #275efe; font: 700 15px/1 Georgia, serif; }
      @media (prefers-reduced-motion: reduce) { button { transition: opacity 100ms ease; transform: none; } }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', '引用所选文字到页边');
    button.innerHTML = '<span class="mark">“</span><span>引用</span>';
    shadow.append(style, button);
    document.documentElement.append(host);

    let currentQuote: QuoteReference | null = null;
    let lastCommittedSignature = '';
    let lastCommittedAt = 0;

    const hideButton = () => {
      button.dataset.visible = 'false';
      currentQuote = null;
    };

    const showButton = (rect: DOMRect, quote: QuoteReference) => {
      currentQuote = quote;
      const width = 72;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + 38 < window.innerHeight ? preferredTop : Math.max(8, rect.top - 38);
      button.style.left = `${Math.round(left)}px`;
      button.style.top = `${Math.round(top)}px`;
      button.dataset.visible = 'true';
    };

    const commitQuote = async (quote: QuoteReference, openPanel: boolean) => {
      const signature = `${quote.pageUrl}\n${quote.text}`;
      if (signature === lastCommittedSignature && Date.now() - lastCommittedAt < 1_200) return;
      lastCommittedSignature = signature;
      lastCommittedAt = Date.now();
      const request: ExtensionRequest = { type: 'selection:commit', quote, openPanel };
      await browser.runtime.sendMessage(request).catch(() => undefined);
    };

    const inspectSelection = async () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hideButton();
        return;
      }
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!container || container.closest('input, textarea, [contenteditable="true"]')) {
        hideButton();
        return;
      }
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) {
        hideButton();
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideButton();
        return;
      }
      const quote: QuoteReference = {
        id: `quote-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
        pageTitle: document.title.trim() || window.location.hostname,
        pageUrl: window.location.href,
        createdAt: Date.now(),
      };
      const status = await browser.runtime.sendMessage<ExtensionRequest, PanelStatusResponse>({ type: 'panel:status' }).catch(() => ({ open: false, bubbleEnabled: true }));
      if (status?.open) {
        hideButton();
        await commitQuote(quote, false);
        return;
      }
      if (status && !status.bubbleEnabled) {
        hideButton();
        return;
      }
      showButton(rect, quote);
    };

    const scheduleInspection = () => window.setTimeout(() => void inspectSelection(), 0);
    const onPointerUp = (event: PointerEvent) => {
      if (event.composedPath().includes(host)) return;
      scheduleInspection();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideButton();
      else if (event.shiftKey || event.key.startsWith('Arrow')) scheduleInspection();
    };
    const onScroll = () => hideButton();

    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const quote = currentQuote;
      hideButton();
      if (quote) void commitQuote(quote, true);
    });
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('scroll', onScroll, true);

    const messageListener = (message: ContentRequest, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (message?.type === 'page:get-metadata') {
        sendResponse({ page: getPageMetadata() });
        return false;
      }
      if (message?.type === 'page:extract') {
        void extractPageSnapshot()
          .then((page) => ({ page }))
          .catch((error: unknown) => ({
            page: null,
            error: error instanceof Error ? error.message : '页面正文读取失败。',
          }))
          .then(sendResponse);
        return true;
      }
      return false;
    };
    browser.runtime.onMessage.addListener(messageListener);

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(messageListener);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('scroll', onScroll, true);
      host.remove();
    });
  },
});
