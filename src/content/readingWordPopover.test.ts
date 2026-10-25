import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadingWordPopover } from './readingWordPopover';
import type { WordCardCapture } from '../shared/wordCards';

// The project has no DOM test dependency. This models mounting, events and geometry only;
// browser layout, actual shadow isolation and keyboard traversal still require Chrome checks.
class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  hidden = false;
  disabled = false;
  textContent = '';
  className = '';
  type = '';
  constructor(public ownerDocument: DocumentStub, public tagName: string) { super(); }
  append(...nodes: ElementStub[]) { nodes.forEach((node) => { node.parent = this; this.children.push(node); }); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { width: 288, height: 150 }; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  click() { this.dispatchEvent(new Event('click')); }
}
class WindowStub extends EventTarget { innerWidth = 320; innerHeight = 600; }
class RangeStub {
  startContainer = {};
  endContainer = this.startContainer;
  startOffset = 0;
  endOffset = 3;
  constructor(public text = 'run') {}
  cloneRange() { return { ...this }; }
}
class SelectionStub {
  isCollapsed = false;
  rangeCount = 1;
  range = new RangeStub();
  toString() { return this.range.text; }
  getRangeAt() { return this.range; }
  removeAllRanges = vi.fn(() => { this.isCollapsed = true; this.rangeCount = 0; });
}
class DocumentStub extends EventTarget {
  defaultView = new WindowStub();
  selection: SelectionStub | null = null;
  getSelection() { return this.selection; }
  createElement(tag: string) { return new ElementStub(this, tag); }
}
const capture = (word: string): WordCardCapture => ({ word, sentence: `${word} works.`, source: { kind: 'page', title: 'Article', url: 'https://example.com' } });
const anchor = { left: 300, top: 530, bottom: 550 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function mount(overrides: Partial<Parameters<typeof createReadingWordPopover>[1]> = {}) {
  const doc = new DocumentStub();
  const root = new ElementStub(doc, 'shadow-root');
  const deps = { lookup: vi.fn(async () => '释义'), save: vi.fn(async (_: WordCardCapture) => undefined), ...overrides };
  const api = createReadingWordPopover(root as unknown as ShadowRoot, deps);
  const panel = root.children[1]!;
  const header = panel.children[0]!;
  return { api, deps, root, doc, panel, word: header.children[0]!, close: header.children[1]!, meaning: panel.children[1]!, save: panel.children[2]!, status: panel.children[3]! };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); });

