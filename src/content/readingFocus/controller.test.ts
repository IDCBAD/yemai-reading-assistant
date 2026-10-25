import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadingFocus, readingParagraphs } from './index';
import type { ReadingFocusAnalysis } from '../../shared/readingFocus';
import type { PageReadingSnapshot, PageReadingTaskView } from '../../shared/pageReadingFocus';
import { DEFAULT_READING_FOCUS_PREFERENCES } from '../../shared/readingFocusPreferences';
import type { ReadingExpression } from '../../shared/readingExpressions';

// Minimal DOM adapter: the controller's lifecycle and actual Range calculations run
// unchanged. CSS selector and layout support are verified separately in Chromium.
class ElementStub {
  readonly nodeType = 1;
  readonly attributes = new Map<string, string>();
  parentElement: ElementStub | null = null;
  childNodes: Array<ElementStub | TextStub> = [];
  style = {};
  isConnected = true;
  constructor(readonly tagName: string) {}
  append(...nodes: Array<ElementStub | TextStub>) { for (const node of nodes) { node.parentElement = this; this.childNodes.push(node); } }
  get textContent(): string { return this.childNodes.map((node) => node.textContent).join(''); }
  set textContent(value: string) { this.childNodes = []; this.append(new TextStub(value)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  matches(selector: string): boolean {
    if (selector === 'article') return this.tagName === 'ARTICLE';
    if (selector.includes('script,style,noscript,button')) return ['BUTTON', 'SCRIPT', 'STYLE'].includes(this.tagName);
    return false;
  }
  closest(selector: string): ElementStub | null {
    if (selector.startsWith('a,button') && this.tagName === 'A') return this;
    if (selector.startsWith('[data-yemai-rf-')) {
      const key = selector.slice(1, -1);
      return this.attributes.has(key) ? this : this.parentElement?.closest(selector) ?? null;
    }
    return null;
  }
  querySelector(selector: string): ElementStub | null {
    const tags = selector.split(',').filter((part) => !part.startsWith('[')).map((part) => part.toUpperCase());
    for (const child of this.childNodes) {
      if (!(child instanceof ElementStub)) continue;
      if (tags.includes(child.tagName)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(): ElementStub[] {
    return this.childNodes.flatMap((node) => node instanceof ElementStub
      ? [...(['P', 'LI', 'H2'].includes(node.tagName) ? [node] : []), ...node.querySelectorAll()]
      : []);
  }
  contains(other: unknown): boolean { return this === other || this.childNodes.some((node) => node instanceof ElementStub ? node.contains(other) : node === other); }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0 }; }
  remove() {
    if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((node) => node !== this);
    this.isConnected = false;
  }
}
class TextStub {
  readonly nodeType = 3;
  parentElement: ElementStub | null = null;
  constructor(public textContent: string) {}
  get childNodes() { return []; }
}

function fixture(highlightsSupported = true) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const addEventListener = (type: string, fn: (event: Event) => void) => {
    const callbacks = listeners.get(type) ?? new Set(); callbacks.add(fn); listeners.set(type, callbacks);
  };
  const removeEventListener = (type: string, fn: (event: Event) => void) => { listeners.get(type)?.delete(fn); };
  const html = new ElementStub('HTML');
  const head = new ElementStub('HEAD');
  const body = new ElementStub('BODY');
  const article = new ElementStub('ARTICLE');
  const first = new ElementStub('P'); first.textContent = 'Use a script if there is no suitable API.';
  const second = new ElementStub('P'); second.textContent = 'Read the second paragraph for more information.';
  first.setAttribute('style', 'color: red; opacity: 0.8');
  article.append(first, second); body.append(article); html.append(head, body);
  const highlights = new Map();
  let mutationCallback: ((records: MutationRecord[]) => void) | undefined;
  let disconnected = false;
  let collapsed = true;
  let darkTheme = false;
  const doc = {
    URL: 'https://example.com/article', head, body, documentElement: html,
    defaultView: {
      CSS: highlightsSupported ? { highlights } : undefined,
      Highlight: class { constructor(..._ranges: unknown[]) {} },
      MutationObserver: class {
        constructor(fn: (records: MutationRecord[]) => void) { mutationCallback = fn; }
        observe() {}
        disconnect() { disconnected = true; }
      },
      addEventListener, removeEventListener,
      getComputedStyle: (element: ElementStub) => ({ display: 'block', visibility: 'visible',
        color: darkTheme ? 'rgb(255,255,255)' : 'rgb(32,32,32)',
        backgroundColor: element === html ? darkTheme ? 'rgb(0,0,0)' : 'rgb(255,255,255)' : 'transparent' }),
      matchMedia: () => ({ matches: true }),
    },
    addEventListener, removeEventListener,
    querySelectorAll: () => [article],
    createElement: (tag: string) => new ElementStub(tag.toUpperCase()),
    getSelection: () => ({ isCollapsed: collapsed }),
    createRange: () => {
      let firstNode: TextStub; let lastNode: TextStub; let start = 0; let end = 0;
      return {
        setStart(node: TextStub, offset: number) { firstNode = node; start = offset; },
        setEnd(node: TextStub, offset: number) { lastNode = node; end = offset; },
        toString() { return firstNode === lastNode ? firstNode.textContent.slice(start, end) : ''; },
        getClientRects() { return [{ left: 10, right: 50, top: 10, bottom: 30 }]; },
      };
    },
  };
  const dispatch = (type: string, target = first, extra = {}) => {
    listeners.get(type)?.forEach((listener) => listener({ target, ...extra } as unknown as Event));
  };
  const mutate = () => mutationCallback?.([{ target: first.childNodes[0], type: 'characterData', addedNodes: [], removedNodes: [] } as unknown as MutationRecord]);
  return { doc: doc as unknown as Document, rawDoc: doc, article, first, second, head, highlights, dispatch, mutate,
    setSelection(value: boolean) { collapsed = value; },
    setTheme(dark: boolean) {
      darkTheme = dark;
      mutationCallback?.([{ target: body, type: 'attributes', attributeName: 'class', addedNodes: [], removedNodes: [] } as unknown as MutationRecord]);
    },
    get listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); },
    get disconnected() { return disconnected; },
  };
}
const result = (text: string): ReadingFocusAnalysis => ({ text, groups: [{ text: text.slice(0, 12), start: 0, end: 12, kind: 'core' }] });
const attr = (element: ElementStub) => [...element.attributes.keys()].find((key) => key.startsWith('data-yemai-rf-'))!;

