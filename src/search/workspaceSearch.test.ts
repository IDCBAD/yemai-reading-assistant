import { describe, expect, it } from 'vitest';
import type { ReadingCardRow } from '../data/database';
import type { ChatMessage, Conversation, WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSearchIndex, tokenizeWorkspaceSearch } from './workspaceSearch';

function message(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, createdAt: Number(id.replace(/\D/gu, '')) || 1, status: 'complete', ...extra };
}

function conversation(extra: Partial<Conversation> = {}): Conversation {
  const page = {
    title: 'Chrome Side Panel 设计指南',
    site: 'developer.chrome.com',
    url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
    status: 'read' as const,
  };
  return {
    id: 'conversation-1',
    title: 'Agent 评估体系设计',
    subtitle: '1 个页面 · 2 条消息',
    updatedAt: 100,
    page,
    pages: [page],
    messages: [
      message('message-1', 'user', '怎样衡量智能体的可靠性？'),
      message('message-2', 'assistant', '评估维度包括可靠性、安全性和任务完成率。', {
        artifacts: [{
          id: 'artifact-1',
          kind: 'document',
          filename: 'agent-evaluation-matrix.xlsx',
          status: 'available',
        }],
      }),
    ],
    draftInput: '',
    draftContextItems: [],
    ...extra,
  };
}

function workspace(conversations = [conversation()]): WorkspaceState {
  return {
    conversations,
    openTabs: [{ id: 'tab-1', conversationId: conversations[0]!.id, openedAt: 1 }],
    activeOpenTabId: 'tab-1',
  };
}

describe('tokenizeWorkspaceSearch', () => {
  it('normalizes Latin text and creates locale-aware Chinese word tokens', () => {
    expect(tokenizeWorkspaceSearch(' Agent评估 体系 ')).toEqual([
      'agent', '评估', '体系',
    ]);
  });

  it('normalizes full-width characters', () => {
    expect(tokenizeWorkspaceSearch('ＡＧＥＮＴ １２３')).toEqual(['agent', '123']);
  });
});

