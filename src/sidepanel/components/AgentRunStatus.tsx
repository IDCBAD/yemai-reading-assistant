import { ThinkingOrb } from 'thinking-orbs';
import type { AgentRunSummary } from '../types';

export function AgentRunStatus({ summary }: { summary: AgentRunSummary | null }) {
  if (!summary) return null;

  return (
    <div className="agent-run-status is-active" aria-live="polite">
      <span className="agent-run-orb" aria-hidden="true">
        <ThinkingOrb
          state={summary.orbState}
          size={20}
          theme="light"
          aria-label=""
        />
      </span>
      <span className="agent-run-copy">{summary.label}</span>
      <span
        className="agent-queue-count"
        aria-label={summary.queuedCount ? `${summary.queuedCount} 条消息排队中` : undefined}
      >
        {summary.queuedCount ? `${summary.queuedCount} 条排队` : ''}
      </span>
    </div>
  );
}
