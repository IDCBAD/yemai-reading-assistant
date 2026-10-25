import type { ReadingFocusAnalysis } from '../../shared/readingFocus';
import { readingGroupMetadata } from '../../shared/readingFocus';

export type TextSegment = { node: Text; start: number; end: number };
export type ParagraphText = { text: string; segments: TextSegment[] };

const OMIT_TEXT = 'script,style,noscript,button,input,textarea,select,option,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])';

/** Offsets use the exact UTF-16 string sent to the analyzer, including whitespace. */
export function paragraphText(element: Element): ParagraphText {
  const parts: string[] = [];
  const segments: TextSegment[] = [];
  let length = 0;
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (text) {
        segments.push({ node: node as Text, start: length, end: length + text.length });
        parts.push(text);
        length += text.length;
      }
      return;
    }
    if (node.nodeType === 1) {
      const child = node as Element;
      if (child.matches(OMIT_TEXT)) return;
      // BR has no text node, but is a real word boundary in the rendered paragraph.
      if (child.tagName === 'BR') { parts.push('\n'); length++; return; }
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return { text: parts.join(''), segments };
}

export function rangeEndpoints(segments: TextSegment[], start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
  const first = segments.find((segment) => start >= segment.start && start < segment.end);
  const last = segments.find((segment) => end > segment.start && end <= segment.end);
  if (!first || !last) return null;
  return { startNode: first.node, startOffset: start - first.start, endNode: last.node, endOffset: end - last.start };
}

/** Build against today's text nodes and refuse ranges crossing excluded DOM text. */
export function exactTextRange(doc: Document, index: ParagraphText, start: number, end: number): Range | null {
  const endpoints = rangeEndpoints(index.segments, start, end);
  if (!endpoints) return null;
  const range = doc.createRange();
  range.setStart(endpoints.startNode, endpoints.startOffset);
  range.setEnd(endpoints.endNode, endpoints.endOffset);
  const visibleText = index.segments.map((segment) => segment.node.textContent?.slice(
    Math.max(0, start - segment.start), Math.max(0, Math.min(segment.end, end) - segment.start),
  ) ?? '').join('');
  return range.toString() === visibleText ? range : null;
}

/** Reject the whole response if any span is rewritten, overlapping, or out of bounds. */
export function validateAnalysis(text: string, value: unknown): ReadingFocusAnalysis | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as ReadingFocusAnalysis;
  if (result.text !== text || !Array.isArray(result.groups) || result.groups.length > 120) return null;
  let previousEnd = 0;
  for (const group of result.groups) {
    if (!group || !['core', 'condition', 'reason', 'detail'].includes(group.kind)
      || !readingGroupMetadata(group as unknown as Record<string, unknown>)
      || !Number.isInteger(group.start) || !Number.isInteger(group.end)
      || group.start < previousEnd || group.end <= group.start || group.end > text.length
      || typeof group.text !== 'string' || !group.text.trim()
      || text.slice(group.start, group.end) !== group.text) return null;
    // A UTF-16 offset must not split an emoji or another surrogate pair.
    if (splitsSurrogate(text, group.start) || splitsSurrogate(text, group.end)) return null;
    previousEnd = group.end;
  }
  return { text, groups: result.groups.map((group) => ({ ...group, ...readingGroupMetadata(group as unknown as Record<string, unknown>)! })) };
}

function splitsSurrogate(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Small page-local LRU; exact text is the key so edits never reuse stale results. */
export class AnalysisCache {
  private readonly entries = new Map<string, ReadingFocusAnalysis>();
  constructor(private readonly limit = 60) {}
  get(text: string) {
    const value = this.entries.get(text);
    if (value) { this.entries.delete(text); this.entries.set(text, value); }
    return value;
  }
  set(text: string, result: ReadingFocusAnalysis) {
    this.entries.delete(text);
    this.entries.set(text, result);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() { this.entries.clear(); }
}
