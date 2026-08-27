import type { CognitionCandidate, CognitionType } from './cognitionLoop';
import type { WorkosA2uiInterrupt } from '../services/workosSse';

export const COGNITION_TYPE_LABELS: Record<CognitionType, string> = {
  concept: '概念',
  'causal-model': '因果模型',
  'judgment-principle': '判断原则',
  method: '方法',
  'decision-basis': '决策依据',
  hypothesis: '待验证假设',
};

export const COGNITION_CONFIRMATION_PROMPTS: Record<CognitionType, string> = {
  concept: '用你自己的话解释它',
  'causal-model': '为什么会发生？',
  'judgment-principle': '它在什么情况下不适用？',
  method: '你会在何时、如何使用它？',
  'decision-basis': '你接受了什么权衡？',
  hypothesis: '还缺什么证据？',
};

export function cognitionCandidateFromDecision(
  decision: WorkosA2uiInterrupt,
  source: CognitionCandidate['source'],
  confirmation: string,
): CognitionCandidate {
  const draft = decision.cognitionCandidate;
  if (!draft) throw new Error('这不是有效的认知候选。');
  const answer = confirmation.trim();
  if (!answer) throw new Error('请先完成这次微型确认。');
  const candidate: CognitionCandidate = { schemaVersion: 1, ...draft, source, confirmation: answer };
  if (draft.type === 'concept') return { ...candidate, currentUnderstanding: answer };
  if (draft.type === 'causal-model') return { ...candidate, rationale: answer };
  if (draft.type === 'judgment-principle' || draft.type === 'method') return { ...candidate, boundary: answer };
  if (draft.type === 'decision-basis') return { ...candidate, rationale: answer };
  return { ...candidate, unresolved: answer };
}
