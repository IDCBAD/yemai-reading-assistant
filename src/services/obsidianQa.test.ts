import { describe, expect, it } from 'vitest';
import type { ReadingCardRow } from '../data/database';
import type { Conversation } from '../sidepanel/types';
import { collectionMaterials, collectionQuestionPrompt } from '../data/collectionActions';
import { createReadingCard, createReadingCardExcerpt, readingCardQuestion } from '../sidepanel/readingCards';
import { qaCardMarkdown, saveQaCards, type QaDirectory, type QaFile } from './obsidianQa';

function conversation(): Conversation {
  const page = { title: '文章', site: 'example.com', url: 'https://example.com/article', status: 'read' as const };
  return {
    id: 'conversation-1', title: '问答', subtitle: '', updatedAt: 10, page, pages: [page],
    messages: [
      { id: 'u1', role: 'user', content: '第一个问题？', createdAt: 1, status: 'complete' },
      { id: 'a1', role: 'assistant', content: '第一条回答。', createdAt: 2, status: 'complete' },
      { id: 'u2', role: 'user', content: '真正触发的问题？', createdAt: 3, status: 'complete' },
      { id: 'a2', role: 'assistant', content: '第二条回答。', createdAt: 4, status: 'complete' },
    ],
    draftInput: '', draftContextItems: [],
  };
}

function cards() {
  const source = conversation();
  const first = createReadingCard(source, source.messages[3]!, [], new Date(2026, 8, 27).getTime());
  const second = createReadingCardExcerpt(source, source.messages[3]!, '第二条回答。', [], new Date(2026, 8, 27).getTime());
  return { source, first, second };
}

class MemoryDirectory implements QaDirectory {
  name = '问答记录';
  files: QaFile[] = [];
  failName?: string;
  async listMarkdown() { return this.files.map((file) => ({ ...file })); }
  async createNew(name: string, content: string) {
    if (name === this.failName) throw new Error('模拟写入失败');
    if (this.files.some((file) => file.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('覆盖被拒绝');
    this.files.push({ name, content });
  }
}

describe('Obsidian Q&A save', () => {
  it('snapshots the nearest user question for full answers and excerpts', () => {
    const { source, first, second } = cards();
    expect(first.question).toBe('真正触发的问题？');
    expect(second.question).toBe('真正触发的问题？');
    expect(second.bodyMarkdown).toBe('第二条回答。');
    expect(readingCardQuestion({ ...first, question: undefined }, [source])).toBe('真正触发的问题？');
    expect(readingCardQuestion({ ...first, question: undefined }, [])).toBeUndefined();
    const prompt = collectionQuestionPrompt('这段回答有什么依据？', collectionMaterials([second], [source]));
    expect(prompt).toContain('这段回答有什么依据？');
    expect(prompt).toContain('真正触发的问题？');
    expect(prompt).toContain('收藏的回答片段');
    expect(prompt).not.toContain('第一条回答。');
    expect(prompt).not.toContain('综合整理共同点');
  });

  it('creates separate Markdown files for same-title cards without overwriting', async () => {
    const { source, first, second } = cards();
    const directory = new MemoryDirectory();
    second.title = first.title;
    const result = await saveQaCards(directory, [first, second], [source]);
    expect(result.map((item) => item.status)).toEqual(['saved', 'saved']);
    expect(directory.files[0]?.name).toMatch(/^2026-09-27-.*\.md$/);
    expect(directory.files[1]?.name).toBe(directory.files[0]!.name.replace(/\.md$/, '-2.md'));
    expect(directory.files[0]?.content).toContain(`yemai_card_id: ${JSON.stringify(first.id)}`);
    expect(directory.files[1]?.content).toContain('## 收藏的回答片段');
    expect(directory.files[0]?.content).toContain('## 问题\n\n真正触发的问题？');
  });

  it('recognizes a renamed file by embedded ID and does not touch its content', async () => {
    const { source, first } = cards();
    const directory = new MemoryDirectory();
    const original = qaCardMarkdown(first, first.question!);
    directory.files.push({ name: '我在 Obsidian 中改名.md', content: original });
    const result = await saveQaCards(directory, [first], [source]);
    expect(result[0]?.status).toBe('existing');
    expect(directory.files).toEqual([{ name: '我在 Obsidian 中改名.md', content: original }]);
  });

  it('continues after per-card failure and skips an old card without a question', async () => {
    const { source, first, second } = cards();
    const directory = new MemoryDirectory();
    directory.failName = `2026-09-27-${first.title}.md`;
    const missing: ReadingCardRow = { ...second, id: 'old-card', question: undefined, sourceConversationId: 'gone' };
    const result = await saveQaCards(directory, [first, missing, second], [source]);
    expect(result.map((item) => item.status)).toEqual(['failed', 'failed', 'saved']);
    expect(directory.files).toHaveLength(1);
  });

  it('stops all writes if the directory cannot be scanned', async () => {
    const { source, first } = cards();
    let created = false;
    const directory: QaDirectory = {
      name: '问答记录',
      listMarkdown: async () => { throw new Error('读取失败'); },
      createNew: async () => { created = true; },
    };
    await expect(saveQaCards(directory, [first], [source])).rejects.toThrow('读取失败');
    expect(created).toBe(false);
  });
});
