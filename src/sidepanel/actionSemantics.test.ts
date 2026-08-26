import { describe, expect, it } from 'vitest';
import type { ReadingCardRow } from '../data/database';
import {
  actionPresentation,
  clearHistoryImpact,
  historyDeletionPresentation,
  removeReadingCardForUndo,
  replaceKnowledgeImpact,
  restoreReadingCardFromUndo,
} from './actionSemantics';

function card(id: string): ReadingCardRow {
  return {
    id,
    title: `卡片 ${id}`,
    excerpt: '摘要',
    bodyMarkdown: '正文',
    sourceConversationId: 'conversation-1',
    sourceMessageId: `message-${id}`,
    messageCreatedAt: 1,
    createdAt: 2,
    updatedAt: 3,
    sources: [],
    artifacts: [],
  };
}

describe('actionPresentation', () => {
  it('distinguishes export and import objects before the action starts', () => {
    expect(actionPresentation('export-all-cards', 'idle')).toMatchObject({
      icon: 'card-download',
      label: '导出全部',
      spinning: false,
    });
    expect(actionPresentation('export-card-markdown', 'idle').icon).toBe('document-download');
    expect(actionPresentation('export-backup', 'idle').icon).toBe('database-download');
    expect(actionPresentation('select-backup', 'idle').icon).toBe('file-upload');
  });

  it('uses one predictable progress and success sequence without losing the action label', () => {
    expect(actionPresentation('export-backup', 'working')).toEqual({
      icon: 'cycle',
      label: '正在整理…',
      spinning: true,
    });
    expect(actionPresentation('export-backup', 'success')).toEqual({
      icon: 'solid-checkmark',
      label: '已开始下载',
      spinning: false,
    });
    expect(actionPresentation('export-backup', 'error')).toEqual({
      icon: 'database-download',
      label: '重新导出',
      spinning: false,
    });
  });
});

describe('reading card removal undo', () => {
  it('removes a card immediately and restores it at its original position within five seconds', () => {
    const cards = [card('a'), card('b'), card('c')];
    const removal = removeReadingCardForUndo(cards, cards[1]!, 1_000);

    expect(removal.cards.map((item) => item.id)).toEqual(['a', 'c']);
    expect(removal.undo.expiresAt).toBe(6_000);

    const restored = restoreReadingCardFromUndo(removal.cards, removal.undo, 5_999);
    expect(restored.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not restore an expired or already present card', () => {
    const cards = [card('a'), card('b')];
    const removal = removeReadingCardForUndo(cards, cards[0]!, 2_000);

    expect(restoreReadingCardFromUndo(removal.cards, removal.undo, 7_001)).toBe(removal.cards);
    expect(restoreReadingCardFromUndo(cards, removal.undo, 3_000)).toBe(cards);
  });
});

describe('destructive action presentation', () => {
  it('explains what a single archived conversation deletes and preserves', () => {
    expect(historyDeletionPresentation({
      kind: 'conversation',
      title: '产品演进建议',
      messageCount: 182,
    })).toEqual({
      icon: 'archive',
      title: '删除“产品演进建议”？',
      description: '删除后无法恢复。',
      affected: '该会话及 182 条消息',
      preserved: '阅读卡片和上传文件',
      confirmLabel: '删除会话',
    });
  });

  it('keeps bulk archive deletion distinct from single-record deletion', () => {
    expect(historyDeletionPresentation({
      kind: 'archived',
      conversationCount: 3,
      messageCount: 41,
    })).toMatchObject({
      icon: 'history-clear',
      title: '清空 3 条已归档历史？',
      affected: '3 个归档会话及 41 条消息',
      confirmLabel: '清空已归档',
    });
  });

  it('places full history clearing and backup replacement in inline impact panels', () => {
    const current = { conversations: 13, messages: 182, sources: 13, artifacts: 7, readingCards: 2 };
    const incoming = { conversations: 6, messages: 166, sources: 6, artifacts: 7, readingCards: 2 };

    expect(clearHistoryImpact(current)).toMatchObject({
      placement: 'inline',
      icon: 'history-clear',
      affected: '13 个会话、182 条消息和临时资源',
      preserved: '2 张阅读卡片和连接设置',
    });
    expect(replaceKnowledgeImpact(current, incoming)).toMatchObject({
      placement: 'inline',
      icon: 'database-replace',
      currentMessages: 182,
      incomingMessages: 166,
      preserved: '连接设置和界面偏好',
    });
  });
});
