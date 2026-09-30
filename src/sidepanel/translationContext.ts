export interface TranslationContext {
  text: string;
  highlightStart: number;
  highlightEnd: number;
}

export function translationContextAroundSelection(
  blockText: string,
  selectionOffset: number,
  selectedText: string,
  rawSelectionLength: number,
  codeBlock: boolean,
): TranslationContext | null {
  let content = blockText;
  let offset = selectionOffset;

  if (codeBlock) {
    const lineStart = blockText.lastIndexOf('\n', selectionOffset - 1) + 1;
    const nextBreak = blockText.indexOf('\n', selectionOffset);
    const lineEnd = nextBreak === -1 ? blockText.length : nextBreak;
    if (selectionOffset + rawSelectionLength > lineEnd) return null;
    content = blockText.slice(lineStart, lineEnd);
    offset -= lineStart;
  }

  if (content.length > 1_000) return null;
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const segment of segmenter.segment(content)) {
    if (offset < segment.index || offset >= segment.index + segment.segment.length) continue;
    const leadingSpace = segment.segment.match(/^\s*/u)?.[0].length ?? 0;
    const sentence = segment.segment.trim();
    if (sentence.length > 240 || sentence.replace(/\s+/gu, ' ') === selectedText) return null;

    let highlightStart = offset - segment.index - leadingSpace;
    let highlightEnd = highlightStart + rawSelectionLength;
    if (sentence.slice(highlightStart, highlightEnd).replace(/\s+/gu, ' ').trim() !== selectedText) {
      highlightStart = sentence.toLowerCase().indexOf(selectedText.toLowerCase());
      highlightEnd = highlightStart + selectedText.length;
    }
    return {
      text: sentence,
      highlightStart: highlightStart >= 0 ? highlightStart : 0,
      highlightEnd: highlightStart >= 0 ? highlightEnd : 0,
    };
  }
  return null;
}
