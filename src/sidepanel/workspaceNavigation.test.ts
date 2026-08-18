import { describe, expect, it } from 'vitest';
import type { Conversation, WorkspaceState } from './types';
import { closeWorkspaceTab, openConversationInWorkspace, selectWorkspaceTab } from './workspaceNavigation';

const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };

function conversation(id: string): Conversation {
  return {
    id,
    title: id,
    subtitle: '刚刚',
    updatedAt: 1,
    page,
    pages: [page],
    messages: [],
    draftInput: '',
    draftContextItems: [],
  };
}

function workspace(): WorkspaceState {
  return {
    conversations: [conversation('one'), conversation('two'), conversation('three')],
    openTabs: [
      { id: 'tab-one', conversationId: 'one', openedAt: 1 },
      { id: 'tab-two', conversationId: 'two', openedAt: 2 },
    ],
    activeOpenTabId: 'tab-one',
  };
}

describe('workspace conversation navigation', () => {
  it('keeps each remote conversation identity stable across an A → B → A switch', () => {
    const current = workspace();
    current.conversations[0]!.remoteUuid = 'remote-a';
    current.conversations[1]!.remoteUuid = 'remote-b';

    const onB = selectWorkspaceTab(current, 'tab-two');
    const backOnA = selectWorkspaceTab(onB, 'tab-one');

    expect(backOnA.activeOpenTabId).toBe('tab-one');
    expect(backOnA.conversations.find((item) => item.id === 'one')?.remoteUuid).toBe('remote-a');
    expect(backOnA.conversations.find((item) => item.id === 'two')?.remoteUuid).toBe('remote-b');
  });

  it('opens closed history in a new work page without replacing the current one', () => {
    const next = openConversationInWorkspace(workspace(), 'three', 10, (conversationId) => ({
      id: 'tab-three', conversationId, openedAt: 3,
    }));

    expect(next.openTabs.map((tab) => tab.conversationId)).toEqual(['one', 'two', 'three']);
    expect(next.activeOpenTabId).toBe('tab-three');
  });

  it('focuses an already open conversation and does not duplicate its work page', () => {
    const next = openConversationInWorkspace(workspace(), 'two', 10, () => {
      throw new Error('should not create a tab');
    });

    expect(next.openTabs).toHaveLength(2);
    expect(next.activeOpenTabId).toBe('tab-two');
  });

  it('does not replace the current work page when the limit is reached', () => {
    const current = workspace();
    const next = openConversationInWorkspace(current, 'three', 2, () => {
      throw new Error('should not create a tab');
    });
    expect(next).toBe(current);
  });

  it('keeps the last work page instead of creating an implicit conversation', () => {
    const current = workspace();
    current.openTabs = [current.openTabs[0]!];
    const next = closeWorkspaceTab(current, 'tab-one');
    expect(next).toBe(current);
  });
});
