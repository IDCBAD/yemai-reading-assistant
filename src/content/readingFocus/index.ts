import type { ReadingFocusAnalysis, ReadingFocusGroup } from '../../shared/readingFocus';
import type { ReadingExpression } from '../../shared/readingExpressions';
import { normalizeReadingFocusPreferences, type ReadingFocusPreferences } from '../../shared/readingFocusPreferences';
import type { PageReadingSnapshot, PageReadingTaskView } from '../../shared/pageReadingFocus';
import { validatePageReadingSnapshot } from '../../shared/pageReadingFocus';
import { normalizeSourceIdentityUrl } from '../pageManifest';
import { paragraphText, exactTextRange, validateAnalysis } from './text';
import { paragraphPalette, READING_KINDS } from './palette';

export type ReadingFocusStatus = {
  enabled: boolean;
  count: number;
  phase: 'off' | 'preparing' | 'checking' | 'ready' | 'highlighted' | 'error' | 'unsupported';
  taskId?: string;
  taskStatus?: PageReadingTaskView['status'];
  taskCreatedAt?: number;
  readyCount?: number;
  invalidCount?: number;
  message?: string;
  expressionTaskId?: string;
  expressionTaskStatus?: PageReadingTaskView['status'];
  expressionMessage?: string;
  expressionCount?: number;
};
export type ReadingFocusOptions = {
  document?: Document;
  prepare: (snapshot: PageReadingSnapshot, retry?: boolean, mode?: 'groups' | 'expressions') => Promise<PageReadingTaskView>;
  getTask: (id: string) => Promise<PageReadingTaskView>;
  stopTask: (id: string) => Promise<PageReadingTaskView>;
  onStatus?: (status: ReadingFocusStatus) => void;
  preferences?: ReadingFocusPreferences;
  onExpressions?: (items: ReadingExpression[]) => void;
  onGroupHover?: (value: { group: ReadingFocusGroup; rect: DOMRect } | null) => void;
  onExpressionClick?: (expression: ReadingExpression, occurrenceIndex: number, range: Range) => void;
  onGroupClick?: (group: ReadingFocusGroup) => void;
};

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): void };
type HighlightWindow = Window & {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: new (...ranges: Range[]) => unknown;
  MutationObserver: typeof MutationObserver;
};
// MDX documentation renderers may retain paragraph semantics on spans rather than p.
const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,dt,dd,blockquote,.mdx-content [data-as="p"],.mdx-content [data-as="li"]';
const EXCLUDED = 'nav,aside,footer,header,button,input,textarea,select,pre,script,style,noscript,[role="navigation"],[role="menu"],[role="toolbar"],[role="button"],[role="dialog"],[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[class~="advertisement"],[class~="ad"],[data-ad]';
const ROOTS = '.markdown-body,.theme-doc-markdown,.vp-doc,.sl-markdown-content,.prose,[itemprop="articleBody"],article,main,[role="main"]';

function readable(element: HTMLElement, win: Window) {
  if (element.closest(EXCLUDED)) return false;
  // Dimming a parent also dims its descendants; leave embedded controls intact.
  if (element.querySelector('button,input,textarea,select,pre,nav,aside,footer,header,[role="navigation"],[role="menu"],[role="toolbar"],[role="button"],[role="dialog"],[contenteditable]:not([contenteditable="false"])')) return false;
  // Computed visibility of ancestors matters for collapsed documentation sections.
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  const text = paragraphText(element).text;
  const words = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) ?? [];
  return text.length >= 12 && words.length >= 3
    && words.join('').length >= text.replace(/\s/gu, '').length * .45;
}

/** Select each readable text once, retaining list introductions alongside nested paragraphs. */
export function readingParagraphs(doc: Document): { root: HTMLElement | null; paragraphs: HTMLElement[] } {
  const win = doc.defaultView;
  if (!win) return { root: null, paragraphs: [] };
  let best: { root: HTMLElement; paragraphs: HTMLElement[]; score: number } | null = null;
  for (const root of doc.querySelectorAll<HTMLElement>(ROOTS)) {
    if (root.closest(EXCLUDED)) continue;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter((element) => readable(element, win));
    const paragraphs = candidates.filter((element) => !candidates.some((parent) => parent !== element && parent.contains(element)));
    const length = paragraphs.reduce((sum, element) => sum + paragraphText(element).text.length, 0);
    // Prefer a dedicated article body over a large main containing repository UI.
    const dedicated = root.matches('.markdown-body,.theme-doc-markdown,.vp-doc,.sl-markdown-content,.prose,[itemprop="articleBody"]');
    const score = (dedicated ? 1000000 : 0) + Math.min(length, 50000) * (root.matches('article') ? 1.4 : 1);
    if (paragraphs.length && (!best || score > best.score)) best = { root, paragraphs, score };
  }
  return best ?? { root: null, paragraphs: [] };
}