describe('createWorkspaceSearchIndex', () => {
  it('searches conversation titles without flooding results with every message', () => {
    const results = createWorkspaceSearchIndex(workspace()).search('Agent 评估');
    expect(results[0]).toMatchObject({ kind: 'conversation', conversationId: 'conversation-1' });
    expect(results.filter((result) => result.kind === 'conversation')).toHaveLength(1);
  });

  it('finds Chinese text in both user questions and assistant answers', () => {
    const index = createWorkspaceSearchIndex(workspace());
    expect(index.search('智能体可靠性')[0]).toMatchObject({ messageId: 'message-1', role: 'user' });
    expect(index.search('安全性')[0]).toMatchObject({ messageId: 'message-2', role: 'assistant' });
  });

  it('does not treat a cross-word Chinese character pair as a semantic match', () => {
    const item = conversation({
      messages: [
        message('message-7', 'assistant', '系统会根据达人类型自动分路。'),
        message('message-8', 'assistant', '人类活动需要保留清晰的判断边界。'),
      ],
    });
    const results = createWorkspaceSearchIndex(workspace([item])).search('人类');
    expect(results.map((result) => result.messageId)).toEqual(['message-8']);
    expect(results[0]?.snippet).toContain('人类活动');
  });

  it('requires date-like queries to occur exactly within one indexed field', () => {
    const pageWithUnrelatedDay = {
      title: '31 个发布检查项',
      site: 'example.com',
      url: 'https://example.com/checklist/31',
      status: 'read' as const,
    };
    const falsePositive = conversation({
      pages: [pageWithUnrelatedDay],
      page: pageWithUnrelatedDay,
      messages: [message('message-10', 'assistant', '生产系统记录于 2026-08-17 14:32:01。')],
    });
    expect(createWorkspaceSearchIndex(workspace([falsePositive])).search('2026-08-31')).toEqual([]);

    falsePositive.messages = [message('message-11', 'assistant', '计划日期是 2026-08-31。')];
    expect(createWorkspaceSearchIndex(workspace([falsePositive])).search('2026-08-31')[0])
      .toMatchObject({ messageId: 'message-11' });
  });

  it('treats punctuated identifiers as exact literals instead of cross-field keyword bags', () => {
    const item = conversation({
      pages: [{
        title: 'API 123 参考',
        site: 'example.com',
        url: 'https://example.com/api/reference',
        status: 'read',
      }],
      messages: [message('message-12', 'assistant', '错误代码 abc 出现在另一段正文。')],
    });
    const index = createWorkspaceSearchIndex(workspace([item]));
    expect(index.search('abc-123')).toEqual([]);

    item.messages = [message('message-13', 'assistant', '错误代码为 abc-123。')];
    expect(createWorkspaceSearchIndex(workspace([item])).search('abc-123')[0])
      .toMatchObject({ messageId: 'message-13' });
  });

  it('finds page metadata and artifact filenames', () => {
    const index = createWorkspaceSearchIndex(workspace());
    expect(index.search('developer.chrome.com')[0]).toMatchObject({
      conversationId: 'conversation-1',
      matchLabel: '网页或引用',
    });
    expect(index.search('evaluation matrix')[0]).toMatchObject({
      messageId: 'message-2',
      matchLabel: '附件或产物',
    });
  });

  it('keeps archived conversations searchable and marks them for restoration', () => {
    const archived = conversation({ archivedAt: 200 });
    expect(createWorkspaceSearchIndex(workspace([archived])).search('任务完成率')[0]).toMatchObject({
      conversationId: archived.id,
      archived: true,
    });
  });

  it('returns a compact snippet around the match', () => {
    const longAnswer = `${'前置信息 '.repeat(30)}关键结论在这里${' 后续说明'.repeat(30)}`;
    const item = conversation({ messages: [message('message-9', 'assistant', longAnswer)] });
    const result = createWorkspaceSearchIndex(workspace([item])).search('关键结论')[0]!;
    expect(result.snippet.length).toBeLessThanOrEqual(110);
    expect(result.snippet).toContain('关键结论');
    expect(result.snippet.startsWith('…')).toBe(true);
  });

  it('brings a late exact match into the visible part of a short single-line snippet', () => {
    const question = `我很好奇，假如有一天 AI 拥有足够多的上下文，${'补充背景 '.repeat(9)}最终仍要讨论意义本身。`;
    const item = conversation({ messages: [message('message-14', 'user', question)] });
    const result = createWorkspaceSearchIndex(workspace([item])).search('意义')[0]!;
    expect(result.snippet).toContain('意义本身');
    expect(result.snippet.indexOf('意义')).toBeLessThanOrEqual(30);
    expect(result.snippet.startsWith('…')).toBe(true);
  });

  it('returns recent conversations by updated time when the query is empty', () => {
    const older = conversation({ id: 'older', title: '较早会话', updatedAt: 20 });
    const newer = conversation({ id: 'newer', title: '最近会话', updatedAt: 50 });
    expect(createWorkspaceSearchIndex(workspace([older, newer])).recent().map((result) => result.title))
      .toEqual(['最近会话', '较早会话']);
  });

  it('searches saved reading cards and suppresses the duplicate source message', () => {
    const item = conversation({
      messages: [message('message-15', 'assistant', '这是值得独立收藏的关键结论。')],
    });
    const card: ReadingCardRow = {
      id: 'reading-card:conversation-1:message-15',
      sourceConversationId: item.id,
      sourceMessageId: 'message-15',
      title: '关键结论卡片',
      excerpt: '这是值得独立收藏的关键结论。',
      bodyMarkdown: '这是值得独立收藏的关键结论。',
      sources: [],
      artifacts: [],
      messageCreatedAt: 15,
      createdAt: 20,
      updatedAt: 20,
    };

    const results = createWorkspaceSearchIndex(workspace([item]), [card]).search('独立收藏');

    expect(results[0]).toMatchObject({
      kind: 'reading-card',
      readingCardId: card.id,
      matchLabel: '卡片正文',
    });
    expect(results.filter((result) => result.kind === 'message')).toHaveLength(0);
  });
});
