import { describe, expect, it } from 'vitest';
import { AnalysisCache, paragraphText, rangeEndpoints, validateAnalysis } from './text';
import type { ReadingFocusAnalysis } from '../../shared/readingFocus';

class TreeNode {
  nodeType: number;
  childNodes: TreeNode[] = [];
  tagName: string;
  constructor(tag: string, private value = '', private hidden = false) {
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === '#text' ? 3 : 1;
  }
  append(...nodes: TreeNode[]) { this.childNodes.push(...nodes); return this; }
  get textContent(): string { return this.nodeType === 3 ? this.value : this.childNodes.map((node) => node.textContent).join(''); }
  matches() { return this.hidden || ['BUTTON', 'SCRIPT', 'STYLE', 'TEXTAREA'].includes(this.tagName); }
}
const node = (value: string) => new TreeNode('#text', value);
const valid = (text = 'Use a script if there is no suitable API.'): ReadingFocusAnalysis => ({
  text, groups: [{ text: text.slice(0, 12), start: 0, end: 12, kind: 'core' }],
});

describe('reading focus text and positioning', () => {
  it('preserves whitespace and inline formatting across nodes without rewriting English', () => {
    const first = node('Use a ');
    const second = node('script');
    const last = node(' if there is no API.');
    const root = new TreeNode('p').append(first, new TreeNode('strong').append(second), last);
    const result = paragraphText(root as unknown as Element);
    expect(result.text).toBe('Use a script if there is no API.');
    expect(rangeEndpoints(result.segments, 4, 15)).toEqual({ startNode: first, startOffset: 4, endNode: last, endOffset: 3 });
    expect(root.textContent).toBe(result.text);
  });
  it('uses UTF-16 offsets and retains BR as a boundary while omitting hidden controls', () => {
    const first = node('Read 📖');
    const last = node('English words now.');
    const root = new TreeNode('p').append(first, new TreeNode('br'), new TreeNode('button').append(node('copy')),
      new TreeNode('span', '', true).append(node('hidden')), last);
    const result = paragraphText(root as unknown as Element);
    expect(result.text).toBe('Read 📖\nEnglish words now.');
    expect(rangeEndpoints(result.segments, 8, 15)).toEqual({ startNode: last, startOffset: 0, endNode: last, endOffset: 7 });
    expect(rangeEndpoints(result.segments, 7, 15)).toBeNull();
  });
  it('picks exact node boundaries and rejects impossible ranges', () => {
    const a = node('Use ');
    const b = node('scripts');
    const index = paragraphText(new TreeNode('p').append(a, b) as unknown as Element);
    expect(rangeEndpoints(index.segments, 4, 11)).toEqual({ startNode: b, startOffset: 0, endNode: b, endOffset: 7 });
    expect(rangeEndpoints(index.segments, -1, 4)).toBeNull();
    expect(rangeEndpoints(index.segments, 4, 12)).toBeNull();
    expect(rangeEndpoints(index.segments, 4, 4)).toBeNull();
    expect(rangeEndpoints(index.segments, .5, 4)).toBeNull();
  });
});

describe('reading focus analysis validation', () => {
  it('accepts sparse key phrases in original order, including multiple sentences', () => {
    const text = 'Use a script. Stop when it fails.';
    const groups = [{ text: 'Use a script', start: 0, end: 12, kind: 'core' }, { text: 'when it fails', start: 18, end: 31, kind: 'condition' }];
    // Validate exact punctuation and offsets, never repair a model response heuristically.
    expect(validateAnalysis(text, { text, groups })).toBeNull();
    const start = text.indexOf('when');
    groups[1] = { text: 'when it fails', start, end: start + 'when it fails'.length, kind: 'condition' };
    expect(validateAnalysis(text, { text, groups })).toEqual({ text, groups });
  });
  it('rejects rewritten original text, wrong spans, overlaps, unknown types and out-of-bounds results', () => {
    const result = valid();
    expect(validateAnalysis(result.text, { ...result, text: 'Use scripts.' })).toBeNull();
    expect(validateAnalysis(result.text, { ...result, groups: [{ ...result.groups[0], text: 'Use scripts' }] })).toBeNull();
    expect(validateAnalysis(result.text, { ...result, groups: [...result.groups, { ...result.groups[0] }] })).toBeNull();
    expect(validateAnalysis(result.text, { ...result, groups: [{ ...result.groups[0], kind: 'translation' }] })).toBeNull();
    expect(validateAnalysis(result.text, { ...result, groups: [{ ...result.groups[0], end: 200 }] })).toBeNull();
    expect(validateAnalysis(result.text, { ...result, groups: [{ ...result.groups[0], start: NaN }] })).toBeNull();
    expect(validateAnalysis(result.text, null)).toBeNull();
  });
  it('rejects offsets that split surrogate pairs and accepts whole Unicode characters', () => {
    const text = 'Read 📖 in English.';
    expect(validateAnalysis(text, { text, groups: [{ text: text.slice(0, 6), start: 0, end: 6, kind: 'core' }] })).toBeNull();
    expect(validateAnalysis(text, { text, groups: [{ text: text.slice(0, 7), start: 0, end: 7, kind: 'core' }] })).not.toBeNull();
  });
});

describe('page-local reading focus cache', () => {
  it('reuses exact unchanged text and evicts the least recently read paragraph', () => {
    const cache = new AnalysisCache(2);
    const first = valid('First useful paragraph.');
    const second = valid('Second useful paragraph.');
    const third = valid('Third useful paragraph.');
    cache.set(first.text, first);
    cache.set(second.text, second);
    expect(cache.get(first.text)).toBe(first);
    cache.set(third.text, third);
    expect(cache.get(second.text)).toBeUndefined();
    expect(cache.get(first.text + ' changed')).toBeUndefined();
    cache.clear();
    expect(cache.get(first.text)).toBeUndefined();
  });
});
