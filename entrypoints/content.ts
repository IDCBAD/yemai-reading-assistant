import { browser } from 'wxt/browser';
import { pageChangeSignature, shouldPublishPageChange } from '../src/content/pageChange';
import {
  candidateFitsViewport,
  isSmartSelectionCancelKey,
  normalizeSmartSelectionText,
  transitionSmartSelectionPhase,
  type SmartSelectionPhase,
} from '../src/content/smartSelection';
import { extractPageSnapshot, getPageMetadata } from '../src/content/pageExtractor';
import type {
  CommandResponse,
  ContentRequest,
  ExtensionEvent,
  ExtensionRequest,
  PanelStatusResponse,
} from '../src/shared/extensionMessages';
import type { QuoteReference } from '../src/sidepanel/types';

const MIN_SELECTION_LENGTH = 2;
const MAX_SELECTION_LENGTH = 8_000;
const SMART_ATOMIC_SELECTOR = 'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption, figure, td, th, caption, dt, dd, a, button, label, summary, img';
const SMART_STRUCTURAL_SELECTOR = 'nav, aside, header, footer, main, article, section, ul, ol, table, [role="navigation"], [role="menu"], [role="list"]';
const SMART_INTERACTIVE_SELECTOR = 'input, textarea, select, option, [contenteditable="true"]';

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
      * { box-sizing: border-box; }
      button { font: inherit; }
      .selection-bubble {
        position: fixed;
        display: inline-flex;
        height: 32px;
        align-items: center;
        gap: 6px;
        padding: 0 11px;
        border: 1px solid rgba(32, 33, 36, .14);
        border-radius: 10px;
        color: #303134;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 10px 30px rgba(32, 33, 36, .16), 0 1px 2px rgba(32, 33, 36, .08);
        cursor: pointer;
        pointer-events: auto;
        font: 600 12px/1 Roboto, "Noto Sans SC", "Segoe UI", sans-serif;
        opacity: 0;
        transform: translateY(-3px) scale(.98);
        transform-origin: 50% 0;
        transition: opacity 140ms cubic-bezier(.2, .8, .2, 1), transform 140ms cubic-bezier(.2, .8, .2, 1), background-color 120ms ease;
      }
      .selection-bubble[data-visible="true"] { opacity: 1; transform: translateY(0) scale(1); }
      .selection-bubble:hover { background: #f8f9fa; }
      .selection-bubble:active { transform: translateY(0) scale(.96); }
      button:focus-visible { outline: 2px solid #315eea; outline-offset: 2px; }
      .selection-mark { color: #315eea; font-size: 15px; font-weight: 700; }

      .smart-layer {
        position: fixed;
        inset: 0;
        display: none;
        pointer-events: auto;
        cursor: crosshair;
        touch-action: pan-y;
        user-select: none;
        font: 400 13px/1.45 Roboto, "Noto Sans SC", "Segoe UI", sans-serif;
      }
      .smart-layer[data-visible="true"] { display: block; }
      .smart-layer[data-phase="awaiting-focus"] { cursor: pointer; }
      .smart-layer:focus { outline: none; }
      .smart-hint {
        position: fixed;
        z-index: 2;
        top: 16px;
        left: 50%;
        display: flex;
        min-height: 48px;
        align-items: center;
        gap: 10px;
        padding: 4px 4px 4px 14px;
        border: 1px solid rgba(255, 255, 255, .1);
        border-radius: 14px;
        color: #f8f9fa;
        background: rgba(31, 31, 31, .96);
        box-shadow: 0 12px 34px rgba(0, 0, 0, .24);
        transform: translateX(-50%);
        cursor: default;
      }
      .smart-status-dot {
        width: 8px;
        height: 8px;
        flex: 0 0 auto;
        border: 2px solid #1f1f1f;
        border-radius: 3px;
        outline: 2px solid #34a853;
      }
      .smart-hint kbd {
        padding: 3px 6px;
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 6px;
        color: #bdc1c6;
        background: rgba(255, 255, 255, .08);
        font: 500 10px/1 Roboto, sans-serif;
      }
      .smart-hint button {
        display: grid;
        width: 40px;
        height: 40px;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 10px;
        color: #bdc1c6;
        background: transparent;
        cursor: pointer;
        font-size: 18px;
        transition: transform 120ms cubic-bezier(.2, .8, .2, 1), background-color 120ms ease, color 120ms ease;
      }
      .smart-hint button:hover { color: white; background: rgba(255, 255, 255, .1); }
      .smart-hint button:active { transform: scale(.96); }
      .smart-outline {
        position: fixed;
        z-index: 1;
        border: 2px solid #315eea;
        border-radius: 6px;
        background: rgba(255, 255, 255, .035);
        box-shadow: 0 0 0 9999px rgba(32, 33, 36, .34), 0 4px 16px rgba(32, 33, 36, .18);
        pointer-events: none;
        opacity: 0;
        transition: opacity 90ms ease, border-color 120ms ease, background-color 120ms ease;
      }
      .smart-outline[data-visible="true"] { opacity: 1; }
      .smart-outline.is-committing {
        border-color: #34a853;
        background: rgba(52, 168, 83, .08);
      }
      @media (prefers-reduced-motion: reduce) {
        .selection-bubble { transition: opacity 100ms ease; transform: none; }
        .smart-outline { transition: opacity 80ms ease, border-color 80ms ease; }
      }
    `;

    const selectionButton = document.createElement('button');
    selectionButton.className = 'selection-bubble';
    selectionButton.type = 'button';
    selectionButton.setAttribute('aria-label', '引用所选文字到页脉');
    selectionButton.innerHTML = '<span class="selection-mark">“</span><span>引用</span>';

    const smartLayer = document.createElement('div');
    smartLayer.className = 'smart-layer';
    smartLayer.tabIndex = -1;
    smartLayer.setAttribute('role', 'dialog');
    smartLayer.setAttribute('aria-label', '智能框选网页内容');
    smartLayer.setAttribute('aria-modal', 'true');
    smartLayer.innerHTML = `
      <div class="smart-hint">
        <i class="smart-status-dot" aria-hidden="true"></i>
        <span aria-live="polite">移动选择内容块，点击引用</span>
        <kbd>Esc</kbd>
        <button type="button" aria-label="取消智能框选">×</button>
      </div>
      <div class="smart-outline"></div>
    `;
    const smartHint = smartLayer.querySelector('.smart-hint span') as HTMLSpanElement;
    const smartEscape = smartLayer.querySelector('.smart-hint kbd') as HTMLElement;
    const smartCancel = smartLayer.querySelector('.smart-hint button') as HTMLButtonElement;
    const smartOutline = smartLayer.querySelector('.smart-outline') as HTMLDivElement;
    shadow.append(style, selectionButton, smartLayer);
    document.documentElement.append(host);

    let currentQuote: QuoteReference | null = null;
    let lastCommittedSignature = '';
    let lastCommittedAt = 0;
    let smartSelectionPhase: SmartSelectionPhase = 'inactive';
    let smartCandidate: HTMLElement | null = null;
    let lastPointer: { x: number; y: number } | null = null;
    let candidateFrame = 0;
    let hintResetTimer = 0;
    let pageChangeTimer = 0;
    let forceNextPageChange = false;
    let softNavigationPending = false;
    let lastPageSignature = pageChangeSignature(getPageMetadata());

    const hideSelectionButton = () => {
      selectionButton.dataset.visible = 'false';
      currentQuote = null;
    };

    const showSelectionButton = (rect: DOMRect, quote: QuoteReference) => {
      currentQuote = quote;
      const width = 72;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + 40 < window.innerHeight ? preferredTop : Math.max(8, rect.top - 40);
      selectionButton.style.left = `${Math.round(left)}px`;
      selectionButton.style.top = `${Math.round(top)}px`;
      selectionButton.dataset.visible = 'true';
    };

    const commitQuote = async (quote: QuoteReference, openPanel: boolean) => {
      const signature = `${quote.pageUrl}\n${quote.text}`;
      if (signature === lastCommittedSignature && Date.now() - lastCommittedAt < 1_200) return;
      lastCommittedSignature = signature;
      lastCommittedAt = Date.now();
      const request: ExtensionRequest = { type: 'selection:commit', quote, openPanel };
      await browser.runtime.sendMessage(request).catch(() => undefined);
    };

    const setSmartHint = (message: string, resetAfter = 0) => {
      window.clearTimeout(hintResetTimer);
      smartHint.textContent = message;
      if (resetAfter > 0) {
        hintResetTimer = window.setTimeout(() => {
          smartHint.textContent = smartSelectionPhase === 'awaiting-focus'
            ? '点击页面开始框选'
            : '移动选择内容块，点击引用';
        }, resetAfter);
      }
    };

    const extractElementText = (element: HTMLElement) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript, input, textarea, select, [aria-hidden="true"]')
        .forEach((node) => node.remove());
      const visibleText = normalizeSmartSelectionText(clone.textContent ?? '', MAX_SELECTION_LENGTH);
      if (visibleText) return visibleText;
      const imageDescriptions = [
        ...(element instanceof HTMLImageElement ? [element] : []),
        ...Array.from(element.querySelectorAll('img')),
      ].map((image) => image.alt.trim()).filter(Boolean);
      const accessibleName = element.getAttribute('aria-label')?.trim() ?? '';
      return normalizeSmartSelectionText(
        accessibleName || (imageDescriptions.length ? `图片：${imageDescriptions.join('；')}` : ''),
        MAX_SELECTION_LENGTH,
      );
    };

    const elementCanBeSelected = (element: HTMLElement) => {
      if (element === document.body || element === document.documentElement || element === host) return false;
      if (element.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (!candidateFitsViewport(element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })) return false;
      const text = extractElementText(element);
      return text.length >= MIN_SELECTION_LENGTH && text.length <= MAX_SELECTION_LENGTH;
    };

    const resolveSmartCandidate = (target: Element | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      if (target.closest(SMART_INTERACTIVE_SELECTOR)) return null;
      const atomic = target.closest(SMART_ATOMIC_SELECTOR);
      if (atomic instanceof HTMLElement && elementCanBeSelected(atomic)) return atomic;

      const structural = target.closest(SMART_STRUCTURAL_SELECTOR);
      if (structural instanceof HTMLElement && elementCanBeSelected(structural)) return structural;

      let current: HTMLElement | null = target;
      while (current && current !== document.body) {
        const display = window.getComputedStyle(current).display;
        const isBlockLike = ['block', 'list-item', 'table-cell', 'flow-root', 'flex', 'grid', 'table', 'inline-block'].includes(display);
        if (isBlockLike && elementCanBeSelected(current)) return current;
        current = current.parentElement;
      }
      return null;
    };

    const underlyingElementAt = (x: number, y: number) => {
      smartLayer.style.pointerEvents = 'none';
      const target = document.elementFromPoint(x, y);
      smartLayer.style.pointerEvents = 'auto';
      return target;
    };

    const clearSmartCandidate = () => {
      smartCandidate = null;
      smartOutline.dataset.visible = 'false';
      smartOutline.classList.remove('is-committing');
    };

    const updateSmartCandidate = () => {
      candidateFrame = 0;
      if (smartSelectionPhase === 'inactive' || smartSelectionPhase === 'committing' || !lastPointer) return;
      const candidate = resolveSmartCandidate(underlyingElementAt(lastPointer.x, lastPointer.y));
      if (!candidate) {
        clearSmartCandidate();
        return;
      }
      const rect = candidate.getBoundingClientRect();
      smartCandidate = candidate;
      smartOutline.style.left = `${Math.round(rect.left - 2)}px`;
      smartOutline.style.top = `${Math.round(rect.top - 2)}px`;
      smartOutline.style.width = `${Math.round(rect.width + 4)}px`;
      smartOutline.style.height = `${Math.round(rect.height + 4)}px`;
      smartOutline.dataset.visible = 'true';
    };

    const scheduleCandidateUpdate = () => {
      if (!candidateFrame) candidateFrame = window.requestAnimationFrame(updateSmartCandidate);
    };

    const announceSmartSelectionFinished = (
      outcome: Extract<ExtensionEvent, { type: 'selection:smart-finished' }>['outcome'],
      reopenPanel: boolean,
      quote?: QuoteReference,
    ) => {
      const request: ExtensionRequest = { type: 'selection:smart-finish', outcome, reopenPanel, quote };
      void browser.runtime.sendMessage(request).catch(() => undefined);
    };

    const finishSmartSelection = (
      outcome: 'committed' | 'cancelled',
      reopenPanel = true,
      quote?: QuoteReference,
    ) => {
      if (smartSelectionPhase === 'inactive') return;
      smartSelectionPhase = transitionSmartSelectionPhase(smartSelectionPhase, 'finish');
      smartLayer.dataset.visible = 'false';
      smartLayer.dataset.phase = 'inactive';
      lastPointer = null;
      clearSmartCandidate();
      window.clearTimeout(hintResetTimer);
      smartEscape.hidden = true;
      setSmartHint('点击页面开始框选');
      announceSmartSelectionFinished(outcome, reopenPanel, quote);
    };

    const focusSmartSelection = () => {
      if (smartSelectionPhase !== 'awaiting-focus') return;
      smartSelectionPhase = transitionSmartSelectionPhase(smartSelectionPhase, 'focus');
      smartLayer.dataset.phase = 'selecting';
      smartEscape.hidden = false;
      setSmartHint('移动选择内容块，点击引用');
      smartLayer.focus({ preventScroll: true });
      scheduleCandidateUpdate();
    };

    const startSmartSelection = () => {
      hideSelectionButton();
      window.getSelection()?.removeAllRanges();
      smartSelectionPhase = transitionSmartSelectionPhase(smartSelectionPhase, 'start');
      lastPointer = null;
      clearSmartCandidate();
      smartEscape.hidden = true;
      setSmartHint('点击页面开始框选');
      smartLayer.dataset.visible = 'true';
      smartLayer.dataset.phase = 'awaiting-focus';
    };

    const inspectSelection = async () => {
      if (smartSelectionPhase !== 'inactive') return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hideSelectionButton();
        return;
      }
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!container || container.closest('input, textarea, [contenteditable="true"]')) {
        hideSelectionButton();
        return;
      }
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      if (text.length < MIN_SELECTION_LENGTH || text.length > MAX_SELECTION_LENGTH) {
        hideSelectionButton();
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideSelectionButton();
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
        hideSelectionButton();
        await commitQuote(quote, false);
        return;
      }
      if (status && !status.bubbleEnabled) {
        hideSelectionButton();
        return;
      }
      showSelectionButton(rect, quote);
    };

    const scheduleInspection = () => window.setTimeout(() => void inspectSelection(), 0);
    const onDocumentPointerUp = (event: PointerEvent) => {
      if (smartSelectionPhase !== 'inactive' || event.composedPath().includes(host)) return;
      scheduleInspection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSmartSelectionCancelKey(event.key)) return;
      if (smartSelectionPhase !== 'inactive') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishSmartSelection('cancelled');
      } else {
        hideSelectionButton();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (smartSelectionPhase !== 'inactive' && isSmartSelectionCancelKey(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishSmartSelection('cancelled');
      } else if (smartSelectionPhase === 'inactive' && (event.shiftKey || event.key.startsWith('Arrow'))) {
        scheduleInspection();
      }
    };
    const onScrollOrResize = () => {
      if (smartSelectionPhase !== 'inactive') scheduleCandidateUpdate();
      else hideSelectionButton();
    };
    const onVisibilityChange = () => {
      if (document.hidden && smartSelectionPhase !== 'inactive') finishSmartSelection('cancelled');
    };

    const publishPageChange = () => {
      pageChangeTimer = 0;
      const forcedByNavigation = forceNextPageChange;
      forceNextPageChange = false;
      softNavigationPending = false;
      const page = getPageMetadata();
      if (!shouldPublishPageChange(lastPageSignature, page, forcedByNavigation)) return;
      lastPageSignature = pageChangeSignature(page);
      const event: ExtensionEvent = { type: 'page:changed', page };
      void browser.runtime.sendMessage(event).catch(() => undefined);
    };

    const schedulePageChange = (delay: number, forcedByNavigation = false) => {
      forceNextPageChange ||= forcedByNavigation;
      window.clearTimeout(pageChangeTimer);
      pageChangeTimer = window.setTimeout(publishPageChange, delay);
    };

    const onHistoryNavigation = () => schedulePageChange(140, true);
    window.addEventListener('popstate', onHistoryNavigation);
    window.addEventListener('hashchange', onHistoryNavigation);

    const titleObserver = new MutationObserver(() => schedulePageChange(120));
    if (document.head) {
      titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    let softNavigationObserver: PerformanceObserver | null = null;
    let interactionPaintObserver: PerformanceObserver | null = null;
    if (typeof PerformanceObserver !== 'undefined') {
      const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
      if (supportedEntryTypes.includes('soft-navigation')) {
        softNavigationObserver = new PerformanceObserver(() => {
          softNavigationPending = true;
          schedulePageChange(320, true);
        });
        softNavigationObserver.observe({ type: 'soft-navigation', buffered: true });
      }
      if (supportedEntryTypes.includes('interaction-contentful-paint')) {
        interactionPaintObserver = new PerformanceObserver(() => {
          if (softNavigationPending) schedulePageChange(80, true);
        });
        interactionPaintObserver.observe({ type: 'interaction-contentful-paint', buffered: true });
      }
    }

    selectionButton.addEventListener('pointerdown', (event) => event.preventDefault());
    selectionButton.addEventListener('click', () => {
      const quote = currentQuote;
      hideSelectionButton();
      if (quote) void commitQuote(quote, true);
    });
    smartLayer.addEventListener('pointermove', (event) => {
      if ((event.target as Element).closest('.smart-hint')) return;
      lastPointer = { x: event.clientX, y: event.clientY };
      scheduleCandidateUpdate();
    });
    smartLayer.addEventListener('pointerdown', (event) => {
      if (smartSelectionPhase === 'selecting' && !(event.target as Element).closest('.smart-hint')) {
        event.preventDefault();
      }
    });
    smartLayer.addEventListener('click', (event) => {
      if (smartSelectionPhase === 'inactive' || smartSelectionPhase === 'committing') return;
      const target = event.target as Element;
      if (target.closest('.smart-hint button')) return;
      if (smartSelectionPhase === 'awaiting-focus') {
        focusSmartSelection();
        return;
      }
      if (target.closest('.smart-hint')) return;
      if (!smartCandidate) {
        setSmartHint('此处没有可引用的文字', 1_100);
        return;
      }
      const text = extractElementText(smartCandidate);
      if (!text) {
        clearSmartCandidate();
        setSmartHint('此处没有可引用的文字', 1_100);
        return;
      }
      const quote: QuoteReference = {
        id: `smart-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text,
        pageTitle: document.title.trim() || window.location.hostname,
        pageUrl: window.location.href,
        createdAt: Date.now(),
      };
      smartSelectionPhase = transitionSmartSelectionPhase(smartSelectionPhase, 'commit');
      smartOutline.classList.add('is-committing');
      setSmartHint('已引用到页脉');
      finishSmartSelection('committed', true, quote);
    });
    smartCancel.addEventListener('click', () => finishSmartSelection('cancelled'));
    document.addEventListener('pointerup', onDocumentPointerUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('visibilitychange', onVisibilityChange);

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
      if (message?.type === 'selection:smart-start') {
        startSmartSelection();
        sendResponse({ ok: true } satisfies CommandResponse);
        return false;
      }
      if (message?.type === 'selection:smart-cancel') {
        if (smartSelectionPhase !== 'inactive') finishSmartSelection('cancelled');
        sendResponse({ ok: true } satisfies CommandResponse);
        return false;
      }
      return false;
    };
    browser.runtime.onMessage.addListener(messageListener);

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(messageListener);
      document.removeEventListener('pointerup', onDocumentPointerUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('popstate', onHistoryNavigation);
      window.removeEventListener('hashchange', onHistoryNavigation);
      titleObserver.disconnect();
      softNavigationObserver?.disconnect();
      interactionPaintObserver?.disconnect();
      window.cancelAnimationFrame(candidateFrame);
      window.clearTimeout(hintResetTimer);
      window.clearTimeout(pageChangeTimer);
      if (smartSelectionPhase !== 'inactive') announceSmartSelectionFinished('cancelled', false);
      host.remove();
    });
  },
});
