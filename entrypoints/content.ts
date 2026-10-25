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
import { readWorkosLoginCredentials } from '../src/shared/workosCredentials';
import { captureWordSelection, isWordSelectionBlocked } from '../src/content/wordSelection';
import { collectWord, collectExpression, getCollectedExpressions } from '../src/services/wordCollectionClient';
import { WORD_COLLECTION_ENABLED_KEY, type WordCardCapture } from '../src/shared/wordCards';
import { createReadingFocus, type ReadingFocusStatus } from '../src/content/readingFocus';
import { createReadingFocusToolbar } from '../src/content/readingFocus/toolbar';
import { createReadingFocusSetupStart } from '../src/content/readingFocus/setup';
import { DEFAULT_READING_FOCUS_PREFERENCES, READING_FOCUS_PREFERENCES_KEY, normalizeReadingFocusPreferences, type ReadingFocusPreferences } from '../src/shared/readingFocusPreferences';
import type { ReadingExpression } from '../src/shared/readingExpressions';
import { createReadingWordPopover, type ReadingWordPopover } from '../src/content/readingWordPopover';
import type { PageReadingTaskView } from '../src/shared/pageReadingFocus';
import { translateLocallyWhenReady } from '../src/sidepanel/localTranslator';
import { translationInputFromCapture, type WordTranslationResult, type TranslationService } from '../src/shared/wordTranslation';
import { startWordSpeechPlayback } from '../src/sidepanel/wordSpeechPlayback';

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
      .selection-toolbar {
        position: fixed;
        display: inline-flex;
        height: 34px;
        align-items: center;
        border: 1px solid rgba(32, 33, 36, .14);
        border-radius: 10px;
        overflow: hidden;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 10px 30px rgba(32, 33, 36, .16), 0 1px 2px rgba(32, 33, 36, .08);
        pointer-events: auto;
        font: 600 12px/1 Roboto, "Noto Sans SC", "Segoe UI", sans-serif;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-3px) scale(.98);
        transform-origin: 50% 0;
        transition: opacity 140ms cubic-bezier(.2, .8, .2, 1), transform 140ms cubic-bezier(.2, .8, .2, 1);
      }
      .selection-toolbar[data-visible="true"] { opacity: 1; visibility: visible; transform: translateY(0) scale(1); }
      .selection-bubble {
        display: inline-flex;
        width: 64px;
        min-width: 0;
        height: 32px;
        flex: 0 1 64px;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 0 8px;
        border: 0;
        border-radius: 0;
        color: #303134;
        background: transparent;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease;
      }
      .selection-bubble:hover { background: #f8f9fa; }
      .selection-bubble:active { background: #edf0f4; }
      .selection-bubble:focus-visible { outline-offset: -3px; }
      button:focus-visible { outline: 2px solid #315eea; outline-offset: 2px; }
      .selection-mark { color: #315eea; font-size: 15px; font-weight: 700; }
      .selection-bubble[hidden] { display: none; }
      .selection-lookup { border-right: 1px solid rgba(32, 33, 36, .1); }

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
        .selection-toolbar { transition: opacity 100ms ease; transform: none; }
        .smart-outline { transition: opacity 80ms ease, border-color 80ms ease; }
      }
    `;

    const selectionToolbar = document.createElement('div');
    selectionToolbar.className = 'selection-toolbar';
    selectionToolbar.setAttribute('role', 'toolbar');
    selectionToolbar.setAttribute('aria-label', '所选文字操作');
    const selectionButton = document.createElement('button');
    selectionButton.className = 'selection-bubble';
    selectionButton.type = 'button';
    selectionButton.setAttribute('aria-label', '引用所选文字到页脉');
    selectionButton.innerHTML = '<span class="selection-mark">“</span><span>引用</span>';
    const lookupButton = document.createElement('button');
    lookupButton.className = 'selection-bubble selection-lookup';
    lookupButton.type = 'button';
    lookupButton.textContent = '查词';
    lookupButton.hidden = true;
    selectionToolbar.append(lookupButton, selectionButton);

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
    shadow.append(style, selectionToolbar, smartLayer);
    document.documentElement.append(host);

    let wordPopover: ReadingWordPopover | null = null;
    let wordSpeech: ReturnType<typeof startWordSpeechPlayback> | null = null;
    ctx.onInvalidated(() => wordSpeech?.cancel());
    const getWordPopover = () => wordPopover ??= createReadingWordPopover(shadow, {
      lookup: async (word) => {
        const response = await browser.runtime.sendMessage({ type: 'reading-focus:lookup', word }) as { ok?: boolean; meaning?: string | null; error?: string };
        if (!response?.ok) throw new Error(response?.error || '词库暂时不可用。');
        return response.meaning ?? null;
      },
      save: async (capture) => {
        const result = capture.expression ? await collectExpression(capture) : await collectWord(capture);
        if (capture.expression) void focusToolbar?.refreshSavedExpressions();
        return result;
      },
      translate: translateLocallyWhenReady,
      pronunciation: async (word) => {
        const response = await browser.runtime.sendMessage({ type: 'reading-focus:lookup', word }) as { pronunciation?: string | null };
        return response.pronunciation ?? null;
      },
      speak: (word) => new Promise<void>((resolve, reject) => {
        wordSpeech?.cancel();
        if (typeof speechSynthesis === 'undefined') { reject(new Error('英语语音暂不可用。')); return; }
        wordSpeech = startWordSpeechPlayback({ engine: speechSynthesis, createUtterance: text => new SpeechSynthesisUtterance(text), text: word, rate: .9,
          voice: speechSynthesis.getVoices().find(voice => voice.lang === 'en-US' && voice.localService) ?? null,
          isCurrent: () => !ctx.isInvalid, onStart: () => undefined,
          onFinish: issue => issue ? reject(new Error(issue)) : resolve(),
        });
      }),
      enrich: async (capture, service) => {
        const response = await browser.runtime.sendMessage({ type: 'word-translation:lookup', input: translationInputFromCapture(capture, service) }) as { ok?: boolean; result?: WordTranslationResult; error?: string };
        if (!response?.ok || !response.result) throw new Error(response?.error || '翻译暂时不可用。');
        return response.result;
      },
      getService: async () => {
        const response = await browser.runtime.sendMessage({ type: 'word-translation:preference' }) as { service?: TranslationService };
        return response?.service ?? 'auto';
      },
      openSettings: () => { void browser.runtime.sendMessage({ type: 'word-translation:settings' }); },
    });
    let focusPreferences = { ...DEFAULT_READING_FOCUS_PREFERENCES };
    let latestFocusStatus: ReadingFocusStatus = { enabled: false, count: 0, phase: 'off' };
    let focusToolbar: ReturnType<typeof createReadingFocusToolbar> | undefined;
    let preferenceSave: Promise<void> = Promise.resolve();
    let toggleRevision = 0;
    const preferencesReady = browser.runtime.sendMessage({ type: 'reading-focus:preferences-get' }).then((stored: { ok?: boolean; preferences?: unknown }) => {
      if (stored?.ok) focusPreferences = normalizeReadingFocusPreferences(stored.preferences);
    }).catch(() => undefined);
    const saveFocusPreferences = (preferences: ReadingFocusPreferences) => {
      const value = normalizeReadingFocusPreferences(preferences);
      preferenceSave = preferenceSave.catch(() => undefined).then(async () => {
        const result = await browser.runtime.sendMessage({ type: 'reading-focus:preferences-set', preferences: value }) as { ok?: boolean; error?: string };
        if (!result?.ok) throw new Error(result?.error || '阅读设置未能保存。');
      });
      return preferenceSave;
    };
    const publishFocusStatus = (status: ReadingFocusStatus) => {
      latestFocusStatus = status;
      focusToolbar?.update(status, focusPreferences);
      if (!status.enabled) { wordPopover?.destroy(); wordPopover = null; }
      void browser.runtime.sendMessage({ type: 'reading-focus:changed' }).catch(() => undefined);
    };
    const showReadingExpression = (expression: ReadingExpression, index: number, range: Range) => {
      if (!readingFocus.enabled) return;
      const occurrence = expression.occurrences[index];
      if (!occurrence || range.toString() !== occurrence.text) return;
      hideSelectionButton();
      getWordPopover().show({ word: occurrence.text, sentence: occurrence.sentence,
        highlightStart: occurrence.highlightStart, highlightEnd: occurrence.highlightEnd,
        meaning: expression.meaning, expression: { name: expression.text },
        source: { kind: 'page', title: (document.title || location.hostname).slice(0, 500), url: location.href },
      }, range.getBoundingClientRect());
    };
    const readingFocus = createReadingFocus({
      prepare: async (snapshot, retry, mode) => {
        const response = await browser.runtime.sendMessage({ type: 'reading-focus:page-prepare', snapshot, retry, mode }) as { ok?: boolean; task?: PageReadingTaskView; error?: string };
        if (!response?.ok || !response.task) throw new Error(response?.error || '无法开始文章分析，请重试。');
        return response.task;
      },
      getTask: async (id) => {
        const response = await browser.runtime.sendMessage({ type: 'reading-focus:page-status', id }) as { ok?: boolean; task?: PageReadingTaskView; error?: string };
        if (!response?.ok || !response.task) throw new Error(response?.error || '暂时无法读取分析状态，请重新开启。');
        return response.task;
      },
      stopTask: async (id) => {
        const response = await browser.runtime.sendMessage({ type: 'reading-focus:page-stop', id }) as { ok?: boolean; task?: PageReadingTaskView; error?: string };
        if (!response?.ok || !response.task) throw new Error(response?.error || '无法确认分析是否停止，请检查 WorkOS。');
        return response.task;
      },
      onStatus: publishFocusStatus,
      onExpressions: (items) => focusToolbar?.setExpressions(items),
      onGroupHover: (value) => focusToolbar?.groupHint(value),
      onExpressionClick: (expression, index) => {
        hideSelectionButton(); wordPopover?.hide();
        focusToolbar?.openExpression(expression.id, index);
      },
      onGroupClick: (group) => focusToolbar?.groupDetails(group),
    });
    focusToolbar = createReadingFocusToolbar(shadow, {
      onExit: () => { toggleRevision++; readingFocus.disable(); wordPopover?.hide(); hideSelectionButton(); },
      onStart: createReadingFocusSetupStart({
        revision: () => toggleRevision,
        url: () => location.href,
        save: saveFocusPreferences,
        activate: (preferences) => {
          focusPreferences = preferences;
          readingFocus.setPreferences(preferences);
          readingFocus.enable();
        },
      }),
      onPreferences: (preferences) => {
        focusPreferences = preferences;
        readingFocus.setPreferences(preferences);
        void saveFocusPreferences(preferences).catch(() => focusToolbar?.update({ ...latestFocusStatus, message: '设置未能保存，请重新调整。' }, preferences));
      },
      onStop: () => { void readingFocus.stop(); },
      onRetry: () => { void readingFocus.retry(); },
      onScan: (retry) => { void readingFocus.scanExpressions(retry); },
      onStopExpressions: () => { void readingFocus.stopExpressions(); },
      onLocate: (id, index) => { readingFocus.locateExpression(id, index); },
      getSavedExpressions: (names) => getCollectedExpressions(location.href, names),
      onSaveExpression: async (id, index) => {
        const expression = readingFocus.expressions.find(item => item.id === id);
        const occurrence = expression?.occurrences[index];
        const range = readingFocus.getExpressionRange(id, index);
        if (!expression || !occurrence || !range || range.toString() !== occurrence.text) throw new Error('正文已变化，请重新开启辅助阅读。');
        return collectExpression({ word: occurrence.text, sentence: occurrence.sentence,
          highlightStart: occurrence.highlightStart, highlightEnd: occurrence.highlightEnd,
          meaning: expression.meaning, expression: { name: expression.text },
          source: { kind: 'page', title: (document.title || location.hostname).slice(0, 500), url: location.href },
        });
      },
      onLookup: (id, index) => {
        const range = readingFocus.locateExpression(id, index);
        const expression = readingFocus.expressions.find((item) => item.id === id);
        if (range && expression) showReadingExpression(expression, index, range);
      },
    });

    let currentQuote: QuoteReference | null = null;
    let currentCapture: WordCardCapture | null = null;
    let selectionRevision = 0;
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
      selectionRevision++;
      selectionToolbar.dataset.visible = 'false';
      currentQuote = null;
      currentCapture = null;
    };

    const showSelectionButton = (rect: DOMRect, quote: QuoteReference, capture: WordCardCapture | null = null) => {
      currentQuote = quote;
      currentCapture = capture;
      const width = Math.min(capture ? 130 : 66, Math.max(0, window.innerWidth - 16));
      const height = 34;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      const preferredTop = rect.bottom + 8;
      const aboveTop = rect.top - height - 8;
      const preferredPosition = aboveTop >= 8 ? aboveTop : preferredTop;
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, preferredPosition));
      selectionToolbar.style.width = `${width}px`;
      selectionToolbar.style.left = `${Math.round(left)}px`;
      selectionToolbar.style.top = `${Math.round(top)}px`;
      lookupButton.hidden = !capture;
      selectionToolbar.dataset.visible = 'true';
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
      toggleRevision++;
      focusToolbar?.cancelSetup();
      readingFocus.disable();
      wordPopover?.hide();
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
      const revision = ++selectionRevision;
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
      if (!container || isWordSelectionBlocked(range.startContainer, false) || isWordSelectionBlocked(range.endContainer, false)) {
        hideSelectionButton();
        return;
      }
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 1 || text.length > MAX_SELECTION_LENGTH) {
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
      const capture = captureWordSelection(selection, { kind: 'page', title: quote.pageTitle, url: quote.pageUrl });
      const status = await browser.runtime.sendMessage<ExtensionRequest, PanelStatusResponse>({ type: 'panel:status' }).catch(() => ({ open: false, bubbleEnabled: true, wordCollectionEnabled: true }));
      if (revision !== selectionRevision) return;
      if (capture && (status?.wordCollectionEnabled !== false || readingFocus.enabled)) {
        showSelectionButton(rect, quote, capture);
        return;
      }
      if (text.length < MIN_SELECTION_LENGTH) { hideSelectionButton(); return; }
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
      if (forcedByNavigation) { toggleRevision++; focusToolbar?.cancelSetup(); readingFocus.disable(); wordPopover?.hide(); hideSelectionButton(); }
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

    selectionToolbar.addEventListener('pointerdown', (event) => event.preventDefault());
    lookupButton.addEventListener('click', () => {
      if (!currentCapture) return;
      const capture = currentCapture;
      const rect = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : selectionToolbar.getBoundingClientRect();
      hideSelectionButton();
      getWordPopover().show(capture, rect);
    });
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
      if (message?.type === 'reading-focus:toggle') {
        if (smartSelectionPhase !== 'inactive') finishSmartSelection('cancelled');
        hideSelectionButton();
        const revision = ++toggleRevision;
        if (readingFocus.enabled) { sendResponse(readingFocus.disable()); return false; }
        void preferencesReady.then(() => {
          if (revision !== toggleRevision) { sendResponse({ ...latestFocusStatus }); return; }
          readingFocus.setPreferences(focusPreferences);
          if (!focusPreferences.initialized) {
            focusToolbar?.openSettings(true, focusPreferences);
            sendResponse({ ...latestFocusStatus, message: '请先设置阅读偏好。' });
          } else {
            const status = readingFocus.enable();
            sendResponse({ ...status, error: !status.enabled && status.phase !== 'off' ? status.message : undefined });
          }
        });
        return true;
      }
      if (message?.type === 'reading-focus:status') {
        sendResponse({ ...latestFocusStatus, enabled: readingFocus.enabled });
        return false;
      }
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
      if (message?.type === 'workos:read-login-credentials') {
        sendResponse(readWorkosLoginCredentials(
          window.location.origin,
          (key) => window.localStorage.getItem(key),
        ));
        return false;
      }
      return false;
    };
    browser.runtime.onMessage.addListener(messageListener);
    const onSelectionSettingsChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && (WORD_COLLECTION_ENABLED_KEY in changes || 'selectionBubbleEnabled' in changes)) scheduleInspection();
      if (area === 'local' && READING_FOCUS_PREFERENCES_KEY in changes) {
        const change = changes[READING_FOCUS_PREFERENCES_KEY] as { newValue?: unknown };
        focusPreferences = normalizeReadingFocusPreferences(change.newValue);
        readingFocus.setPreferences(focusPreferences);
        focusToolbar?.update(latestFocusStatus, focusPreferences);
      }
    };
    browser.storage.onChanged.addListener(onSelectionSettingsChanged);

    ctx.onInvalidated(() => {
      toggleRevision++;
      readingFocus.destroy();
      focusToolbar?.destroy();
      wordPopover?.destroy();
      browser.runtime.onMessage.removeListener(messageListener);
      browser.storage.onChanged.removeListener(onSelectionSettingsChanged);
      hideSelectionButton();
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