afterEach(() => vi.useRealTimers());

describe('reading focus controller lifecycle', () => {
  it('keeps the original task start across polls and reentry, without scanning a ready cache', async () => {
    vi.useFakeTimers();
    const page = fixture();
    Object.assign(page.rawDoc.defaultView, { innerWidth: 800, innerHeight: 600, matchMedia: () => ({ matches: false }) });
    page.article.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 600 });
    const scans = () => page.rawDoc.body.childNodes.filter(node => node instanceof ElementStub && [...node.attributes.values()].includes('scan'));
    let snapshot!: PageReadingSnapshot;
    const createdAt = Date.now() - 12_000;
    const prepare = vi.fn(async (input: PageReadingSnapshot) => { snapshot = input; return { ...pendingView(), createdAt }; });
    const getTask = vi.fn(async () => ({ ...pendingView(), createdAt }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask: vi.fn() });
    focus.enable();
    expect(scans()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(scans()).toHaveLength(1);
    expect(focus.refresh()).toMatchObject({ taskCreatedAt: createdAt, taskStatus: 'analyzing' });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(scans()).toHaveLength(0);
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(focus.refresh().taskCreatedAt).toBe(createdAt);
    focus.disable();
    prepare.mockImplementationOnce(async () => ({ ...readyView(snapshot), createdAt }));
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh()).toMatchObject({ phase: 'ready', taskCreatedAt: createdAt });
    expect(scans()).toHaveLength(0);
    focus.disable();
    expect(page.rawDoc.body.childNodes).toEqual([page.article]);
    expect(page.head.childNodes).toHaveLength(0);
  });

  it('cleans up a pending scan immediately on exit and never scans stopped or uncertain tasks', async () => {
    vi.useFakeTimers();
    const page = fixture();
    Object.assign(page.rawDoc.defaultView, { innerWidth: 800, innerHeight: 600, matchMedia: () => ({ matches: false }) });
    page.article.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 600 });
    const scans = () => page.rawDoc.body.childNodes.filter(node => node instanceof ElementStub && [...node.attributes.values()].includes('scan'));
    const prepare = vi.fn(async (_input: PageReadingSnapshot) => pendingView());
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(scans()).toHaveLength(1);
    focus.disable(); expect(scans()).toHaveLength(0);
    for (const status of ['unknown', 'stopped', 'stopping'] as const) {
      prepare.mockImplementationOnce(async () => ({ ...pendingView(), status }));
      focus.enable(); await vi.advanceTimersByTimeAsync(0);
      expect(scans()).toHaveLength(0);
      focus.disable();
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(page.rawDoc.body.childNodes).toEqual([page.article]);
    expect(page.listenerCount).toBe(0);
  });

  it('uses the new attempt start after an explicit retry rather than the failed attempt time', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const oldStart = Date.now() - 60_000;
    const newStart = Date.now();
    let resolveRetry!: (task: PageReadingTaskView) => void;
    const prepare = vi.fn((_input: PageReadingSnapshot, retry?: boolean) => retry
      ? new Promise<PageReadingTaskView>(resolve => { resolveRetry = resolve; })
      : Promise.resolve({ ...pendingView(), status: 'failed' as const, createdAt: oldStart }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh().taskCreatedAt).toBe(oldStart);
    void focus.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh().taskCreatedAt).toBeUndefined();
    resolveRetry({ ...pendingView(), createdAt: newStart });
    await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh()).toMatchObject({ taskStatus: 'analyzing', taskCreatedAt: newStart });
    expect(prepare).toHaveBeenCalledTimes(2);
    focus.disable();
  });

  it('repaints the current paragraph for page theme and resize changes without model requests', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    page.dispatch('pointerover');
    const paletteStyle = page.head.childNodes[1]!;
    const lightRules = paletteStyle.textContent;
    expect(lightRules).toContain('::highlight(');
    page.setTheme(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(paletteStyle.textContent).not.toEqual(lightRules);
    expect(page.highlights.size).toBe(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    page.dispatch('resize');
    focus.disable();
    await vi.advanceTimersByTimeAsync(100);
    expect(page.head.childNodes).toHaveLength(0);
    expect(page.highlights.size).toBe(0);
    expect(page.listenerCount).toBe(0);
  });
  it('excludes composite list blocks with code or navigation but keeps independent child paragraphs and inline code', () => {
    const page = fixture();
    const listItem = new ElementStub('LI');
    listItem.append(new TextStub('Use these steps to continue:'));
    const codeBlock = new ElementStub('PRE'); codeBlock.textContent = 'npm install your package here';
    listItem.append(codeBlock);
    const independentParagraph = new ElementStub('P'); independentParagraph.textContent = 'Read this independent explanation before continuing.';
    listItem.append(independentParagraph);
    const navigationItem = new ElementStub('LI');
    navigationItem.append(new TextStub('Browse the following documentation pages:'));
    const nav = new ElementStub('NAV'); nav.textContent = 'Previous page and next page'; navigationItem.append(nav);
    const inlineCode = new ElementStub('P');
    inlineCode.append(new TextStub('Call the '));
    const code = new ElementStub('CODE'); code.textContent = 'run';
    inlineCode.append(code, new TextStub(' function to continue reading.'));
    page.article.append(listItem, navigationItem, inlineCode);
    const found = readingParagraphs(page.doc).paragraphs;
    expect(found).not.toContain(listItem);
    expect(found).not.toContain(navigationItem);
    expect(found).toContain(independentParagraph);
    expect(found).toContain(inlineCode);
  });
  it('keeps list introductions and nested prose exactly once', () => {
    const page = fixture();
    const item = new ElementStub('LI');
    item.append(new TextStub('Read the introduction before these details. '));
    const nested = new ElementStub('P'); nested.textContent = 'These independent details explain the first step.';
    item.append(nested); page.article.append(item);
    const found = readingParagraphs(page.doc).paragraphs;
    expect(found).toContain(item);
    expect(found).not.toContain(nested);
    expect(item.textContent).toBe('Read the introduction before these details. These independent details explain the first step.');
  });
  it('prepares once before interaction, then switches locally and restores the page on exit', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const getTask = vi.fn(); const stopTask = vi.fn();
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask });
    expect(focus.enable()).toMatchObject({ enabled: true, count: 2, phase: 'preparing' });
    const key = attr(page.first);
    page.dispatch('pointerover');
    expect(page.first.getAttribute(key)).toBe('idle');
    expect(page.second.getAttribute(key)).toBe('idle');
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0].paragraphs.map(({ id }) => id)).toEqual(['p0', 'p1']);
    page.dispatch('pointerover');
    expect(page.first.getAttribute(key)).toBe('active');
    expect(page.second.getAttribute(key)).toBe('dim');
    expect(page.highlights.size).toBe(1);
    page.dispatch('pointerover', page.second);
    page.dispatch('pointerover');
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(getTask).not.toHaveBeenCalled();
    expect(focus.disable()).toMatchObject({ enabled: false, count: 0, phase: 'off' });
    expect(stopTask).not.toHaveBeenCalled();
    expect(page.first.getAttribute(key)).toBeNull();
    expect(page.first.getAttribute('style')).toBe('color: red; opacity: 0.8');
    expect(page.first.textContent).toBe('Use a script if there is no suitable API.');
    expect(page.head.childNodes).toHaveLength(0);
    expect(page.listenerCount).toBe(0);
    expect(page.disconnected).toBe(true);
    expect(page.highlights.size).toBe(0);
  });
  it('polls a single background task, never starts tasks on hover, and reuses a prepared result after exit', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let snapshot!: PageReadingSnapshot;
    const prepare = vi.fn(async (input: PageReadingSnapshot) => { snapshot = input; return pendingView(); });
    const getTask = vi.fn(async () => readyView(snapshot));
    const stopTask = vi.fn();
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask });
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 15; i++) page.dispatch('pointerover', i % 2 ? page.first : page.second);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(page.second.getAttribute(attr(page.second))).toBe('idle');
    await vi.advanceTimersByTimeAsync(1000);
    expect(getTask).toHaveBeenCalledExactlyOnceWith('article-task');
    page.dispatch('pointerover');
    expect(page.highlights.size).toBe(1);
    focus.disable();
    prepare.mockImplementationOnce(async () => readyView(snapshot));
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    page.dispatch('pointerover');
    expect(page.highlights.size).toBe(1);
    expect(stopTask).not.toHaveBeenCalled();
    focus.disable();
  });
  it('does not stop or render a late prepare response after immediate exit', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let complete!: (value: PageReadingTaskView) => void;
    let input!: PageReadingSnapshot;
    const prepare = vi.fn((snapshot: PageReadingSnapshot) => { input = snapshot; return new Promise<PageReadingTaskView>((resolve) => { complete = resolve; }); });
    const getTask = vi.fn(); const stopTask = vi.fn();
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask });
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    focus.disable();
    complete(readyView(input));
    await vi.advanceTimersByTimeAsync(2000);
    expect(stopTask).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(page.highlights.size).toBe(0);
    expect(page.head.childNodes).toHaveLength(0);
  });
  it('stops only on explicit action and retries only confirmed failed or stopped tasks', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (_snapshot: PageReadingSnapshot, _retry?: boolean) => pendingView());
    const getTask = vi.fn(async () => pendingView());
    const stopTask = vi.fn(async () => ({ ...pendingView(), status: 'stopped' as const }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask });
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    await focus.retry();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await focus.stop()).toMatchObject({ phase: 'error', taskStatus: 'stopped' });
    expect(stopTask).toHaveBeenCalledExactlyOnceWith('article-task');
    await focus.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[1]).toBe(true);
    focus.disable();
  });
  it('rejects an oversized paragraph without silently dropping its source or submitting a partial article', async () => {
    vi.useFakeTimers();
    const page = fixture();
    page.first.textContent = 'Read this entire English paragraph carefully. '.repeat(400);
    const prepare = vi.fn();
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    expect(readingParagraphs(page.doc).paragraphs).toHaveLength(2);
    expect(focus.enable()).toMatchObject({ phase: 'error', message: '单个段落超过 16000 字符，暂不支持完整分析。' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(prepare).not.toHaveBeenCalled();
    focus.disable();
  });
  it('does not multiply a retry while preparation is still in flight', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (_snapshot: PageReadingSnapshot, _retry?: boolean) => ({ ...pendingView(), status: 'failed' as const }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    prepare.mockImplementationOnce(() => new Promise(() => {}));
    await focus.retry(); await focus.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    focus.disable();
  });
  it('does not automatically retry uncertain tasks or polling errors', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (_snapshot: PageReadingSnapshot, _retry?: boolean) => pendingView());
    const getTask = vi.fn(async () => { throw new Error('status unavailable'); });
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask: vi.fn() });
    focus.enable();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await focus.retry()).toMatchObject({ phase: 'error', taskStatus: 'unknown' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(getTask).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it('invalidates changed source immediately without automatically preparing another task', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    page.dispatch('pointerover');
    expect(page.highlights.size).toBe(1);
    page.first.textContent = 'Changed English paragraph needs fresh analysis.';
    page.mutate();
    expect(page.highlights.size).toBe(0);
    expect(focus.refresh()).toMatchObject({ phase: 'error', message: '正文已变化，请重新开启辅助阅读。' });
    page.dispatch('pointerover', page.second);
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable(); focus.enable();
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    page.rawDoc.URL = 'https://example.com/next';
    expect(focus.refresh()).toMatchObject({ phase: 'error', message: '页面已切换，请重新开启辅助阅读。' });
    page.dispatch('pointerover');
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepare).toHaveBeenCalledTimes(2);
    focus.destroy();
    expect(focus.enable().enabled).toBe(false);
  });
  it('keeps prepared focus and highlights across ordinary article anchors without new tasks', async () => {
    vi.useFakeTimers();
    const page = fixture();
    page.rawDoc.URL = 'https://example.com/article#introduction';
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    expect(page.highlights.size).toBe(1);
    page.rawDoc.URL = 'https://example.com/article#conclusion';
    page.dispatch('hashchange');
    expect(focus.refresh().phase).toBe('highlighted');
    expect(page.highlights.size).toBe(1);
    page.dispatch('pointerover', page.second);
    await vi.advanceTimersByTimeAsync(2000);
    expect(page.second.getAttribute(attr(page.second))).toBe('active');
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it('continues the same pending task after an ordinary anchor change', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let input!: PageReadingSnapshot;
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => { input = snapshot; return pendingView(); });
    const getTask = vi.fn(async () => readyView(input));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    page.rawDoc.URL += '#how-it-works'; page.dispatch('hashchange');
    expect(focus.refresh().phase).toBe('preparing');
    await vi.advanceTimersByTimeAsync(1000);
    expect(focus.refresh().phase).toBe('ready');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(getTask).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it.each([
    'https://example.com/another-article',
    'https://example.com/article#/different-route',
    'https://example.com/article#!/different-route',
    'https://example.com/article?version=2',
  ])('invalidates a different document identity %s without automatic analysis', async (url) => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    page.rawDoc.URL = url; page.dispatch('hashchange');
    expect(focus.refresh()).toMatchObject({ phase: 'error', message: '页面已切换，请重新开启辅助阅读。' });
    expect(page.highlights.size).toBe(0);
    page.dispatch('pointerover', page.second);
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it('rebuilds ranges when framework text nodes are replaced with identical source', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    const previous = [...page.highlights.values()][0];
    page.first.textContent = page.first.textContent;
    page.mutate(); await vi.advanceTimersByTimeAsync(100);
    expect([...page.highlights.values()][0]).not.toBe(previous);
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it('degrades invalid and empty paragraph results to explicit local-only focus', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const statuses: Array<{ phase: string; message?: string }> = [];
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => {
      const value = readyView(snapshot);
      value.result!.paragraphs[0]!.text = 'Rewritten model text';
      value.result!.paragraphs[1]!.groups = [];
      return value;
    });
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn(), onStatus: (status) => statuses.push(status) });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    page.dispatch('pointerover');
    expect(statuses.at(-1)).toMatchObject({ phase: 'ready', message: '这一段的意群结果无法准确对应原文，仍可聚焦阅读。' });
    expect(page.highlights.size).toBe(0);
    page.dispatch('pointerover', page.second);
    expect(statuses.at(-1)?.message).toBe('这一段没有额外意群标记，仍可聚焦阅读。');
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable();
  });
  it('retries a first preparation failure without a task, but never retries unknown work', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn<(snapshot: PageReadingSnapshot, retry?: boolean) => Promise<PageReadingTaskView>>()
      .mockRejectedValueOnce(new Error('请先连接 WorkOS。'))
      .mockImplementationOnce(async (snapshot) => readyView(snapshot))
      .mockResolvedValue({ ...pendingView(), status: 'unknown' });
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh().phase).toBe('error');
    await focus.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh().phase).toBe('ready');
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[1]).toBe(true);
    focus.disable(); focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.refresh().taskStatus).toBe('unknown');
    await focus.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(3);
    focus.disable();
  });
  it('keeps focus during selection and pointer leave, and skips tasks without Highlight API', async () => {
    vi.useFakeTimers();
    const page = fixture(false);
    const prepare = vi.fn();
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); page.dispatch('pointerover');
    const key = attr(page.first);
    page.dispatch('pointerdown', page.first, { button: 0 });
    page.dispatch('pointerover', page.second);
    page.dispatch('pointerup');
    page.setSelection(false);
    page.dispatch('pointerover', page.second);
    page.dispatch('pointerout', page.first);
    expect(page.first.getAttribute(key)).toBe('active');
    expect(page.second.getAttribute(key)).toBe('dim');
    await vi.advanceTimersByTimeAsync(1000);
    expect(prepare).not.toHaveBeenCalled();
    focus.disable();
  });
});

