import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATION_TURN_LABEL_LENGTH,
  activeConversationTurnId,
  buildConversationTurnAnswerPreviews,
  compactConversationTurnLabel,
  conversationPreviewTop,
} from './conversationRail';
import type { ChatMessage, MessageStatus } from './types';

function message(id: string, role: ChatMessage['role'], content: string, status: MessageStatus = 'complete'): ChatMessage {
  return { id, role, content, status, createdAt: 1 };
}

describe('conversation rail', () => {
  it('normalizes and truncates question labels without losing the fallback', () => {
    expect(compactConversationTurnLabel('  如何   设计\nAgent ？ ', '第 1 轮提问')).toBe('如何 设计 Agent ？');
    expect(compactConversationTurnLabel('   ', '第 2 轮提问')).toBe('第 2 轮提问');
    const label = compactConversationTurnLabel('长'.repeat(100), 'fallback');
    expect(label).toHaveLength(MAX_CONVERSATION_TURN_LABEL_LENGTH);
    expect(label.endsWith('…')).toBe(true);
  });

  it('uses the last turn that has crossed the reading line', () => {
    const anchors = [
      { id: 'turn-1', top: 100 },
      { id: 'turn-2', top: 420 },
      { id: 'turn-3', top: 780 },
    ];
    expect(activeConversationTurnId(anchors, 40)).toBe('turn-1');
    expect(activeConversationTurnId(anchors, 420)).toBe('turn-2');
    expect(activeConversationTurnId(anchors, 900)).toBe('turn-3');
  });

  it('returns an empty id when no turn anchors exist', () => {
    expect(activeConversationTurnId([], 200)).toBe('');
  });

  it('keeps answer excerpts within their own question, including multiple responses', () => {
    const previews = buildConversationTurnAnswerPreviews([
      message('orphan', 'assistant', '不属于任何提问'),
      message('q1', 'user', '问题一'),
      message('a1', 'assistant', '第一部分。'),
      message('a2', 'assistant', '补充说明。'),
      message('q2', 'user', '问题二'),
      message('a3', 'assistant', '第二轮回答。'),
      message('q3', 'user', '尚无回答'),
    ]);
    expect(previews.get('q1')).toBe('第一部分。 补充说明。');
    expect(previews.get('q2')).toBe('第二轮回答。');
    expect(previews.get('q3')).toBe('');
    expect(previews.has('orphan')).toBe(false);
  });

  it('shows visible Markdown text and bounds a long excerpt without changing the answer', () => {
    const answer = message('a', 'assistant', '## 核心观点\n\n**文字**和[视频](https://example.com)各有用途。\n' + '长'.repeat(500));
    const original = answer.content;
    const preview = buildConversationTurnAnswerPreviews([message('q', 'user', '比较'), answer]).get('q')!;
    expect(preview.startsWith('核心观点 文字和视频各有用途。')).toBe(true);
    expect(preview).not.toContain('https://');
    expect(preview.length).toBeLessThanOrEqual(240);
    expect(preview.endsWith('…')).toBe(true);
    expect(answer.content).toBe(original);
  });

  it.each([
    ['queued', '排队中…'], ['running', '正在回答…'], ['streaming', '正在回答…'],
    ['failed', '回答失败'], ['stopped', '已停止'], ['complete', ''],
  ] as const)('handles an empty %s response without borrowing the next answer', (status, expected) => {
    const previews = buildConversationTurnAnswerPreviews([
      message('q1', 'user', '问题一'), message('a1', 'assistant', '', status),
      message('q2', 'user', '问题二'), message('a2', 'assistant', '其他轮次的回答'),
    ]);
    expect(previews.get('q1')).toBe(expected);
  });

  it('updates a retry and preserves available streaming text', () => {
    const question = message('q', 'user', '问题');
    const answer = message('a', 'assistant', '已有内容', 'streaming');
    expect(buildConversationTurnAnswerPreviews([question, answer]).get('q')).toBe('已有内容');
    expect(buildConversationTurnAnswerPreviews([question, { ...answer, content: '', status: 'queued' }]).get('q')).toBe('排队中…');
    expect(buildConversationTurnAnswerPreviews([question, { ...answer, content: '重试的新回答', status: 'complete' }]).get('q')).toBe('重试的新回答');
  });

  it('centers a card on the actual tick and only moves it at the message-area edges', () => {
    expect(conversationPreviewTop(398, 126, 56, 560)).toBe(335);
    expect(conversationPreviewTop(218, 126, 56, 560)).toBe(155);
    expect(conversationPreviewTop(70, 126, 56, 560)).toBe(64);
    expect(conversationPreviewTop(550, 126, 56, 560)).toBe(426);
    expect(conversationPreviewTop(80, 126, 56, 120)).toBe(64);
  });
});
