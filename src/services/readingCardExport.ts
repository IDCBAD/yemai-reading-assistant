import type { ReadingCardRow } from '../data/database';
import {
  allReadingCardsFilename,
  readingCardsToMarkdown,
  readingCardToMarkdown,
  safeMarkdownFilename,
} from '../data/readingCardMarkdown';

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  return { filename, bytes: blob.size };
}

export function exportReadingCardMarkdown(card: ReadingCardRow) {
  return downloadMarkdown(readingCardToMarkdown(card), safeMarkdownFilename(card.title));
}

export function exportAllReadingCardsMarkdown(cards: ReadingCardRow[]) {
  const exportedAt = Date.now();
  return downloadMarkdown(readingCardsToMarkdown(cards, exportedAt), allReadingCardsFilename(exportedAt));
}
