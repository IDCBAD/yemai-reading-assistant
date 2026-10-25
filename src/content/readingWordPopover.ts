import type { WordCardCapture, WordMeaningSource } from '../shared/wordCards';
import { TRANSLATION_SERVICES, type TranslationService, type WordTranslationResult } from '../shared/wordTranslation';
import { wordPopoverStyles, applyWordPopoverTheme, appendHighlightedText } from './wordPopoverSurface';

export interface ReadingWordPopoverDependencies {
  lookup(word: string): Promise<string | null>;
  save(capture: WordCardCapture): Promise<unknown>;
  /** Only provide a translator that is already available; never initiate a language-pack download. */
  translate?(word: string): Promise<string | null>;
  enrich?(capture: WordCardCapture, service?: TranslationService): Promise<WordTranslationResult>;
  pronunciation?(word: string): string | null | Promise<string | null>;
  speak?(word: string): void | Promise<void>;
  getService?(): TranslationService | Promise<TranslationService>;
  openSettings?(): void;
}

export interface ReadingWordPopover {
  show(capture: WordCardCapture, rect: Pick<DOMRect, 'left' | 'top' | 'bottom'>): void;
  hide(): void;
  destroy(): void;
}

/** A selection-triggered dictionary UI inside the content script's isolated shadow root. */
export function createReadingWordPopover(root: ShadowRoot, deps: ReadingWordPopoverDependencies): ReadingWordPopover {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const style = doc.createElement('style');
  style.textContent = wordPopoverStyles;
  const panel = doc.createElement('section');
  panel.className = 'yemai-word-popover';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '查词');
  const header = doc.createElement('header');
  const word = doc.createElement('strong');
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'yemai-word-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭查词');
  header.append(word, close);
  const meaning = doc.createElement('p');
  meaning.className = 'yemai-word-meaning';
  meaning.setAttribute('role', 'status');
  meaning.setAttribute('aria-live', 'polite');
  const save = doc.createElement('button');
  save.type = 'button';
  save.className = 'yemai-word-save';
  const status = doc.createElement('p');
  status.className = 'yemai-word-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(header, meaning, save, status);
  const ipa = doc.createElement('span'); ipa.className = 'yemai-word-ipa';
  const speak = doc.createElement('button'); speak.type = 'button';
  if (doc.createElementNS) {
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '17'); icon.setAttribute('height', '17');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.6');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round'); icon.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14');
    icon.append(path); speak.append(icon);
  } else speak.textContent = '发音';
  speak.setAttribute('aria-label', '播放单词发音'); speak.hidden = !deps.speak;
  header.append(ipa, speak);
  const toolbar = doc.createElement('div'); toolbar.className = 'yemai-word-toolbar';
  const brand = doc.createElement('span'); brand.textContent = '页脉 · 查词';
  const serviceButton = doc.createElement('button'); serviceButton.type = 'button';
  serviceButton.setAttribute('aria-haspopup', 'menu'); serviceButton.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div'); menu.className = 'yemai-word-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  toolbar.append(brand, serviceButton, menu); toolbar.hidden = !deps.enrich;
  const details = doc.createElement('div'); details.className = 'yemai-word-details';
  const waiting = doc.createElement('div'); waiting.className = 'yemai-word-waiting';
  waiting.setAttribute('role', 'status'); waiting.setAttribute('aria-label', '正在查询');
  for (let i = 0; i < 3; i += 1) waiting.append(doc.createElement('i'));
  waiting.hidden = true;
  panel.append(toolbar, details, waiting);
  root.append(style, panel);

  let selectedService: TranslationService = 'auto';
  let serviceOverride = false;
  let remoteReady = false;
  let enrichmentNotice = '';
  let themeElement: Element | null = null;
  let themeObserver: MutationObserver | undefined;
  const media = view?.matchMedia?.('(prefers-color-scheme: dark)');
  const refreshTheme = () => { if (!panel.hidden) applyWordPopoverTheme(panel, themeElement); };
  media?.addEventListener?.('change', refreshTheme);
  let generation = 0;
  let destroyed = false;
  let currentCapture: WordCardCapture | null = null;
  let currentMeaning: { value: string; source?: WordMeaningSource } | null = null;
  let anchor: Pick<DOMRect, 'left' | 'top' | 'bottom'> | null = null;
  let saveAttempted = false;
  let selectionSnapshot: {
    startContainer: Node; startOffset: number; endContainer: Node; endOffset: number; text: string;
  } | null = null;
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveLabel = (capture: WordCardCapture) => /\s/u.test(capture.word.trim()) ? '收藏表达' : '收藏单词';

  const isCurrent = (token: number) => !destroyed && !panel.hidden && token === generation;
  const position = () => {
    if (!anchor) return;
    const width = view?.innerWidth ?? 320;
    const height = view?.innerHeight ?? 600;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(anchor.left, width - bounds.width - 12))}px`;
    const below = anchor.bottom + 10;
    const top = below + bounds.height <= height - 12 ? below : anchor.top - bounds.height - 10;
    panel.style.top = `${Math.max(12, Math.min(top, height - bounds.height - 12))}px`;
  };
  const rememberSelection = (capture: WordCardCapture) => {
    try {
      const selection = doc.getSelection?.();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
      const text = selection.toString();
      if (text.replace(/\s+/gu, ' ').trim() !== capture.word) return;
      const selectedRange = selection.getRangeAt(0);
      const range = selectedRange.cloneRange?.() ?? selectedRange;
      // Copy endpoints: live Range offsets can change when the page changes its text.
      selectionSnapshot = { startContainer: range.startContainer, startOffset: range.startOffset,
        endContainer: range.endContainer, endOffset: range.endOffset, text };
    } catch { /* Detached documents and pages without selection support remain usable. */ }
  };
  const clearCapturedSelection = () => {
    const snapshot = selectionSnapshot;
    selectionSnapshot = null;
    if (!snapshot) return;
    try {
      const selection = doc.getSelection?.();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || selection.toString() !== snapshot.text) return;
      const range = selection.getRangeAt(0);
      if (range.startContainer === snapshot.startContainer && range.startOffset === snapshot.startOffset
        && range.endContainer === snapshot.endContainer && range.endOffset === snapshot.endOffset) {
        // Ending this lookup releases only its original selection so paragraph hovering can resume.
        selection.removeAllRanges();
      }
    } catch { /* Never disturb a later selection or fail to close after page DOM changes. */ }
  };
  const dismiss = (clearSelection: boolean) => {
    if (clearSelection) clearCapturedSelection();
    else selectionSnapshot = null;
    generation += 1;
    panel.hidden = true;
    currentCapture = null;
    currentMeaning = null;
    anchor = null;
    waiting.hidden = true;
    menu.hidden = true;
    serviceButton.setAttribute('aria-expanded', 'false');
    themeObserver?.disconnect();
    themeElement = null;
    clearTimeout(lookupTimer);
    clearTimeout(saveTimer);
  };
  const hide = () => dismiss(true);
  const onEscape = (event: KeyboardEvent) => {
    if (!event.defaultPrevented && event.key === 'Escape') hide();
  };
  const onPointerDown = (event: PointerEvent) => {
    // Preserve the page selection while using the floating controls. Tab still focuses buttons.
    event.preventDefault();
    event.stopPropagation();
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!event.composedPath().includes(panel)) hide();
  };
  const onScroll = (event: Event) => {
    if (!event.composedPath().includes(panel)) hide();
  };
  const onSave = async () => {
    if (!currentCapture || save.disabled || destroyed) return;
    const token = generation;
    const capture: WordCardCapture = { ...currentCapture, source: { ...currentCapture.source } };
    if (currentMeaning) {
      capture.meaning = currentMeaning.value;
      if (currentMeaning.source) capture.meaningSource = currentMeaning.source;
      else delete capture.meaningSource;
    }
    save.disabled = true;
    saveAttempted = true;
    save.textContent = '收藏中…';
    status.textContent = '';
    // A slow save is never retried automatically: it may already have persisted the card.
    saveTimer = setTimeout(() => {
      if (isCurrent(token)) status.textContent = '仍在保存，请稍候。';
    }, 8_000);
    try {
      await deps.save(capture);
      if (!isCurrent(token)) return;
      clearTimeout(saveTimer);
      save.textContent = '已收藏';
      status.textContent = '已保存到单词卡片。';
      position();
    } catch {
      if (!isCurrent(token)) return;
      clearTimeout(saveTimer);
      save.disabled = false;
      save.textContent = '重试收藏';
      status.textContent = '收藏失败，请重试。';
      position();
    }
  };
  const loadMeaning = async (capture: WordCardCapture, token: number) => {
    let lookupFailed = false;
    let value: string | null = null;
    try { value = await deps.lookup(capture.word); } catch { lookupFailed = true; }
    if (!isCurrent(token)) return;
    let source: WordMeaningSource = 'dictionary';
    if (!value?.trim() && deps.translate) {
      try {
        value = await deps.translate(capture.word);
        source = 'browser';
      } catch { /* Unsupported or unprepared local translation leaves the dictionary fallback visible. */ }
    }
    if (!isCurrent(token)) return;
    clearTimeout(lookupTimer);
    if (!deps.enrich) panel.setAttribute('aria-busy', 'false');
    if (remoteReady) return;
    if (!deps.enrich) waiting.hidden = true;
    if (value?.trim()) {
      currentMeaning = { value: value.trim().slice(0, 2_000), source };
      meaning.textContent = currentMeaning.value;
      if (!saveAttempted) status.textContent = enrichmentNotice;
    } else if (!currentMeaning) {
      meaning.textContent = lookupFailed ? '暂时无法查询本地词库。' : '本地词库暂无释义。';
      if (!saveAttempted) status.textContent = enrichmentNotice || (deps.enrich ? '' : '可在侧边栏启用本地翻译，或收藏后补充释义。');
    }
    position();
  };

  const loadRich = async (capture: WordCardCapture, token: number) => {
    try {
      if (!serviceOverride && deps.getService) {
        const configured = await deps.getService();
        if (!isCurrent(token)) return;
        selectedService = configured;
        serviceButton.textContent = (TRANSLATION_SERVICES.find(item => item.value === configured)?.label ?? 'Auto') + ' ▾';
        for (const item of Array.from(menu.children)) item.setAttribute('aria-checked', String(item.getAttribute('data-service') === configured));
      }
      const result = await deps.enrich!(capture, selectedService);
      if (!isCurrent(token)) return;
      remoteReady = Boolean(result.meaning?.trim());
      clearTimeout(lookupTimer);
      waiting.hidden = true;
      panel.setAttribute('aria-busy', 'false');
      if (result.meaning?.trim()) {
        currentMeaning = { value: result.meaning.trim().slice(0, 2_000), source: result.meaningSource ?? (result.service === 'local' ? 'dictionary' : 'baidu') };
        meaning.textContent = currentMeaning.value;
      } else if (!currentMeaning) meaning.textContent = '暂无词义，可查看原句译文。';
      if (result.pronunciation) ipa.textContent = result.pronunciation;
      if (result.sentenceTranslation) {
        currentCapture = { ...currentCapture!, sentenceTranslation: result.sentenceTranslation,
          sentenceTranslationSource: result.service === 'local' ? 'browser' : 'baidu' };
      }
      details.textContent = '';
      if (result.contextMeaning) {
        const context = doc.createElement('div'); context.className = 'yemai-word-context';
        const label = doc.createElement('small'); label.textContent = '结合原句翻译';
        const sense = doc.createElement('p'); sense.textContent = result.contextMeaning;
        context.append(label, sense); details.append(context);
      }
      // Only render examples with actual provenance. The captured sentence is never a generated example.
      const examples = result.examples.slice(0, 2);
      if (capture.sentence && !examples.some(example => example.text === capture.sentence)) {
        examples.unshift({ text: capture.sentence, translation: result.sentenceTranslation, source: 'page' });
      }
      for (const example of examples.slice(0, 2)) {
        const block = doc.createElement('div'); block.className = 'yemai-word-example';
        const label = doc.createElement('small'); label.textContent = example.source === 'page' ? '当前原句' : '词典例句';
        const sentence = doc.createElement('p');
        appendHighlightedText(sentence, example.text, capture.word, example.text === capture.sentence
          ? { start: capture.highlightStart, end: capture.highlightEnd } : undefined);
        block.append(label, sentence);
        if (example.translation) {
          const translation = doc.createElement('p');
          // A generic word translation is not evidence for the word's sense in this sentence.
          if (result.contextMeaning && example.translation.includes(result.contextMeaning))
            appendHighlightedText(translation, example.translation, result.contextMeaning,
              { start: example.translation.indexOf(result.contextMeaning), end: example.translation.indexOf(result.contextMeaning) + result.contextMeaning.length });
          else translation.textContent = example.translation;
          block.append(translation);
        }
        details.append(block);
      }
      enrichmentNotice = result.notice ?? '';
      if (!saveAttempted) status.textContent = enrichmentNotice;
      position();
    } catch {
      if (!isCurrent(token)) return;
      waiting.hidden = true;
      panel.setAttribute('aria-busy', 'false');
      enrichmentNotice = '远程翻译暂不可用，保留已有释义。';
      if (!saveAttempted) status.textContent = enrichmentNotice;
      position();
    }
  };
  serviceButton.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    serviceButton.setAttribute('aria-expanded', String(!menu.hidden));
  });
  for (const service of TRANSLATION_SERVICES) {
    const option = doc.createElement('button'); option.type = 'button'; option.textContent = service.label;
    option.setAttribute('role', 'menuitemradio'); option.setAttribute('data-service', service.value);
    option.addEventListener('click', () => {
      selectedService = service.value;
      serviceOverride = true;
      menu.hidden = true; serviceButton.setAttribute('aria-expanded', 'false');
      serviceButton.textContent = service.label + ' ▾';
      for (const item of Array.from(menu.children)) item.setAttribute('aria-checked', String(item === option));
      if (!currentCapture || !deps.enrich) return;
      generation += 1;
      clearTimeout(lookupTimer); clearTimeout(saveTimer);
      const token = generation;
      remoteReady = false;
      enrichmentNotice = '';
      const capture = { ...currentCapture };
      delete capture.sentenceTranslation; delete capture.sentenceTranslationSource;
      currentCapture = capture;
      details.textContent = ''; status.textContent = ''; meaning.textContent = currentMeaning?.value ?? '正在查询释义…';
      waiting.hidden = false; saveAttempted = false; save.disabled = false; save.textContent = saveLabel(capture);
      panel.setAttribute('aria-busy', 'true');
      void loadMeaning(capture, token);
      void loadRich(capture, token);
    });
    menu.append(option);
  }
  if (deps.openSettings) {
    const settings = doc.createElement('button'); settings.type = 'button'; settings.textContent = '翻译设置';
    settings.addEventListener('click', () => { menu.hidden = true; deps.openSettings!(); }); menu.append(settings);
  }
  speak.addEventListener('click', () => {
    const token = generation;
    const text = currentCapture?.word;
    if (text && deps.speak) void Promise.resolve().then(() => deps.speak!(text)).catch(() => {
      if (isCurrent(token)) status.textContent = '暂时无法播放发音。';
    });
  });
  close.addEventListener('click', hide);
  save.addEventListener('click', onSave);
  panel.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('pointerdown', onOutsidePointerDown);
  doc.addEventListener('keydown', onEscape);
  doc.addEventListener('scroll', onScroll, true);
  view?.addEventListener('resize', hide);

  return {
    show(capture, rect) {
      if (destroyed) return;
      // Replacing the visible lookup preserves the user's newest selection, even for the same word.
      dismiss(false);
      const token = generation;
      currentCapture = { ...capture, source: { ...capture.source } };
      currentMeaning = capture.meaning?.trim()
        ? { value: capture.meaning.trim().slice(0, 2_000), source: capture.meaningSource } : null;
      rememberSelection(currentCapture);
      anchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
      saveAttempted = false;
      word.textContent = capture.word;
      speak.setAttribute('aria-label', /\s/u.test(capture.word.trim()) ? '播放表达发音' : '播放单词发音');
      ipa.textContent = '';
      details.textContent = '';
      if (currentMeaning && capture.sentence) {
        const block = doc.createElement('div'); block.className = 'yemai-word-example';
        const label = doc.createElement('small'); label.textContent = '当前原句';
        const sentence = doc.createElement('p');
        appendHighlightedText(sentence, capture.sentence, capture.word,
          { start: capture.highlightStart, end: capture.highlightEnd });
        block.append(label, sentence); details.append(block);
      }
      remoteReady = false;
      enrichmentNotice = '';
      serviceOverride = false;
      waiting.hidden = Boolean(currentMeaning);
      try {
        const selection = doc.getSelection?.();
        const node = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
        themeElement = node && 'nodeType' in node ? (node.nodeType === 1 ? node as Element : node.parentElement) : doc.body;
        refreshTheme();
        const Observer = view?.MutationObserver;
        if (Observer && themeElement) {
          themeObserver = new Observer(refreshTheme);
          for (let element: Element | null = themeElement; element; element = element.parentElement)
            themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
        }
      } catch { /* An inaccessible selection uses the stable default surface. */ }
      serviceButton.textContent = (TRANSLATION_SERVICES.find(item => item.value === selectedService)?.label ?? 'Auto') + ' ▾';
      for (const item of Array.from(menu.children)) item.setAttribute('aria-checked', String(item.getAttribute('data-service') === selectedService));
      meaning.textContent = currentMeaning?.value ?? '正在查询释义…';
      status.textContent = '';
      save.disabled = false;
      save.textContent = saveLabel(capture);
      panel.setAttribute('aria-busy', String(!currentMeaning));
      panel.hidden = false;
      refreshTheme();
      // Measure after showing; the viewport cap keeps long dictionary entries inside small windows.
      position();
      if (!currentMeaning) lookupTimer = setTimeout(() => {
        if (!isCurrent(token)) return;
        panel.setAttribute('aria-busy', 'false');
        if (!currentMeaning) meaning.textContent = '查询时间较长，可以稍后重试。';
        position();
      }, 8_000);
      // Article expressions already have a contextual meaning. Reuse it without starting
      // another translation request; choosing a service explicitly can replace it later.
      if (!currentMeaning) void loadMeaning(currentCapture, token);
      if (deps.pronunciation) void Promise.resolve().then(() => deps.pronunciation!(capture.word)).then(value => {
        if (isCurrent(token)) { ipa.textContent = value ?? ''; position(); }
      }).catch(() => {});
      if (deps.enrich && !currentMeaning) void loadRich(currentCapture, token);
    },
    hide,
    destroy() {
      if (destroyed) return;
      hide();
      destroyed = true;
      close.removeEventListener('click', hide);
      save.removeEventListener('click', onSave);
      panel.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('pointerdown', onOutsidePointerDown);
      doc.removeEventListener('keydown', onEscape);
      doc.removeEventListener('scroll', onScroll, true);
      view?.removeEventListener('resize', hide);
      panel.remove();
      style.remove();
      themeObserver?.disconnect();
      media?.removeEventListener?.('change', refreshTheme);
    },
  };
}
