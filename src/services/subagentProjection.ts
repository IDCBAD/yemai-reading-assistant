import type { SubagentSnapshot } from '../shared/agentActivity';

/** WorkOS task-tool fields only. Never project generic tool arguments, reasoning or output. */

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : undefined;

export function projectSubagent(part: RecordValue): SubagentSnapshot | undefined {
  if (typeof part.tool !== 'string' || part.tool.toLowerCase() !== 'task') return;
  const state = record(part.state) ? part.state : {};
  const input = record(state.input) ? state.input : {};
  const metadata = record(state.metadata) ? state.metadata : {};
  const rawSession = metadata.sessionId ?? metadata.sessionID;
  const sessionId = typeof rawSession === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(rawSession) ? rawSession : undefined;
  const prompt = text(input.prompt, 12_000);
  const agentType = text(input.subagent_type, 80);
  const rawOutput = typeof state.output === 'string' && state.status === 'completed' ? state.output : undefined;
  // task_result is the tool's returned child answer; do not render transport/session wrapper text.
  const wrapped = rawOutput?.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/);
  const result = wrapped?.[1] ?? rawOutput;
  const answer = text(result, 24_000);
  return {
    ...(sessionId ? { sessionId } : {}), ...(agentType ? { agentType } : {}),
    ...(prompt ? { prompt } : {}), ...(answer ? { answer } : {}),
    ...((typeof input.prompt === 'string' && input.prompt.length > 12_000) || (result?.length ?? 0) > 24_000 ? { truncated: true } : {}),
  };
}
