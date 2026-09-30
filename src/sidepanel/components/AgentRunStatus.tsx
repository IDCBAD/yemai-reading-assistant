import { useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import type { AgentRunSummary } from '../types';
import { formatRunDuration } from '../runDuration';

export function AgentRunStatus({ summary, startedAt }: { summary: AgentRunSummary | null; startedAt?: number }) {
  const [lastSummary, setLastSummary] = useState(summary);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!summary || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [summary?.activeMessageId, startedAt]);
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
  const elapsed = summary && startedAt ? formatRunDuration(startedAt, now) : null;

  return (
    <div className={`agent-run-status${summary ? ' is-active' : ' is-leaving'}`} aria-hidden={!summary || undefined}>
      <span className="agent-run-orb" aria-hidden="true">
        <ThinkingOrb state={visibleSummary.orbState} size={20} theme="light"
          paused={!summary || visibleSummary.stage === 'waiting-user-input'} aria-label="" />
      </span>
      <span className="agent-run-copy" role="status" aria-live="polite">{visibleSummary.label}</span>
      {elapsed && <span className="agent-run-elapsed" role="timer" aria-live="off">已用时 {elapsed}</span>}
    </div>
  );
}