export function createReadingFocus(options: ReadingFocusOptions) {
  const doc = options.document ?? document;
  const win = doc.defaultView as HighlightWindow | null;
  const token = Math.random().toString(36).slice(2, 12);
  const attribute = `data-yemai-rf-${token}`;
  const highlightPrefix = `yemai-rf-${token}`;
  let active = false;
  let destroyed = false;
  let paragraphs: HTMLElement[] = [];
  let snapshot: PageReadingSnapshot | null = null;
  let current: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let pageUrl = normalizeSourceIdentityUrl(doc.URL);
  let generation = 0;
  let groupGeneration = 0;
  let expressionGeneration = 0;
  let preferences = normalizeReadingFocusPreferences(options.preferences);
  let groupsRequested = false;
  let groupRanges: Array<{ group: ReadingFocusGroup; range: Range }> = [];
  let expressions: ReadingExpression[] = [];
  let expressionRanges: Array<{ expression: ReadingExpression; occurrenceIndex: number; range: Range; element: HTMLElement }> = [];
  let expressionTask: PageReadingTaskView | null = null;
  let expressionMemory: { snapshot: PageReadingSnapshot; task: PageReadingTaskView } | null = null;
  let expressionMessage: string | undefined;
  let expressionPreparing = false;
  let expressionPollTimer: ReturnType<typeof setTimeout> | undefined;
  let expressionStyle: HTMLStyleElement | null = null;
  let ready = false;
  let sourceChanged = false;
  let task: PageReadingTaskView | null = null;
  const analyses = new Map<string, ReadingFocusAnalysis>();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let style: HTMLStyleElement | null = null;
  let paletteStyle: HTMLStyleElement | null = null;
  let paletteTimer: ReturnType<typeof setTimeout> | undefined;
  let themeMedia: MediaQueryList | undefined;
  let scan: HTMLDivElement | null = null;
  let scanPlayed = false;
  let observer: MutationObserver | null = null;
  let dragging = false;
  let status: ReadingFocusStatus = { enabled: false, count: 0, phase: 'off' };

  const publish = (phase: ReadingFocusStatus['phase'], message?: string) => {
    status = { enabled: active, count: paragraphs.length, phase,
      ...(active && task ? { taskId: task.id, taskStatus: task.status,
        ...(task.createdAt === undefined ? {} : { taskCreatedAt: task.createdAt }),
        readyCount: task.readyCount, invalidCount: task.invalidCount } : {}),
      ...(message ? { message } : {}) };
    if (active) Object.assign(status, {
      expressionCount: expressions.length,
      ...(expressionTask ? { expressionTaskId: expressionTask.id, expressionTaskStatus: expressionTask.status } : {}),
      ...(expressionMessage ? { expressionMessage } : {}),
    });
    options.onStatus?.({ ...status });
    return { ...status };
  };
  const canHighlight = () => Boolean(win?.CSS?.highlights && win.Highlight);
  const wantsGroups = () => preferences.highlightEnabled && preferences.displayMode !== 'practice';
  const hideTooltip = () => options.onGroupHover?.(null);
  const clearHighlights = () => {
    for (const kind of READING_KINDS) win?.CSS?.highlights?.delete(`${highlightPrefix}-${kind}`);
    groupRanges = [];
    hideTooltip();
  };
  const clearExpressionHighlights = () => { win?.CSS?.highlights?.delete(`${highlightPrefix}-expressions`); expressionRanges = []; };
  const republish = () => publish(status.phase, status.message);
  const neutralize = () => {
    clearHighlights();
    current = null;
    for (const paragraph of paragraphs) paragraph.setAttribute(attribute, 'idle');
  };
  const invalidateSource = () => {
    sourceChanged = true;
    ready = false;
    generation++;
    groupGeneration++;
    expressionGeneration++;
    clearTimeout(pollTimer);
    clearTimeout(expressionPollTimer);
    clearExpressionHighlights();
    expressions = [];
    options.onExpressions?.([]);
    neutralize();
    return publish('error', pageUrl !== normalizeSourceIdentityUrl(doc.URL) ? '页面已切换，请重新开启辅助阅读。' : '正文已变化，请重新开启辅助阅读。');
  };
  const render = (element: HTMLElement, result: ReadingFocusAnalysis) => {
    clearHighlights();
    if (!wantsGroups()) { publish('ready'); return; }
    if (!win?.Highlight || !win.CSS?.highlights) return;
    const palette = paragraphPalette(element, win);
    if (paletteStyle) paletteStyle.textContent = READING_KINDS.filter((kind) => palette[kind]).map((kind) => `::highlight(${highlightPrefix}-${kind}) { background-color: ${palette[kind]}; }`).join('\n');
    const index = paragraphText(element);
    if (index.text !== result.text) { invalidateSource(); return; }
    const ranges = new Map<string, Range[]>();
    for (const group of result.groups) {
      if (preferences.displayMode === 'skeleton' && !(group.isCore ?? group.kind === 'core')) continue;
      if (!palette[group.kind]) continue;
      const range = exactTextRange(doc, index, group.start, group.end);
      if (!range) continue;
      groupRanges.push({ group, range });
      const list = ranges.get(group.kind) ?? [];
      list.push(range);
      ranges.set(group.kind, list);
    }
    for (const [kind, values] of ranges) win.CSS.highlights.set(`${highlightPrefix}-${kind}`, new win.Highlight(...values));
    publish(ranges.size ? 'highlighted' : 'ready', ranges.size ? undefined : result.groups.length && !Object.values(palette).some(Boolean)
      ? '当前背景暂不适合可靠标记，仍可聚焦阅读。' : '这一段没有额外意群标记，仍可聚焦阅读。');
  };
  const activate = (element: HTMLElement) => {
    if (active && pageUrl !== normalizeSourceIdentityUrl(doc.URL)) { invalidateSource(); return; }
    if (!active || !ready || sourceChanged || dragging || doc.getSelection()?.isCollapsed === false || !paragraphs.includes(element)) return;
    const index = paragraphs.indexOf(element);
    if (snapshot?.paragraphs[index]?.text !== paragraphText(element).text) { invalidateSource(); return; }
    if (current === element) return;
    clearHighlights();
    current = element;
    for (const paragraph of paragraphs) paragraph.setAttribute(attribute, paragraph === current ? 'active' : 'dim');
    if (!wantsGroups()) { publish('ready'); return; }
    if (task && ['failed', 'stopped', 'unknown'].includes(task.status)) { publish('error', task.message || status.message); return; }
    if (!task && groupsRequested && status.phase === 'error') { publish('error', status.message); return; }
    if (!canHighlight()) { publish('unsupported', '此浏览器支持段落聚焦，暂不支持原文意群高亮。'); return; }
    const result = analyses.get(`p${index}`);
    if (result) render(element, result);
    else publish('ready', '这一段的意群结果无法准确对应原文，仍可聚焦阅读。');
  };
  const onFocus = (event: Event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    const paragraph = target.closest<HTMLElement>(`[${attribute}]`);
    if (paragraph) activate(paragraph);
  };
  const onPointerDown = (event: Event) => { hideTooltip(); if ((event as PointerEvent).button === 0) dragging = true; };
  const onPointerUp = () => { dragging = false; };
  const hitRect = (range: Range, event: MouseEvent): DOMRect | undefined => {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    return Array.from(range.getClientRects()).find((rect) => event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom);
  };
  const onPointerMove = (event: Event) => {
    if (!options.onGroupHover) return;
    if (!active || dragging || doc.getSelection()?.isCollapsed === false) { hideTooltip(); return; }
    const target = event.target as Element | null;
    if (!current?.contains(target)) { hideTooltip(); return; }
    for (const item of groupRanges) {
      const rect = hitRect(item.range, event as MouseEvent);
      if (rect) { options.onGroupHover({ group: item.group, rect }); return; }
    }
    hideTooltip();
  };
  const onExpressionClick = (event: Event) => {
    if (!active || sourceChanged || doc.getSelection()?.isCollapsed === false) return;
    const target = event.target as Element | null;
    if (!target || target.closest?.('a,button,input,textarea,select,[role="button"],[contenteditable]:not([contenteditable="false"])')) return;
    for (const item of expressionRanges) {
      if (item.element.contains(target) && hitRect(item.range, event as MouseEvent)) {
        // This callback never cancels page events or changes the user's selection.
        options.onExpressionClick?.(item.expression, item.occurrenceIndex, item.range);
        return;
      }
    }
    if (options.onGroupClick) {
      for (const item of groupRanges) {
        if (current?.contains(target) && hitRect(item.range, event as MouseEvent)) {
          options.onGroupClick(item.group);
          return;
        }
      }
    }
  };
  const expressionRange = (expression: ReadingExpression, occurrenceIndex: number): { element: HTMLElement; range: Range } | null => {
    const occurrence = expression.occurrences[occurrenceIndex];
    if (!occurrence || !snapshot) return null;
    const index = snapshot.paragraphs.findIndex(({ id }) => id === occurrence.paragraphId);
    const element = paragraphs[index];
    if (!element) return null;
    const source = snapshot.paragraphs[index]!.text;
    const actual = paragraphText(element);
    if (actual.text !== source) { invalidateSource(); return null; }
    if (!Number.isInteger(occurrence.start) || !Number.isInteger(occurrence.end)
      || occurrence.start < 0 || occurrence.end <= occurrence.start || occurrence.end > source.length
      || source.slice(occurrence.start, occurrence.end) !== occurrence.text) return null;
    // Card highlight offsets belong to its normalized sentence; DOM uses paragraph offsets.
    const range = exactTextRange(doc, actual, occurrence.start, occurrence.end);
    return range ? { element, range } : null;
  };
  const renderExpressions = () => {
    clearExpressionHighlights();
    if (!active || sourceChanged || !preferences.expressionEnabled || !win?.Highlight || !win.CSS?.highlights) return;
    for (const expression of expressions) {
      expression.occurrences.forEach((_, occurrenceIndex) => {
        const value = expressionRange(expression, occurrenceIndex);
        if (value) expressionRanges.push({ expression, occurrenceIndex, range: value.range, element: value.element });
      });
      if (sourceChanged) return;
    }
    if (expressionRanges.length) win.CSS.highlights.set(`${highlightPrefix}-expressions`, new win.Highlight(...expressionRanges.map(({ range }) => range)));
  };
  const acceptExpressionTask = (value: PageReadingTaskView, version: number, life: number) => {
    if (!active || life !== generation || version !== expressionGeneration || sourceChanged) return;
    refresh();
    if (sourceChanged) return;
    expressionTask = value;
    expressionPreparing = false;
    clearTimeout(expressionPollTimer);
    expressionMessage = value.message;
    if (value.status === 'ready') {
      // The shared parser validates data; validate positions again against current DOM.
      const candidates = value.result?.expressions ?? [];
      const ids = new Set<string>();
      expressions = candidates.filter((item) => {
        if (!item || typeof item.id !== 'string' || ids.has(item.id) || !Array.isArray(item.occurrences) || !item.occurrences.length) return false;
        ids.add(item.id);
        return item.occurrences.every((_, index) => expressionRange(item, index));
      });
      options.onExpressions?.([...expressions]);
      expressionMessage = expressions.length ? undefined : '未识别到可准确定位的固定搭配。';
      renderExpressions();
    } else if (['failed', 'stopped', 'unknown'].includes(value.status)) {
      expressionMessage ||= value.status === 'unknown' ? '搭配分析状态不明，暂不重复提交。' : value.status === 'stopped' ? '搭配分析已停止。' : '搭配分析失败，仍可正常阅读。';
    } else {
      expressionPollTimer = setTimeout(() => {
        if (!active || life !== generation || version !== expressionGeneration) return;
        options.getTask(value.id).then((next) => acceptExpressionTask(next, version, life)).catch((error: unknown) => {
          if (!active || life !== generation || version !== expressionGeneration) return;
          expressionTask = { ...value, status: 'unknown' };
          expressionMessage = error instanceof Error ? error.message : '无法读取搭配分析状态，暂不重复提交。';
          republish();
        });
      }, 1000);
    }
    republish();
  };
  const scanExpressions = (retry = false) => {
    if (!active || !snapshot || sourceChanged || expressionPreparing) return { ...status };
    if (expressionTask && (!retry || !['failed', 'stopped'].includes(expressionTask.status))) return { ...status };
    try { validatePageReadingSnapshot(snapshot); }
    catch (error) { expressionMessage = error instanceof Error ? error.message : '当前文章暂不支持完整搭配分析。'; return republish(); }
    const version = ++expressionGeneration;
    const life = generation;
    const input = snapshot;
    expressionPreparing = true;
    expressionMessage = '正在准备全文搭配分析…';
    if (expressionTask) expressionTask = { ...expressionTask, status: 'preparing' };
    republish();
    Promise.resolve().then(() => options.prepare(input, retry, 'expressions')).then((value) => acceptExpressionTask(value, version, life)).catch((error: unknown) => {
      if (!active || life !== generation || version !== expressionGeneration) return;
      expressionPreparing = false;
      if (expressionTask) expressionTask = { ...expressionTask, status: 'unknown' };
      expressionMessage = error instanceof Error ? error.message : '无法准备搭配分析。';
      republish();
    });
    return { ...status };
  };
  const onTheme = () => {
    clearTimeout(paletteTimer);
    paletteTimer = setTimeout(() => {
      if (!active || !ready || !current || sourceChanged) return;
      const index = paragraphs.indexOf(current);
      const result = analyses.get(`p${index}`);
      if (result) render(current, result);
    }, 100);
  };
  const removeScan = () => { clearTimeout(scanTimer); scan?.remove(); scan = null; };
  const playScan = () => {
    if (!active || scanPlayed || !root || !win || !wantsGroups()) return;
    scanPlayed = true;
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rect = root.getBoundingClientRect();
    const top = Math.max(0, rect.top);
    const left = Math.max(0, rect.left);
    const width = Math.min(win.innerWidth, rect.right) - left;
    const height = Math.min(win.innerHeight, rect.bottom) - top;
    if (width > 0 && height > 0) {
      scan = doc.createElement('div');
      scan.setAttribute(attribute, 'scan');
      scan.setAttribute('aria-hidden', 'true');
      Object.assign(scan.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` });
      (doc.body ?? doc.documentElement).append(scan);
      scanTimer = setTimeout(removeScan, 800);
    }
  };
  const refresh = (): ReadingFocusStatus => {
    if (!active || !win || sourceChanged) return { ...status };
    if (pageUrl !== normalizeSourceIdentityUrl(doc.URL)) return invalidateSource();
    const found = readingParagraphs(doc);
    if (!snapshot || found.paragraphs.length !== snapshot.paragraphs.length
      || found.paragraphs.some((element, index) => paragraphText(element).text !== snapshot!.paragraphs[index]!.text)) return invalidateSource();
    const currentIndex = current ? paragraphs.indexOf(current) : -1;
    for (const paragraph of paragraphs) if (!found.paragraphs.includes(paragraph)) paragraph.removeAttribute(attribute);
    paragraphs = found.paragraphs;
    root = found.root;
    current = currentIndex >= 0 ? paragraphs[currentIndex]! : null;
    for (const paragraph of paragraphs) paragraph.setAttribute(attribute, current ? paragraph === current ? 'active' : 'dim' : 'idle');
    // Identical text in new framework nodes can reuse pure data, never old Ranges.
    const result = currentIndex >= 0 ? analyses.get(`p${currentIndex}`) : undefined;
    if (ready && current && result) render(current, result);
    renderExpressions();
    return { ...status };
  };
  const acceptTask = (value: PageReadingTaskView, version: number) => {
    if (!active || version !== groupGeneration || sourceChanged) return;
    refresh();
    if (sourceChanged || version !== groupGeneration) return;
    task = value;
    clearTimeout(pollTimer);
    if (value.status === 'ready') {
      removeScan();
      if (!value.result) { ready = true; publish('error', '文章分析未返回可用结果。'); return; }
      publish('checking');
      analyses.clear();
      const seen = new Set<string>();
      const duplicated = new Set<string>();
      for (const entry of value.result.paragraphs) {
        if (seen.has(entry.id)) duplicated.add(entry.id);
        seen.add(entry.id);
      }
      for (const entry of value.result.paragraphs) {
        const original = snapshot?.paragraphs.find(({ id }) => id === entry.id);
        const checked = original && entry.status === 'ready' && !duplicated.has(entry.id) ? validateAnalysis(original.text, entry) : null;
        if (checked) analyses.set(entry.id, checked);
      }
      task = { ...value, readyCount: analyses.size, invalidCount: paragraphs.length - analyses.size };
      ready = true;
      publish('ready', task.invalidCount ? `已准备 ${task.readyCount}/${paragraphs.length} 段，其余段落仅提供聚焦。` : undefined);
    } else if (['failed', 'stopped', 'unknown'].includes(value.status)) {
      removeScan();
      ready = true;
      neutralize();
      publish('error', value.message || (value.status === 'unknown' ? '分析状态不明，请先检查原任务，暂不重复提交。' : value.status === 'stopped' ? '文章分析已停止。' : '文章分析失败。'));
    } else {
      if (value.status !== 'stopping') playScan();
      ready = !wantsGroups();
      neutralize();
      publish(value.status === 'checking' ? 'checking' : 'preparing', value.message);
      pollTimer = setTimeout(() => {
        if (!active || version !== groupGeneration) return;
        options.getTask(value.id).then((next) => acceptTask(next, version)).catch((error: unknown) => {
          if (!active || version !== groupGeneration) return;
          task = { ...value, status: 'unknown' };
          ready = true;
          publish('error', error instanceof Error ? error.message : '无法读取分析状态，任务可能仍在后台继续。');
        });
      }, 1000);
    }
  };
  const prepare = (retry = false) => {
    if (!snapshot || !active || sourceChanged) return;
    const version = groupGeneration;
    const input = snapshot;
    if (retry && task) task = { ...task, status: 'preparing', createdAt: undefined };
    groupsRequested = true;
    ready = !wantsGroups();
    neutralize();
    publish('preparing');
    // Exiting invalidates only this UI subscriber, never the background task.
    Promise.resolve().then(() => options.prepare(input, retry)).then((value) => acceptTask(value, version)).catch((error: unknown) => {
      if (!active || version !== groupGeneration) return;
      if (task) task = { ...task, status: 'unknown' };
      ready = true;
      publish('error', error instanceof Error ? error.message : '无法准备文章分析，已有任务可能仍在后台继续。');
    });
  };
  const onMutation = (records: MutationRecord[]) => {
    if (!active || sourceChanged || !records.some((record) => {
      if (record.target === style || record.target === paletteStyle || record.target === expressionStyle || record.target === scan || scan?.contains(record.target)) return false;
      if (record.type === 'attributes' && record.attributeName === attribute) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node === style || node === paletteStyle || node === expressionStyle || node === scan)) return false;
      if (pageUrl === normalizeSourceIdentityUrl(doc.URL) && root && !root.contains(record.target) && !(record.target as Element).contains?.(root)) return false;
      return true;
    })) return;
    // A changed original must lose its color immediately, before rediscovery.
    if (pageUrl !== normalizeSourceIdentityUrl(doc.URL) || paragraphs.some((element, index) => paragraphText(element).text !== snapshot?.paragraphs[index]?.text)) { invalidateSource(); return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 100);
  };
  const onNavigation = () => { if (active) refresh(); };
  const restoreExpressions = () => {
    if (!expressionMemory || !snapshot
      || normalizeSourceIdentityUrl(expressionMemory.snapshot.url) !== normalizeSourceIdentityUrl(snapshot.url)
      || expressionMemory.snapshot.paragraphs.length !== snapshot.paragraphs.length
      || expressionMemory.snapshot.paragraphs.some((item, index) => item.id !== snapshot!.paragraphs[index]?.id || item.text !== snapshot!.paragraphs[index]?.text)) return false;
    acceptExpressionTask(expressionMemory.task, expressionGeneration, generation);
    return true;
  };
  const enable = (): ReadingFocusStatus => {
    if (destroyed || !win || active) return { ...status };
    active = true;
    generation++;
    groupGeneration++;
    expressionGeneration++;
    pageUrl = normalizeSourceIdentityUrl(doc.URL);
    sourceChanged = false;
    scanPlayed = false;
    task = null;
    expressionTask = null;
    expressionMessage = undefined;
    expressionPreparing = false;
    expressions = [];
    groupsRequested = false;
    options.onExpressions?.([]);
    ready = false;
    analyses.clear();
    const found = readingParagraphs(doc);
    root = found.root;
    paragraphs = found.paragraphs;
    if (!paragraphs.length) return publish('unsupported', '没有找到适合辅助阅读的英文正文。');
    snapshot = { url: doc.URL, title: doc.title || '', paragraphs: paragraphs.map((element, index) => ({ id: `p${index}`, text: paragraphText(element).text })) };
    style = doc.createElement('style');
    style.textContent = `
      [${attribute}] { transition: opacity 150ms ease, background-color 150ms ease; }
      [${attribute}="dim"] { opacity: ${preferences.dimOpacity} !important; }
      @keyframes ${highlightPrefix}-scan { from { transform: translateY(-100%); opacity: 0; } 20% { opacity: .8; } 80% { opacity: .6; } to { transform: translateY(100%); opacity: 0; } }
      [${attribute}="scan"] { position: fixed; overflow: hidden; pointer-events: none; z-index: 2147483000; }
      [${attribute}="scan"]::before { content: ''; position:absolute; inset:0; background:linear-gradient(180deg, transparent 40%, rgba(110,175,235,.10) 48%, rgba(140,193,238,.3) 50%, transparent 54%); animation:${highlightPrefix}-scan 720ms ease-in-out both; }
      @media (prefers-reduced-motion: reduce) { [${attribute}] { transition: none; } [${attribute}="scan"] { display: none; } }
    `;
    (doc.head ?? doc.documentElement).append(style);
    paletteStyle = doc.createElement('style');
    (doc.head ?? doc.documentElement).append(paletteStyle);
    expressionStyle = doc.createElement('style');
    expressionStyle.textContent = `::highlight(${highlightPrefix}-expressions) { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: currentColor; text-decoration-thickness: 1px; text-underline-offset: 3px; }`;
    (doc.head ?? doc.documentElement).append(expressionStyle);
    for (const paragraph of paragraphs) paragraph.setAttribute(attribute, 'idle');
    doc.addEventListener('pointerover', onFocus, true);
    doc.addEventListener('focusin', onFocus, true);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);
    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('click', onExpressionClick, true);
    doc.addEventListener('selectionchange', hideTooltip);
    win.addEventListener('scroll', hideTooltip, true);
    win.addEventListener('blur', onPointerUp);
    win.addEventListener('popstate', onNavigation);
    win.addEventListener('hashchange', onNavigation);
    win.addEventListener('resize', onTheme);
    themeMedia = win.matchMedia?.('(prefers-color-scheme: dark)');
    themeMedia?.addEventListener?.('change', onTheme);
    observer = new win.MutationObserver(onMutation);
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'contenteditable', 'data-theme', 'data-color-mode', 'data-bs-theme', 'data-mode'] });
    if (!canHighlight()) {
      ready = true;
      publish('unsupported', '此浏览器支持段落聚焦，暂不支持原文意群高亮。');
      if (!restoreExpressions() && preferences.autoScanExpressions) scanExpressions();
      return { ...status };
    }
    try { validatePageReadingSnapshot(snapshot); }
    catch (error) { ready = true; return publish('error', error instanceof Error ? error.message : '当前文章暂不支持完整分析。'); }
    if (wantsGroups()) prepare();
    else { ready = true; publish('ready'); }
    if (!restoreExpressions() && preferences.autoScanExpressions) scanExpressions();
    return { ...status };
  };
  const disable = (): ReadingFocusStatus => {
    if (!active) return { ...status };
    if (!sourceChanged && snapshot && expressionTask) expressionMemory = { snapshot, task: expressionTask };
    active = false;
    generation++;
    groupGeneration++;
    expressionGeneration++;
    ready = false;
    clearTimeout(pollTimer);
    clearTimeout(expressionPollTimer);
    clearHighlights();
    clearExpressionHighlights();
    clearTimeout(refreshTimer);
    clearTimeout(paletteTimer);
    removeScan();
    observer?.disconnect();
    observer = null;
    doc.removeEventListener('pointerover', onFocus, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);
    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('click', onExpressionClick, true);
    doc.removeEventListener('selectionchange', hideTooltip);
    win?.removeEventListener('scroll', hideTooltip, true);
    win?.removeEventListener('blur', onPointerUp);
    win?.removeEventListener('popstate', onNavigation);
    win?.removeEventListener('hashchange', onNavigation);
    win?.removeEventListener('resize', onTheme);
    themeMedia?.removeEventListener?.('change', onTheme);
    themeMedia = undefined;
    for (const paragraph of paragraphs) paragraph.removeAttribute(attribute);
    paragraphs = [];
    root = null;
    current = null;
    dragging = false;
    style?.remove();
    style = null;
    paletteStyle?.remove();
    paletteStyle = null;
    expressionStyle?.remove();
    expressionStyle = null;
    expressions = [];
    options.onExpressions?.([]);
    analyses.clear();
    return publish('off');
  };
  return {
    enable, disable, refresh, scanExpressions,
    getExpressionRange(id: string, occurrenceIndex: number): Range | null {
      if (!active || sourceChanged || !refresh().enabled) return null;
      const expression = expressions.find(item => item.id === id);
      return expression ? expressionRange(expression, occurrenceIndex)?.range ?? null : null;
    },
    setPreferences(value: ReadingFocusPreferences) {
      preferences = normalizeReadingFocusPreferences(value);
      if (!active || sourceChanged) return { ...status };
      if (style) style.textContent = style.textContent!.replace(/opacity: [\d.]+ !important;/, `opacity: ${preferences.dimOpacity} !important;`);
      if (!wantsGroups()) { ready = true; clearHighlights(); publish('ready'); }
      else if (!groupsRequested && canHighlight()) prepare();
      else {
        if (task && !['ready', 'failed', 'stopped', 'unknown'].includes(task.status)) {
          ready = false;
          neutralize();
          publish(task.status === 'checking' ? 'checking' : 'preparing', task.message);
        }
        if (current && ready) {
          const result = analyses.get(`p${paragraphs.indexOf(current)}`);
          if (result) render(current, result);
        }
      }
      renderExpressions();
      return { ...status };
    },
    locateExpression(id: string, occurrenceIndex: number): Range | null {
      if (!active || sourceChanged || !refresh().enabled) return null;
      const expression = expressions.find((item) => item.id === id);
      if (!expression) return null;
      const value = expressionRange(expression, occurrenceIndex);
      if (!value || sourceChanged) return null;
      // Lookup popovers consume the returned geometry immediately after this call.
      value.element.scrollIntoView?.({ behavior: 'instant', block: 'center' });
      // Explicit list navigation also works while an independent group task is pending.
      const wasReady = ready;
      ready = true;
      activate(value.element);
      ready = wasReady;
      return value.range;
    },
    async stopExpressions() {
      if (!active || !expressionTask || sourceChanged || ['ready', 'failed', 'stopped'].includes(expressionTask.status)) return { ...status };
      const version = ++expressionGeneration;
      const life = generation;
      clearTimeout(expressionPollTimer);
      expressionTask = { ...expressionTask, status: 'stopping' };
      expressionMessage = '正在停止搭配分析…';
      republish();
      try { acceptExpressionTask(await options.stopTask(expressionTask.id), version, life); }
      catch (error) {
        if (active && life === generation && version === expressionGeneration) {
          expressionTask = { ...expressionTask!, status: 'unknown' };
          expressionMessage = error instanceof Error ? error.message : '停止搭配分析的状态不明。';
          republish();
        }
      }
      return { ...status };
    },
    async stop() {
      if (!active || !task || sourceChanged || ['ready', 'failed', 'stopped'].includes(task.status)) return { ...status };
      const version = ++groupGeneration;
      clearTimeout(pollTimer);
      ready = false;
      neutralize();
      task = { ...task, status: 'stopping' };
      removeScan();
      publish('preparing', '正在停止文章分析…');
      try { acceptTask(await options.stopTask(task.id), version); }
      catch (error) {
        if (active && version === groupGeneration) {
          task = { ...task!, status: 'unknown' };
          ready = true;
          publish('error', error instanceof Error ? error.message : '停止状态不明，请检查原任务。');
        }
      }
      return { ...status };
    },
    async retry() {
      if (!active || sourceChanged || status.phase !== 'error'
        || (task && !['failed', 'stopped'].includes(task.status))) return { ...status };
      groupGeneration++;
      clearTimeout(pollTimer);
      prepare(true);
      return { ...status };
    },
    destroy() { disable(); destroyed = true; },
    get enabled() { return active; },
    get expressions() { return [...expressions]; },
  };
}
