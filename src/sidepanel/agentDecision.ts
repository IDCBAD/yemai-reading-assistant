import type { AgentDecision, AgentDecisionField } from './types';
import type { WorkosA2uiInterrupt, WorkosInterruptResolution } from '../services/workosSse';
import type { WorkosInterruptAnswers } from '../services/workosTransport';

export function initialAgentDecisionAnswers(fields: AgentDecisionField[]): WorkosInterruptAnswers {
  return Object.fromEntries(fields.map((field) => [
    field.label,
    field.type === 'multi-select' ? [...field.defaultValue] : field.defaultValue,
  ]));
}

export function normalizeAgentDecisionAnswers(
  fields: AgentDecisionField[],
  candidate: WorkosInterruptAnswers,
): WorkosInterruptAnswers {
  const answers = Object.create(null) as WorkosInterruptAnswers;
  fields.forEach((field) => {
    const value = candidate[field.label];
    if (field.type === 'text') {
      answers[field.label] = typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, 4_000) : '';
      return;
    }
    if (field.type === 'single-select') {
      answers[field.label] = typeof value === 'string' && field.options.includes(value) ? value : '';
      return;
    }
    const selected = Array.isArray(value)
      ? value.filter((option): option is string => typeof option === 'string' && field.options.includes(option))
      : [];
    answers[field.label] = [...new Set(selected)].slice(0, field.options.length);
  });
  return answers;
}

export function messageDecisionInteractions(message: {
  interactions?: AgentDecision[];
  decision?: AgentDecision;
}) {
  const interactions = message.interactions ?? (message.decision ? [message.decision] : []);
  return interactions.filter((interaction) => {
    const legacy = interaction as AgentDecision & { purpose?: string; cognitionCandidate?: unknown; cognitionReceipt?: unknown };
    return legacy.purpose !== 'cognition-candidate' && !legacy.cognitionCandidate && !legacy.cognitionReceipt;
  });
}

export function upsertAgentInteraction(
  interactions: AgentDecision[],
  interrupt: WorkosA2uiInterrupt,
) {
  const index = interactions.findIndex((interaction) => interaction.id === interrupt.id);
  const existing = index >= 0 ? interactions[index] : undefined;
  const next: AgentDecision = {
    ...interrupt,
    status: existing?.status ?? 'pending',
    ...(existing?.submittedAction ? { submittedAction: existing.submittedAction } : {}),
    ...(existing?.answers ? { answers: existing.answers } : {}),
    ...(existing?.errorMessage ? { errorMessage: existing.errorMessage } : {}),
  };
  return index < 0
    ? [...interactions, next]
    : interactions.map((interaction, interactionIndex) => interactionIndex === index ? next : interaction);
}

export function settleAgentInteraction(
  interactions: AgentDecision[],
  resolution: WorkosInterruptResolution,
) {
  return interactions.map((interaction) => {
    if (interaction.id !== resolution.requestId || interaction.sessionId !== resolution.sessionId) return interaction;
    return {
      ...interaction,
      status: resolution.outcome,
      submittedAction: resolution.outcome === 'replied' ? 'reply' as const : 'reject' as const,
      ...(resolution.data ? { answers: resolution.data } : {}),
      errorMessage: undefined,
    };
  });
}
