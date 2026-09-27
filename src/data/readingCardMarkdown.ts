import type { ReadingCardRow } from './database';

function safeHttpUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/[\\[\]]/g, '\\$&').trim();
}

function markdownLink(label: string, value?: string) {
  const url = safeHttpUrl(value);
  return url ? `[${escapeMarkdownLabel(label)}](<${url}>)` : escapeMarkdownLabel(label);
}

function readableTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function cardSections(card: ReadingCardRow, headingLevel: 1 | 2) {
  const heading = '#'.repeat(headingLevel);
  const sections = [
    `${heading} ${card.title.trim() || '未命名收藏卡片'}`,
    '',
    `> 类型：${card.kind === 'excerpt' ? '回答片段' : '完整回答'}`,
    `> 收藏时间：${readableTimestamp(card.createdAt)}`,
  ];
  if (card.question?.trim()) sections.push('', `${heading}# 原始问题`, '', card.question.trim(), '', `${heading}# 回答`);
  if (card.bodyMarkdown.trim()) sections.push('', card.bodyMarkdown.trim());
  if (card.sources.length) {
    sections.push('', `${heading}# 来源`, '');
    card.sources.forEach((source) => {
      const site = source.site?.trim();
      sections.push(`- ${markdownLink(source.title || site || source.url, source.url)}${site ? ` — ${site}` : ''}`);
    });
  }
  if (card.artifacts.length) {
    sections.push('', `${heading}# 产物`, '');
    card.artifacts.forEach((artifact) => {
      sections.push(`- ${markdownLink(artifact.filename, artifact.url)}`);
    });
  }
  return sections.join('\n');
}

export function readingCardToMarkdown(card: ReadingCardRow) {
  return `${cardSections(card, 1)}\n`;
}

export function readingCardsToMarkdown(cards: ReadingCardRow[], exportedAt = Date.now()) {
  const sections = [
    '# 页脉收藏卡片',
    '',
    `> 导出时间：${readableTimestamp(exportedAt)}`,
    `> 卡片数量：${cards.length}`,
  ];
  cards.forEach((card) => sections.push('', '---', '', cardSections(card, 2)));
  return `${sections.join('\n')}\n`;
}

const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function safeMarkdownFilename(title: string, fallback = 'yemai-reading-card') {
  const sanitized = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[ .]+$/g, '')
    .trim()
    .slice(0, 80);
  const base = !sanitized
    ? fallback
    : WINDOWS_RESERVED_FILENAME.test(sanitized)
      ? `_${sanitized}`
      : sanitized;
  return `${base}.md`;
}

export function allReadingCardsFilename(exportedAt: number) {
  return safeMarkdownFilename(`yemai-reading-cards-${new Date(exportedAt).toISOString().slice(0, 10)}`);
}
