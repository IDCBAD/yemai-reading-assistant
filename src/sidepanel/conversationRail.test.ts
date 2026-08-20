import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATION_TURN_LABEL_LENGTH,
  activeConversationTurnId,
  compactConversationTurnLabel,
} from './conversationRail';

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
});
