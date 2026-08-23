import { describe, expect, it } from 'vitest';
import {
  initialAgentDecisionAnswers,
  normalizeAgentDecisionAnswers,
  settleAgentInteraction,
  upsertAgentInteraction,
} from './agentDecision';
import type { AgentDecisionField } from './types';

const fields: AgentDecisionField[] = [
  { type: 'text', label: '补充说明', defaultValue: '默认内容' },
  { type: 'single-select', label: '选择风格', defaultValue: '科技', options: ['科技', '卡通'] },
  { type: 'multi-select', label: '选择平台', defaultValue: ['Windows'], options: ['Windows', 'Linux'] },
];

describe('agent decision answers', () => {
  it('creates independent values from server defaults', () => {
    const answers = initialAgentDecisionAnswers(fields);
    expect(answers).toEqual({
      补充说明: '默认内容',
      选择风格: '科技',
      选择平台: ['Windows'],
    });
    (answers.选择平台 as string[]).push('Linux');
    expect(fields[2]?.defaultValue).toEqual(['Windows']);
  });

  it('allow-lists selections and preserves every field key required by WorkOS', () => {
    expect(normalizeAgentDecisionAnswers(fields, {
      补充说明: `内容\u0000${'x'.repeat(5_000)}`,
      选择风格: '不存在',
      选择平台: ['Linux', '恶意选项', 'Linux'],
      额外字段: '不能提交',
    })).toEqual({
      补充说明: `内容${'x'.repeat(3_998)}`,
      选择风格: '',
      选择平台: ['Linux'],
    });
  });

  it('appends separate interrupts in order and settles only the matching interaction', () => {
    const first = upsertAgentInteraction([], {
      id: 'request-1',
      sessionId: 'session-1',
      title: '第一份表单',
      fields,
    });
    const second = upsertAgentInteraction(first, {
      id: 'request-2',
      sessionId: 'session-1',
      title: '第二份表单',
      fields: [],
    });
    const settled = settleAgentInteraction(second, {
      requestId: 'request-1',
      sessionId: 'session-1',
      outcome: 'replied',
      data: { 选择风格: '科技' },
    });

    expect(settled.map((interaction) => interaction.id)).toEqual(['request-1', 'request-2']);
    expect(settled[0]).toMatchObject({ status: 'replied', answers: { 选择风格: '科技' } });
    expect(settled[1]).toMatchObject({ status: 'pending', title: '第二份表单' });
  });
});
