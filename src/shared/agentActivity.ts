/** Provider-independent, bounded child-task details persisted with a message. */
export interface SubagentSnapshot {
  sessionId?: string;
  agentType?: string;
  prompt?: string;
  answer?: string;
  truncated?: boolean;
}
