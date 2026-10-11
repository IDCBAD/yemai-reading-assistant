import type { WorkspaceState } from '../sidepanel/types';
import type { WorkspaceDelta } from '../background/workspaceDelta';
import type { SerializableAgentRequest } from '../background/runAgentRequest';
import type { WorkosInterruptAnswers } from '../services/workosTransport';

export const TASK_PORT = 'workspace-executor';
export interface ExecutorSnapshot {
  epoch: string;
  revision: number;
  confirmed: Record<string, number>;
  workspace: WorkspaceState;
  storageIssue?: string;
  maintenance?: boolean;
}
export type ExecutorCommand =
  | { kind: 'patch'; delta: WorkspaceDelta }
  | { kind: 'submit'; request: SerializableAgentRequest }
  | { kind: 'stop'; conversationId: string; messageId: string }
  | { kind: 'clear-runs' }
  | { kind: 'clear-history' }
  | { kind: 'flush' }
  | { kind: 'maintenance-start' }
  | { kind: 'maintenance-end' }
  | { kind: 'decision'; conversationId: string; messageId: string; decisionId: string; action: 'reply' | 'reject'; answers: WorkosInterruptAnswers };
export interface ExecutorRequest { type: 'executor:command'; epoch: string; clientId: string; sequence: number; command: ExecutorCommand }
export type ExecutorResponse = { ok: true; snapshot: ExecutorSnapshot } | { ok: false; error: string; snapshot?: ExecutorSnapshot; retryable?: boolean };
