import { describe, expect, it } from 'vitest';
import { applyWorkspaceDelta, hasWorkspaceDelta, workspaceDelta, type WorkspaceDelta } from './workspaceDelta';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { WorkspaceState } from '../sidepanel/types';

function workspace(): WorkspaceState {
  const state = structuredClone(INITIAL_WORKSPACE);
  const conversation = state.conversations[0]!;
  conversation.id = 'conversation-1';
  conversation.remoteUuid = 'server-conversation';
  conversation.remoteTransport = 'internal-v2';
  conversation.messages = [{ id: 'answer-1', role: 'assistant', content: 'old partial answer', createdAt: 1, status: 'streaming' }];
  conversation.draftInput = '';
  state.openTabs = [{ id: 'tab-1', conversationId: conversation.id, openedAt: 1 }];
  state.activeOpenTabId = 'tab-1';
  return state;
}

describe('workspace deltas', () => {
  it('keeps new stream content when an older client snapshot edits the draft', () => {
    const before = workspace();
    const client = structuredClone(before);
    client.conversations[0]!.draftInput = 'my next question';
    const streamed = structuredClone(before);
    streamed.conversations[0]!.messages[0]!.content = 'new stream content';
    streamed.conversations[0]!.messages[0]!.artifacts = [{ id: 'artifact-1', kind: 'file', filename: 'result.csv', status: 'available' }];
    const merged = applyWorkspaceDelta(streamed, workspaceDelta(before, client), true);
    expect(merged.conversations[0]!.draftInput).toBe('my next question');
    expect(merged.conversations[0]!.messages[0]).toMatchObject({ content: 'new stream content', artifacts: streamed.conversations[0]!.messages[0]!.artifacts });
  });

  it('keeps a newly edited draft when a server update changes only stream fields', () => {
    const before = workspace();
    const local = structuredClone(before);
    local.conversations[0]!.draftInput = 'draft typed during streaming';
    const afterStream = structuredClone(before);
    afterStream.conversations[0]!.messages[0]!.content = 'completed content';
    afterStream.conversations[0]!.messages[0]!.status = 'complete';
    const merged = applyWorkspaceDelta(local, workspaceDelta(before, afterStream));
    expect(merged.conversations[0]!.draftInput).toBe('draft typed during streaming');
    expect(merged.conversations[0]!.messages[0]).toMatchObject({ content: 'completed content', status: 'complete' });
  });

  it('does not let stale UI overwrite remote identity, page delivery metadata or executor messages', () => {
    const before = workspace();
    const attempted = structuredClone(before);
    const c = attempted.conversations[0]!;
    c.title = 'renamed by user';
    c.remoteUuid = 'wrong-remote-conversation';
    c.remoteTransport = 'public-v1';
    c.remoteAgentUuid = 'wrong-agent';
    c.remoteApiBase = 'https://wrong.example';
    c.pendingBranchContext = 'stale branch';
    c.page = { ...c.page, status: 'read', deliveredRemoteUuid: 'wrong-remote-conversation', sentAt: 99 };
    c.pages = [c.page];
    c.messages[0] = { ...c.messages[0]!, content: 'stale or malicious answer', status: 'failed', stopStatus: 'accepted' };
    const merged = applyWorkspaceDelta(before, workspaceDelta(before, attempted), true).conversations[0]!;
    expect(merged.title).toBe('renamed by user');
    expect(merged.remoteUuid).toBe('server-conversation');
    expect(merged.remoteTransport).toBe('internal-v2');
    expect(merged.remoteAgentUuid).toBeUndefined();
    expect(merged.remoteApiBase).toBeUndefined();
    expect(merged.pendingBranchContext).toBeUndefined();
    expect(merged.page).toEqual(before.conversations[0]!.page);
    expect(merged.pages).toEqual(before.conversations[0]!.pages);
    expect(merged.messages).toEqual(before.conversations[0]!.messages);
  });

  it('appends frozen input messages once without replacing an existing message or deleting its history', () => {
    const before = workspace();
    const next = structuredClone(before);
    next.conversations[0]!.messages = [{ id: 'question-2', role: 'user', content: 'next question', createdAt: 2, status: 'complete' }];
    const delta = workspaceDelta(before, next);
    const once = applyWorkspaceDelta(before, delta, true);
    const twice = applyWorkspaceDelta(once, delta, true);
    expect(twice.conversations[0]!.messages.map((m) => m.id)).toEqual(['answer-1', 'question-2']);
    expect(twice.conversations[0]!.messages[0]!.content).toBe('old partial answer');
  });

  it('restricts workspace-level updates to tabs and active tab', () => {
    const before = workspace();
    const delta: WorkspaceDelta = { added: [], removed: [], changed: [], ui: { set: {
      activeOpenTabId: 'tab-2', openTabs: [], conversations: [], accessToken: 'unexpected-token', revision: 99,
    }, unset: ['conversations'] } };
    const merged = applyWorkspaceDelta(before, delta, true);
    expect(merged.activeOpenTabId).toBe('tab-2');
    expect(merged.openTabs).toEqual([]);
    expect(merged.conversations).toEqual(before.conversations);
    expect(merged).not.toHaveProperty('accessToken');
    expect(merged).not.toHaveProperty('revision');
  });

  it('does not recreate removed conversations when an older field update arrives', () => {
    const before = workspace();
    const editing = structuredClone(before);
    editing.conversations[0]!.draftInput = 'late draft';
    const deleted: WorkspaceState = { conversations: [], openTabs: [], activeOpenTabId: '' };
    const afterDelete = applyWorkspaceDelta(before, workspaceDelta(before, deleted), true);
    const afterLateEdit = applyWorkspaceDelta(afterDelete, workspaceDelta(before, editing), true);
    expect(afterLateEdit.conversations).toEqual([]);
  });

  it('applies allowed field removals and detects unchanged snapshots', () => {
    const before = workspace();
    before.conversations[0]!.archivedAt = 123;
    expect(hasWorkspaceDelta(workspaceDelta(before, structuredClone(before)))).toBe(false);
    const next = structuredClone(before);
    delete next.conversations[0]!.archivedAt;
    const delta = workspaceDelta(before, next);
    expect(hasWorkspaceDelta(delta)).toBe(true);
    expect(delta.changed[0]!.fields.unset).toContain('archivedAt');
    expect(applyWorkspaceDelta(before, delta, true).conversations[0]).not.toHaveProperty('archivedAt');
  });

  it('does not replace an existing conversation when a duplicate added record arrives', () => {
    const before = workspace();
    const replacement = structuredClone(before.conversations[0]!);
    replacement.messages[0]!.content = 'replacement content';
    const delta: WorkspaceDelta = { added: [replacement], removed: [], changed: [], ui: { set: {}, unset: [] } };
    expect(applyWorkspaceDelta(before, delta, true).conversations).toEqual(before.conversations);
  });
});
