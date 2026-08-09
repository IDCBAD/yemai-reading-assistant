import { ThinkingOrb } from 'thinking-orbs';
import type { AgentRunSummary } from '../types';

export function AgentRunStatus({ summary }: { summary: AgentRunSummary | null }) {
  return (
    <div className={`agent-run-status${summary ? ' is-active' : ''}`} aria-live="polite">
      <span className="agent-run-orb" aria-hidden="true">
        {summary && (
          <ThinkingOrb
            state={summary.orbState}
            size={20}
            theme="light"
            aria-label=""
          />
        )}
      </span>
      <span className="agent-run-copy">{summary?.label ?? 'Agent 就绪'}</span>
      <span
        className="agent-queue-count"
        aria-label={summary?.queuedCount ? `${summary.queuedCount} 条消息排队中` : undefined}
      >
        {summary?.queuedCount ? `${summary.queuedCount} 条排队` : ''}
      </span>
    </div>
  );
}
