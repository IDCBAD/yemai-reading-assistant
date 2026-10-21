import { describe, expect, it } from 'vitest';
import { captureWordSelection, extractSentenceContext, isWordSelectionBlocked } from './wordSelection';
import { isWordCardCapture } from '../shared/wordCards';

// Only tree navigation is simulated; offset extraction uses the real capture code.
class TreeNode {
  parentElement: TreeNode | null = null;
  childNodes: TreeNode[] = [];
  readonly nodeType: number;
  readonly tagName: string;
  constructor(tag: string, private text = '', private editable: string | null = null) {
    this.nodeType = tag === '#text' ? 3 : 1;
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string { return this.nodeType === 3 ? this.text : this.childNodes.map((child) => child.textContent).join(''); }
  append(...nodes: TreeNode[]) { nodes.forEach((node) => { node.parentElement = this; this.childNodes.push(node); }); return this; }
  getAttribute(name: string) { return name === 'contenteditable' ? this.editable : null; }
  matches(selector: string): boolean { return selector.split(',').some((part) => part === '[contenteditable]' ? this.editable !== null : part.toUpperCase() === this.tagName); }
  closest(selector: string): TreeNode | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): TreeNode[] {
    return this.childNodes.flatMap((child) => [...(child.nodeType === 1 && child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
const text = (value: string) => new TreeNode('#text', value);
const source = { kind: 'page' as const, title: 'Article', url: 'https://example.com/article' };
function selection(word: string, start: TreeNode, startOffset: number, end = start, endOffset = startOffset + word.length, common = start.parentElement!, intersecting: TreeNode[] = []) {
  return {
    isCollapsed: false, rangeCount: 1, toString: () => word,
    getRangeAt: () => ({ startContainer: start, startOffset, endContainer: end, endOffset, commonAncestorContainer: common,
      intersectsNode: (node: TreeNode) => intersecting.includes(node) }),
  } as unknown as Selection;
}

describe('word selection capture', () => {
  it('keeps the second occurrence highlighted and preserves inline words', () => {
    const before = text('Agents run tasks. Agents ');
    const selected = text('run');
    const after = text(' workflows.');
    const emphasis = new TreeNode('strong').append(selected);
    new TreeNode('p').append(before, emphasis, after);
    const capture = captureWordSelection(selection('run', selected, 0), source)!;
    expect(capture).toMatchObject({ sentence: 'Agents run workflows.', highlightStart: 7, highlightEnd: 10 });
    expect(isWordCardCapture(capture)).toBe(true);
  });
  it('captures a phrase spanning inline text nodes and normalizes line breaks with correct offsets', () => {
    const before = text('Use ');
    const first = text('browser');
    const second = text('\n agents');
    const p = new TreeNode('p').append(before, new TreeNode('strong').append(first), second, text(' for this task.'));
    const capture = captureWordSelection(selection('browser\n agents', first, 0, second, second.textContent.length, p), source)!;
    expect(capture).toMatchObject({ sentence: 'Use browser agents for this task.', highlightStart: 4, highlightEnd: 18 });
    expect(isWordCardCapture(capture)).toBe(true);
  });
  it('supports explicit br breaks and selections with leading whitespace', () => {
    const selected = text('  browser');
    const p = new TreeNode('p').append(text('Previous line.'), new TreeNode('br'), selected, text(' agents work.'));
    const capture = captureWordSelection(selection('  browser', selected, 0, selected, selected.textContent.length, p), source)!;
    expect(capture).toMatchObject({ sentence: 'browser agents work.', highlightStart: 0, highlightEnd: 7 });
    expect(isWordCardCapture(capture)).toBe(true);
  });
  it('keeps long-block excerpts around the selected occurrence rather than the first match', () => {
    const body = `run ${'long context '.repeat(200)}run ${'more context '.repeat(200)}`;
    const start = body.lastIndexOf('run');
    const context = extractSentenceContext(body, start, start + 3);
    expect(context.sentence.length).toBeLessThan(710);
    expect(context.sentence.slice(context.highlightStart, context.highlightEnd)).toBe('run');
    expect(context.highlightStart).toBeGreaterThan(300);
  });
  it.each(['', 'true', 'plaintext-only'])('rejects contenteditable=%s and its descendants', (editable) => {
    const node = text('browser');
    new TreeNode('div', '', editable).append(new TreeNode('span').append(node));
    expect(isWordSelectionBlocked(node as unknown as Node)).toBe(true);
    expect(captureWordSelection(selection('browser', node, 0), source)).toBeNull();
  });
  it.each(['input', 'textarea', 'select', 'pre', 'code'])('rejects either endpoint in %s', (tag) => {
    const allowed = text('browser');
    const forbidden = text('agents');
    const p = new TreeNode('p').append(allowed, new TreeNode(tag).append(forbidden));
    expect(captureWordSelection(selection('browser agents', allowed, 0, forbidden, 6, p), source)).toBeNull();
    expect(captureWordSelection(selection('agents browser', forbidden, 0, allowed, 7, p), source)).toBeNull();
  });
  it('does not invent a sentence by concatenating paragraphs', () => {
    const first = text('browser');
    const last = text('agents');
    const root = new TreeNode('article').append(new TreeNode('p').append(first), new TreeNode('p').append(last));
    expect(captureWordSelection(selection('browser agents', first, 0, last, 6, root), source)).toEqual({ word: 'browser agents', sentence: '', source });
  });
  it('rejects a selected span that crosses code in its middle', () => {
    const first = text('browser ');
    const last = text(' agents');
    const code = new TreeNode('code').append(text('use'));
    const root = new TreeNode('p').append(first, code, last);
    expect(captureWordSelection(selection('browser use agents', first, 0, last, 7, root, [code]), source)).toBeNull();
  });
  it('rejects non-word selections', () => {
    const node = text('This is a whole sentence.');
    new TreeNode('p').append(node);
    expect(captureWordSelection(selection(node.textContent, node, 0), source)).toBeNull();
  });
});
