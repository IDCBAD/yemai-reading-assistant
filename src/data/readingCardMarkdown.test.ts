import { describe, expect, it } from 'vitest';
import type { ReadingCardRow } from './database';
import {
  allReadingCardsFilename,
  readingCardsToMarkdown,
  readingCardToMarkdown,
  safeMarkdownFilename,
} from './readingCardMarkdown';

function card(patch: Partial<ReadingCardRow> = {}): ReadingCardRow {
  return {
    id: 'card-1',
    sourceConversationId: 'conversation-1',
    sourceMessageId: 'message-1',
    title: '可靠性：评估 / 方案',
    excerpt: '摘要',
    bodyMarkdown: '这里是**正文**。',
    sources: [{ title: '来源 [一]', url: 'https://example.com/a?q=1', site: 'example.com' }],
    artifacts: [{ id: 'file-1', kind: 'markdown', filename: '报告.md', url: 'https://example.com/report.md', status: 'available' }],
    messageCreatedAt: 10,
    createdAt: Date.UTC(2026, 7, 24),
    updatedAt: Date.UTC(2026, 7, 24),
    ...patch,
  };
}

describe('reading card Markdown export', () => {
  it('keeps title, body, sources, saved time, and artifact links', () => {
    const markdown = readingCardToMarkdown(card());
    expect(markdown).toContain('# 可靠性：评估 / 方案');
    expect(markdown).toContain('2026-08-24T00:00:00.000Z');
    expect(markdown).toContain('这里是**正文**。');
    expect(markdown).toContain('[来源 \\[一\\]](<https://example.com/a?q=1>)');
    expect(markdown).toContain('[报告.md](<https://example.com/report.md>)');
  });

  it('does not emit non-http artifact or source URLs', () => {
    const markdown = readingCardToMarkdown(card({
      sources: [{ title: '临时来源', url: 'javascript:alert(1)' }],
      artifacts: [{ id: 'file-1', kind: 'image', filename: '临时图片', url: 'blob:private', status: 'available' }],
    }));
    expect(markdown).toContain('- 临时来源');
    expect(markdown).toContain('- 临时图片');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).not.toContain('blob:');
  });

  it('combines all cards into one readable Markdown document', () => {
    const markdown = readingCardsToMarkdown([card(), card({ id: 'card-2', title: '第二张卡片' })], 100);
    expect(markdown).toContain('# 页脉阅读卡片');
    expect(markdown).toContain('> 卡片数量：2');
    expect(markdown).toContain('## 可靠性：评估 / 方案');
    expect(markdown).toContain('## 第二张卡片');
  });

  it('creates safe filenames for illegal, duplicate-looking, and reserved titles', () => {
    expect(safeMarkdownFilename('可靠性：评估 / 方案')).toBe('可靠性 评估 方案.md');
    expect(safeMarkdownFilename('CON')).toBe('_CON.md');
    expect(safeMarkdownFilename('...')).toBe('yemai-reading-card.md');
    expect(allReadingCardsFilename(Date.UTC(2026, 7, 24))).toBe('yemai-reading-cards-2026-08-24.md');
  });
});
