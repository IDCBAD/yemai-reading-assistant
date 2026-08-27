import { describe, expect, it } from 'vitest';
import { cognitionCandidateFromDecision, COGNITION_CONFIRMATION_PROMPTS } from './candidate';
import type { WorkosA2uiInterrupt } from '../services/workosSse';

const source = { conversationId: 'conversation-1', messageId: 'message-1' };

function decision(type: NonNullable<WorkosA2uiInterrupt['cognitionCandidate']>['type']): WorkosA2uiInterrupt {
  return {
    id: 'candidate-1', sessionId: 'session-1', title: '候选',
    fields: [{ type: 'text', label: '确认', defaultValue: '' }],
    purpose: 'cognition-candidate', purposeVersion: 1,
    cognitionCandidate: {
      type, title: '理解', currentUnderstanding: '原理解', changedFrom: '以前',
      rationale: '原理由', boundary: '原边界', unresolved: '原疑问', question: COGNITION_CONFIRMATION_PROMPTS[type],
    },
  };
}

describe('cognition micro-confirmation', () => {
  it.each([
    ['concept', 'currentUnderstanding'],
    ['causal-model', 'rationale'],
    ['judgment-principle', 'boundary'],
    ['method', 'boundary'],
    ['decision-basis', 'rationale'],
    ['hypothesis', 'unresolved'],
  ] as const)('maps %s to the user-owned field %s', (type, field) => {
    const candidate = cognitionCandidateFromDecision(decision(type), source, '我的主动回答');
    expect(candidate[field]).toBe('我的主动回答');
  });

  it('rejects an empty confirmation instead of accepting the Agent default', () => {
    expect(() => cognitionCandidateFromDecision(decision('concept'), source, '   ')).toThrow('请先完成');
  });
});