describe('reading word popover', () => {
  it('shows and saves a supplied expression meaning immediately without another translation request', async () => {
    vi.useFakeTimers();
    const enrich = vi.fn(async () => { throw new Error('offline'); });
    const ui = mount({ enrich });
    const word = 'at least one complete MPEG frame';
    const sentence = `The output needs ${word} to qualify.`;
    const expression: WordCardCapture = { ...capture(word), sentence, highlightStart: 17,
      highlightEnd: 17 + word.length, meaning: '至少一个完整的 MPEG 帧' };
    ui.api.show(expression, anchor);
    expect(ui.meaning.textContent).toBe(expression.meaning);
    expect(ui.save.textContent).toBe('收藏表达');
    expect(ui.panel.children[0]!.children[3]!.getAttribute('aria-label')).toBe('播放表达发音');
    await flush(); vi.advanceTimersByTime(8_000);
    expect(ui.meaning.textContent).toBe(expression.meaning);
    expect(ui.deps.lookup).not.toHaveBeenCalled();
    expect(enrich).not.toHaveBeenCalled();
    ui.save.click(); await flush();
    expect(ui.deps.save).toHaveBeenCalledWith(expression);
    expect(vi.mocked(ui.deps.save).mock.calls[0]![0]).not.toHaveProperty('meaningSource');
    ui.api.destroy();
  });

  it('keeps the supplied meaning and original offsets if explicitly requested translation fails', async () => {
    const ui = mount({ lookup: vi.fn(async () => null), enrich: vi.fn(async () => { throw new Error('offline'); }) });
    const expression = { ...capture('based on'), meaning: '基于', highlightStart: 0, highlightEnd: 8 };
    ui.api.show(expression, anchor);
    const toolbar = ui.panel.children.find(item => item.className === 'yemai-word-toolbar')!;
    toolbar.children[2]!.children[0]!.click();
    await flush();
    expect(ui.meaning.textContent).toBe('基于');
    expect(ui.status.textContent).toContain('远程翻译暂不可用');
    ui.save.click(); await flush();
    expect(ui.deps.save).toHaveBeenCalledWith(expression);
    ui.api.destroy();
  });

  it('replaces the supplied expression meaning only after an explicit service returns a meaning', async () => {
    const remote = deferred<import('../shared/wordTranslation').WordTranslationResult>();
    const ui = mount({ lookup: vi.fn(async () => null), enrich: vi.fn(() => remote.promise) });
    const expression = { ...capture('based on'), meaning: '基于' };
    ui.api.show(expression, anchor);
    const toolbar = ui.panel.children.find(item => item.className === 'yemai-word-toolbar')!;
    toolbar.children[2]!.children[0]!.click();
    await flush();
    expect(ui.meaning.textContent).toBe('基于');
    remote.resolve({ service: 'baidu-nmt', meaning: '以……为依据', examples: [] });
    await flush();
    ui.save.click(); await flush();
    expect(ui.deps.save).toHaveBeenCalledWith({ ...expression, meaning: '以……为依据', meaningSource: 'baidu' });
    ui.api.destroy();
  });

  it('keeps local results immediately, then saves real remote meaning and sentence together', async () => {
    const remote = deferred<import('../shared/wordTranslation').WordTranslationResult>();
    const ui = mount({ enrich: vi.fn(() => remote.promise) });
    ui.api.show(capture('run'), anchor);
    await flush();
    expect(ui.meaning.textContent).toBe('释义');
    remote.resolve({ service: 'baidu-nmt', meaning: '运行', sentenceTranslation: '运行有效。', examples: [] });
    await flush();
    expect(ui.meaning.textContent).toBe('运行');
    ui.save.click(); await flush();
    expect(ui.deps.save).toHaveBeenCalledWith({ ...capture('run'), meaning: '运行', meaningSource: 'baidu',
      sentenceTranslation: '运行有效。', sentenceTranslationSource: 'baidu' });
    const details = ui.panel.children.find(item => item.className === 'yemai-word-details')!;
    expect(details.children).toHaveLength(1);
    expect(details.children[0]!.children[0]!.textContent).toBe('当前原句');
    ui.api.destroy();
  });

  it('ignores stale remote results and preserves the dictionary if a remote request fails', async () => {
    const remote = deferred<import('../shared/wordTranslation').WordTranslationResult>();
    const ui = mount({ enrich: vi.fn((capture) => capture.word === 'old' ? remote.promise : Promise.reject(new Error('offline'))) });
    ui.api.show(capture('old'), anchor);
    ui.api.show(capture('new'), anchor);
    await flush();
    remote.resolve({ service: 'baidu-llm', meaning: '过期', examples: [] });
    await flush();
    expect(ui.word.textContent).toBe('new');
    expect(ui.meaning.textContent).toBe('释义');
    expect(ui.status.textContent).toContain('远程翻译暂不可用');
    ui.api.destroy();
  });

  it('retains a late dictionary result when remote enrichment only supplies a sentence', async () => {
    const lookup = deferred<string | null>();
    const ui = mount({ lookup: vi.fn(() => lookup.promise), enrich: vi.fn(async () => ({
      service: 'baidu-nmt' as const, meaning: null, sentenceTranslation: '运行有效。', examples: [], notice: '词义暂不可用。',
    })) });
    ui.api.show(capture('run'), anchor);
    await flush();
    lookup.resolve('运行'); await flush();
    expect(ui.meaning.textContent).toBe('运行');
    expect(ui.status.textContent).toBe('词义暂不可用。');
    ui.save.click(); await flush();
    expect(ui.deps.save).toHaveBeenCalledWith({ ...capture('run'), meaning: '运行', meaningSource: 'dictionary',
      sentenceTranslation: '运行有效。', sentenceTranslationSource: 'baidu' });
    ui.api.destroy();
  });
  it('shows dictionary text safely and only saves after an explicit click', async () => {
    const ui = mount({ lookup: vi.fn(async () => '<b>动作</b>') });
    ui.api.show(capture('run'), anchor);
    expect(ui.deps.save).not.toHaveBeenCalled();
    expect(ui.status.attributes.get('aria-live')).toBe('polite');
    await flush();
    expect(ui.word.textContent).toBe('run');
    expect(ui.meaning.textContent).toBe('<b>动作</b>');
    expect(ui.meaning.children).toEqual([]);
    expect(ui.panel.style).toMatchObject({ left: '20px', top: '370px' });
    ui.save.click();
    await flush();
    expect(ui.deps.save).toHaveBeenCalledWith({ ...capture('run'), meaning: '<b>动作</b>', meaningSource: 'dictionary' });
    expect(ui.save.textContent).toBe('已收藏');
    ui.api.destroy();
  });

  it('ignores stale lookup and save responses after a new selection', async () => {
    const oldLookup = deferred<string | null>();
    const oldSave = deferred<unknown>();
    const ui = mount({ lookup: vi.fn((word) => word === 'old' ? oldLookup.promise : Promise.resolve('新的释义')), save: vi.fn(() => oldSave.promise) });
    ui.api.show(capture('old'), anchor);
    ui.save.click();
    ui.api.show(capture('new'), anchor);
    await flush();
    oldLookup.resolve('旧的释义');
    oldSave.resolve(undefined);
    await flush();
    expect(ui.word.textContent).toBe('new');
    expect(ui.meaning.textContent).toBe('新的释义');
    expect(ui.save.textContent).toBe('收藏单词');
    expect(ui.save.disabled).toBe(false);
    expect(ui.deps.save).toHaveBeenCalledTimes(1);
    expect(ui.deps.save).toHaveBeenCalledWith(capture('old'));
    ui.api.destroy();
  });

  it('clearly reports dictionary misses and uses an optional prepared translator', async () => {
    const ui = mount({ lookup: vi.fn(async () => null) });
    ui.api.show(capture('unknown'), anchor);
    await flush();
    expect(ui.meaning.textContent).toBe('本地词库暂无释义。');
    expect(ui.status.textContent).toContain('侧边栏');
    ui.api.destroy();
    const translated = mount({ lookup: vi.fn(async () => null), translate: vi.fn(async () => '可预测') });
    translated.api.show(capture('predictable'), anchor);
    await flush();
    translated.save.click();
    await flush();
    expect(translated.deps.save).toHaveBeenCalledWith({ ...capture('predictable'), meaning: '可预测', meaningSource: 'browser' });
    translated.api.destroy();
  });

  it('degrades safely when dictionary and local translation fail', async () => {
    const ui = mount({ lookup: vi.fn(async () => { throw new Error('offline'); }), translate: vi.fn(async () => { throw new Error('setup-required'); }) });
    ui.api.show(capture('word'), anchor);
    await flush();
    expect(ui.meaning.textContent).toBe('暂时无法查询本地词库。');
    ui.api.destroy();
  });

  it('closes on Escape and scrolling and removes all mounted UI on destroy', async () => {
    const ui = mount();
    ui.api.show(capture('run'), anchor);
    const escape = new Event('keydown');
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    ui.doc.dispatchEvent(escape);
    expect(ui.panel.hidden).toBe(true);
    ui.api.show(capture('run'), anchor);
    ui.doc.dispatchEvent(new Event('scroll'));
    expect(ui.panel.hidden).toBe(true);
    ui.api.show(capture('run'), anchor);
    ui.api.destroy();
    expect(ui.root.children).toEqual([]);
    ui.api.show(capture('again'), anchor);
    expect(ui.root.children).toEqual([]);
    await flush();
    expect(ui.panel.hidden).toBe(true);
  });

  it('reports long lookups and save errors without automatic retries', async () => {
    vi.useFakeTimers();
    const lookup = deferred<string | null>();
    const ui = mount({ lookup: vi.fn(() => lookup.promise), save: vi.fn(async () => { throw new Error('failed'); }) });
    ui.api.show(capture('run'), anchor);
    vi.advanceTimersByTime(8_000);
    expect(ui.meaning.textContent).toContain('查询时间较长');
    ui.save.click();
    await flush();
    expect(ui.save.textContent).toBe('重试收藏');
    expect(ui.deps.save).toHaveBeenCalledTimes(1);
    lookup.resolve('运行');
    await flush();
    expect(ui.status.textContent).toBe('收藏失败，请重试。');
    ui.api.destroy();
  });

  it.each(['close', 'Escape', 'hide'] as const)('releases the original selection on %s so paragraph hover can resume', (action) => {
    const ui = mount();
    const selection = new SelectionStub();
    ui.doc.selection = selection;
    ui.api.show(capture('run'), anchor);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    if (action === 'close') ui.close.click();
    else if (action === 'Escape') {
      const event = new Event('keydown');
      Object.defineProperty(event, 'key', { value: 'Escape' });
      ui.doc.dispatchEvent(event);
    } else ui.api.hide();
    expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(selection.isCollapsed).toBe(true);
    ui.api.destroy();
  });

  it.each(['close', 'Escape', 'hide'] as const)('preserves a later selection at another occurrence on %s', (action) => {
    const ui = mount();
    const selection = new SelectionStub();
    ui.doc.selection = selection;
    ui.api.show(capture('run'), anchor);
    selection.range = new RangeStub('run'); // Same word, different DOM node.
    if (action === 'close') ui.close.click();
    else if (action === 'Escape') {
      const event = new Event('keydown');
      Object.defineProperty(event, 'key', { value: 'Escape' });
      ui.doc.dispatchEvent(event);
    } else ui.api.hide();
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    expect(selection.isCollapsed).toBe(false);
    ui.api.destroy();
  });

  it('does not claim an unrelated selection and preserves selection while replacing the same lookup', () => {
    const ui = mount();
    const selection = new SelectionStub();
    ui.doc.selection = selection;
    ui.api.show(capture('word'), anchor);
    ui.api.hide();
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    ui.api.show(capture('run'), anchor);
    ui.api.show(capture('run'), anchor);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    ui.api.hide();
    expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
    ui.api.destroy();
  });
});
