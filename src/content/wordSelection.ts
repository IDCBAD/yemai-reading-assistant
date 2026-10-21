import { isCollectibleWord, normalizeWord, type WordCardCapture, type WordCardSource } from '../shared/wordCards';

const BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,dt,dd';
const FORBIDDEN_SELECTOR = 'input,textarea,select,option,pre,code,script,style,noscript';

export function isWordSelectionBlocked(node: Node | null, includeCode = true): boolean {
  let element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  while (element) {
    if (element.matches(includeCode ? FORBIDDEN_SELECTOR : 'input,textarea,select,option,script,style,noscript')) return true;
    const editable = element.getAttribute('contenteditable');
    // Test attributes too: isContentEditable is absent in some DOM implementations.
    if ((element as HTMLElement).isContentEditable || editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
    element = element.parentElement;
  }
  return false;
}

/** Normalize whitespace while preserving the occurrence the user actually selected. */
export function extractSentenceContext(text: string, start: number, end: number) {
  if (start < 0 || end <= start || end > text.length) return { sentence: '' };
  let sentenceStart = start;
  let sentenceEnd = end;
  while (sentenceStart > 0 && !/[.!?\n]/u.test(text[sentenceStart - 1]!)) sentenceStart--;
  while (sentenceEnd < text.length && !/[.!?\n]/u.test(text[sentenceEnd]!)) sentenceEnd++;
  if (sentenceEnd < text.length && /[.!?]/u.test(text[sentenceEnd]!)) sentenceEnd++;
  // Keep a real excerpt around the selected occurrence when a block is very long.
  sentenceStart = Math.max(sentenceStart, start - 350);
  sentenceEnd = Math.min(sentenceEnd, end + 350);
  const before = text.slice(sentenceStart, start).replace(/\s+/gu, ' ').trimStart();
  const selected = text.slice(start, end).replace(/\s+/gu, ' ');
  const after = text.slice(end, sentenceEnd).replace(/\s+/gu, ' ').trimEnd();
  const sentence = `${before}${selected}${after}`.trim();
  const highlightStart = before.length;
  return { sentence, highlightStart, highlightEnd: highlightStart + selected.length };
}

export function captureWordSelection(selection: Selection, source: WordCardSource): WordCardCapture | null {
  if (selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (isWordSelectionBlocked(range.startContainer) || isWordSelectionBlocked(range.endContainer)) return null;
  const word = selection.toString().replace(/\s+/gu, ' ').trim();
  if (!isCollectibleWord(word)) return null;
  const capture: WordCardCapture = { word, sentence: '', source };
  const startElement = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === 1 ? range.endContainer as Element : range.endContainer.parentElement;
  const startBlock = startElement?.closest(BLOCK_SELECTOR);
  const endBlock = endElement?.closest(BLOCK_SELECTOR);
  // Never combine adjacent paragraphs into an invented example.
  if (startBlock !== endBlock) return capture;
  const root = startBlock ?? startElement?.closest('div,article,section,main') ?? (range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement);
  if (!root) return capture;
  if (root.matches(FORBIDDEN_SELECTOR)) return null;
  for (const forbidden of root.querySelectorAll(FORBIDDEN_SELECTOR + ',[contenteditable]')) {
    if (range.intersectsNode(forbidden) && isWordSelectionBlocked(forbidden)) return null;
  }
  const offsets = new Map<Node, { start: number; end: number; boundaries?: number[] }>();
  const parts: string[] = [];
  let length = 0;
  const append = (text: string) => { parts.push(text); length += text.length; };
  const visit = (node: Node) => {
    const start = length;
    if (node.nodeType === 1 && (node as Element).matches('script,style,noscript,input,textarea,select,option')) {
      offsets.set(node, { start, end: start });
      return;
    }
    if (node.nodeType === 3) append(node.textContent ?? '');
    else if (node.nodeType === 1 && (node as Element).tagName === 'BR') append('\n');
    else {
      const boundaries = [length];
      for (const child of node.childNodes) {
        visit(child);
        boundaries.push(length);
      }
      offsets.set(node, { start, end: length, boundaries });
      return;
    }
    offsets.set(node, { start, end: length });
  };
  visit(root);
  const position = (node: Node, offset: number) => {
    const info = offsets.get(node);
    return info ? info.boundaries ? info.boundaries[offset] : info.start + offset : undefined;
  };
  let start = position(range.startContainer, range.startOffset);
  let end = position(range.endContainer, range.endOffset);
  const text = parts.join('');
  if (start === undefined || end === undefined || normalizeWord(text.slice(start, end)) !== normalizeWord(word)) return capture;
  while (start < end && /\s/u.test(text[start]!)) start++;
  while (end > start && /\s/u.test(text[end - 1]!)) end--;
  const context = extractSentenceContext(text, start, end);
  if (normalizeWord(context.sentence.slice(context.highlightStart, context.highlightEnd)) !== normalizeWord(word)) return capture;
  return { ...capture, ...context };
}