function pendingView(): PageReadingTaskView {
  return { id: 'article-task', status: 'analyzing', total: 2, readyCount: 0, invalidCount: 0 };
}
function readyView(snapshot: PageReadingSnapshot): PageReadingTaskView {
  const paragraphs = snapshot.paragraphs.map(({ id, text }) => ({ ...result(text), id, status: 'ready' as const }));
  return { id: 'article-task', status: 'ready', total: paragraphs.length, readyCount: paragraphs.length, invalidCount: 0,
    result: { paragraphs, total: paragraphs.length, readyCount: paragraphs.length, invalidCount: 0 } };
}

function expressionView(snapshot: PageReadingSnapshot): PageReadingTaskView {
  const text = snapshot.paragraphs[0]!.text;
  const start = text.indexOf('a script');
  const expression: ReadingExpression = { id: 'script', text: 'a script', category: 'collocation', meaning: '一个脚本',
    occurrences: [{ paragraphId: 'p0', text: 'a script', start, end: start + 8, sentence: text, highlightStart: start, highlightEnd: start + 8 }] };
  return { ...readyView(snapshot), id: 'expression-task', mode: 'expressions', result: {
    paragraphs: [], total: 1, readyCount: 1, invalidCount: 0, expressions: [expression],
  } };
}

describe('reading focus V2 independent layers', () => {
  it('switches full/skeleton/practice immediately without resubmitting', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => {
      const view = readyView(snapshot);
      view.result!.paragraphs[0]!.groups = [
        { text: 'Use a script', start: 0, end: 12, kind: 'core', semantic: 'statement', isCore: true },
        { text: 'if there is no suitable API', start: 13, end: 40, kind: 'condition', semantic: 'condition', isCore: false },
      ];
      return view;
    });
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    expect(page.highlights.size).toBe(2);
    focus.setPreferences({ ...DEFAULT_READING_FOCUS_PREFERENCES, displayMode: 'skeleton', dimOpacity: .12 });
    expect(page.highlights.size).toBe(1);
    expect(page.head.childNodes[0]!.textContent).toContain('opacity: 0.12 !important');
    focus.setPreferences({ ...DEFAULT_READING_FOCUS_PREFERENCES, displayMode: 'practice' });
    expect(page.highlights.size).toBe(0);
    expect(page.second.getAttribute(attr(page.second))).toBe('dim');
    focus.setPreferences({ ...DEFAULT_READING_FOCUS_PREFERENCES });
    expect(page.highlights.size).toBe(2);
    expect(prepare).toHaveBeenCalledTimes(1);
    focus.disable();
  });

  it('starts in practice without a group request, then prepares the article once when colors are enabled', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot) => readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn(),
      preferences: { ...DEFAULT_READING_FOCUS_PREFERENCES, displayMode: 'practice' } });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    expect(prepare).not.toHaveBeenCalled();
    expect(page.second.getAttribute(attr(page.second))).toBe('dim');
    focus.setPreferences(DEFAULT_READING_FOCUS_PREFERENCES);
    await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover', page.second);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(page.highlights.size).toBe(1);
    focus.disable();
  });

  it('keeps local focus after group failure and allows independent expressions to complete', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') =>
      mode === 'expressions' ? expressionView(snapshot) : { ...pendingView(), status: 'failed' as const, message: '分析失败' });
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    expect(page.second.getAttribute(attr(page.second))).toBe('dim');
    expect(focus.refresh().phase).toBe('error');
    focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.expressions).toHaveLength(1);
    expect(page.highlights.size).toBe(1);
    expect(focus.refresh().phase).toBe('error');
    focus.disable();
  });

  it('renders expressions across paragraphs independently of focus and visibility toggles do not rescan', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const changes = vi.fn();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') =>
      mode === 'expressions' ? expressionView(snapshot) : readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn(), onExpressions: changes });
    focus.enable(); focus.scanExpressions(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    page.dispatch('pointerover');
    expect(page.highlights.size).toBe(2);
    page.dispatch('pointerover', page.second);
    expect(page.highlights.size).toBe(2);
    expect(focus.locateExpression('script', 0)?.toString()).toBe('a script');
    expect(page.first.getAttribute(attr(page.first))).toBe('active');
    focus.setPreferences({ ...DEFAULT_READING_FOCUS_PREFERENCES, expressionEnabled: false });
    expect(page.highlights.size).toBe(1);
    focus.setPreferences({ ...DEFAULT_READING_FOCUS_PREFERENCES, displayMode: 'practice' });
    expect(page.highlights.size).toBe(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    page.first.textContent = 'The changed source must not retain any old marks.'; page.mutate();
    expect(page.highlights.size).toBe(0);
    expect(focus.expressions).toHaveLength(0);
    focus.disable();
    expect(page.listenerCount).toBe(0);
    expect(page.head.childNodes).toHaveLength(0);
    expect(changes).toHaveBeenLastCalledWith([]);
  });

  it('never repeats unknown expression tasks and rejects their late results after exit', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') =>
      mode === 'expressions' ? { ...pendingView(), id: 'expressions', mode, status: 'unknown' as const } : readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    focus.scanExpressions(); focus.scanExpressions(true); await vi.advanceTimersByTimeAsync(5000);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(focus.refresh().expressionTaskStatus).toBe('unknown');
    focus.disable();
    expect(page.highlights.size).toBe(0);
    expect(page.listenerCount).toBe(0);
  });

  it('restores a manually scanned result after exit only for the same article content and identity', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') =>
      mode === 'expressions' ? expressionView(snapshot) : readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn() });
    focus.enable(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    focus.disable(); focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.expressions).toHaveLength(1);
    expect(prepare.mock.calls.filter((call) => call[2] === 'expressions')).toHaveLength(1);
    focus.disable(); page.rawDoc.URL = 'https://example.com/other'; focus.enable(); await vi.advanceTimersByTimeAsync(0);
    expect(focus.expressions).toHaveLength(0);
    expect(prepare.mock.calls.filter((call) => call[2] === 'expressions')).toHaveLength(1);
    focus.disable();
  });

  it('can stop groups while the separately polled expression task still completes', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let input!: PageReadingSnapshot;
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') => {
      input = snapshot;
      return { ...pendingView(), id: mode === 'expressions' ? 'expression-task' : 'group-task' };
    });
    const getTask = vi.fn(async (id: string) => id === 'expression-task' ? expressionView(input) : pendingView());
    const stopTask = vi.fn(async (id: string) => ({ ...pendingView(), id, status: 'stopped' as const }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask, stopTask });
    focus.enable(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    await focus.stop(); await vi.advanceTimersByTimeAsync(1000);
    expect(focus.refresh()).toMatchObject({ taskStatus: 'stopped', expressionTaskStatus: 'ready' });
    expect(focus.expressions).toHaveLength(1);
    page.dispatch('pointerover');
    expect(page.second.getAttribute(attr(page.second))).toBe('dim');
    expect(stopTask).toHaveBeenCalledExactlyOnceWith('group-task');
    focus.disable();
  });

  it('stops expressions independently and retries only its confirmed stopped task', async () => {
    vi.useFakeTimers();
    const page = fixture();
    let input!: PageReadingSnapshot;
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, retry?: boolean, mode?: 'groups' | 'expressions') => {
      input = snapshot;
      return mode === 'expressions' ? retry ? expressionView(snapshot) : { ...pendingView(), id: 'expression-task' } : readyView(snapshot);
    });
    const stopTask = vi.fn(async () => ({ ...pendingView(), id: 'expression-task', status: 'stopped' as const }));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask });
    focus.enable(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0);
    await focus.stopExpressions(); page.dispatch('pointerover');
    expect(page.highlights.size).toBe(1);
    expect(focus.refresh()).toMatchObject({ taskStatus: 'ready', expressionTaskStatus: 'stopped' });
    focus.scanExpressions(true); await vi.advanceTimersByTimeAsync(0);
    expect(focus.expressions).toEqual(expressionView(input).result!.expressions);
    expect(page.highlights.size).toBe(2);
    expect(prepare.mock.calls.at(-1)?.slice(1)).toEqual([true, 'expressions']);
    focus.disable();
  });

  it('reports semantic hover and expression clicks without changing selection, then clears tooltip on scroll', async () => {
    vi.useFakeTimers();
    const page = fixture();
    const onGroupHover = vi.fn(); const onExpressionClick = vi.fn();
    const prepare = vi.fn(async (snapshot: PageReadingSnapshot, _retry?: boolean, mode?: 'groups' | 'expressions') =>
      mode === 'expressions' ? expressionView(snapshot) : readyView(snapshot));
    const focus = createReadingFocus({ document: page.doc, prepare, getTask: vi.fn(), stopTask: vi.fn(), onGroupHover, onExpressionClick });
    focus.enable(); focus.scanExpressions(); await vi.advanceTimersByTimeAsync(0); page.dispatch('pointerover');
    page.dispatch('pointermove', page.first, { clientX: 20, clientY: 20 });
    expect(onGroupHover).toHaveBeenLastCalledWith(expect.objectContaining({ group: expect.objectContaining({ kind: 'core' }) }));
    page.dispatch('click', page.first, { clientX: 20, clientY: 20 });
    expect(onExpressionClick).toHaveBeenCalledTimes(1);
    const link = new ElementStub('A'); link.textContent = 'Reference'; page.first.append(link);
    page.dispatch('click', link, { clientX: 20, clientY: 20 });
    expect(onExpressionClick).toHaveBeenCalledTimes(1);
    page.setSelection(false);
    page.dispatch('click', page.first, { clientX: 20, clientY: 20 });
    expect(onExpressionClick).toHaveBeenCalledTimes(1);
    page.dispatch('scroll');
    expect(onGroupHover).toHaveBeenLastCalledWith(null);
    focus.disable();
  });
});
