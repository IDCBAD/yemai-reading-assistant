import { useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { AgentRunSummary } from '../types';

export function AgentRunStatus({ summary }: { summary: AgentRunSummary | null }) {
  const [lastSummary, setLastSummary] = useState(summary);
  useEffect(() => {
    if (summary) {
      setLastSummary((previous) => previous?.activeMessageId === summary.activeMessageId
        && previous.stage === summary.stage && previous.label === summary.label
        && previous.orbState === summary.orbState ? previous : summary);
      return;
    }
    if (!lastSummary) return;
    const timer = window.setTimeout(() => setLastSummary(null), 160);
    return () => window.clearTimeout(timer);
  }, [summary]);
  const visibleSummary = summary ?? lastSummary;
  if (!visibleSummary) return null;

  return (
    <div className={`agent-run-status${summary ? ' is-active' : ' is-leaving'}`} role="status" aria-live="polite" aria-hidden={!summary || undefined}>
      <span className="agent-run-orb" aria-hidden="true">
        <ThinkingOrb state={visibleSummary.orbState} size={20} theme="light"
          paused={!summary || visibleSummary.stage === 'waiting-user-input'} aria-label="" />
      </span>
      <span className="agent-run-copy">{visibleSummary.label}</span>
    </div>
  );
}
