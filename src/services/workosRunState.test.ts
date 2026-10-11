import { describe, expect, it } from 'vitest';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { Conversation } from '../sidepanel/types';
import { EMPTY_WORKOS_CONNECTION_SETTINGS } from './workosConnection';
import { WORKOS_INTERNAL_V2_BASE_URL } from './workosTransport';
import { hasUnconfirmedWorkosRun } from './workosRunState';

const connection = { ...EMPTY_WORKOS_CONNECTION_SETTINGS, agentUuid: 'agent' };
const conversation: Conversation = { ...INITIAL_WORKSPACE.conversations[0]!, remoteUuid: 'remote', messages: [{
  id: 'answer', role: 'assistant', content: 'partial', createdAt: 1, status: 'stopped',
  remoteRunUnconfirmed: { conversationUuid: 'remote', runId: 'run', transport: 'internal-v2', agentUuid: 'agent',
    apiBase: WORKOS_INTERNAL_V2_BASE_URL, disconnectedAt: 2 },
}] };

describe('unconfirmed WorkOS run submission guard', () => {
  it('blocks only the same remote conversation, agent, API origin, and transport', () => {
    expect(hasUnconfirmedWorkosRun(conversation, connection)).toBe(true);
    expect(hasUnconfirmedWorkosRun(conversation, { ...connection, agentUuid: 'another-agent' })).toBe(false);
    expect(hasUnconfirmedWorkosRun(conversation, { ...connection, transport: 'public-v1' })).toBe(false);
    expect(hasUnconfirmedWorkosRun({ ...conversation, remoteUuid: 'another-remote' }, connection)).toBe(false);
    expect(hasUnconfirmedWorkosRun({ ...conversation, remoteUuid: undefined }, connection)).toBe(false);
    expect(hasUnconfirmedWorkosRun({ ...conversation, messages: [{ ...conversation.messages[0]!, remoteRunUnconfirmed: undefined }] }, connection)).toBe(false);
    expect(hasUnconfirmedWorkosRun({ ...conversation, messages: [{ ...conversation.messages[0]!,
      remoteRunUnconfirmed: { ...conversation.messages[0]!.remoteRunUnconfirmed!, apiBase: 'https://another-origin.example' },
    }] }, connection)).toBe(false);
  });
});
