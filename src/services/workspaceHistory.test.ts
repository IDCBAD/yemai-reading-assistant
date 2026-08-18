import { describe, expect, it } from 'vitest';
import type { Conversation, WorkspaceState } from '../sidepanel/types';
import { clearArchivedConversations, deleteArchivedConversation } from './workspaceHistory';

const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };

function conversation(id: string, archivedAt?: number): Conversation {
  return {
    id,
    title: id,
    subtitle: '历史会话',
    updatedAt: 1,
    archivedAt,
    page,
    pages: [page],
    messages: [],
    draftInput: '',
    draftContextItems: [],
  };
}

function workspace(): WorkspaceState {
  return {
    conversations: [conversation('active'), conversation('archived-one', 10), conversation('archived-two', 20)],
    openTabs: [{ id: 'tab-active', conversationId: 'active', openedAt: 1 }],
    activeOpenTabId: 'tab-active',
  };
}

describe('archived history deletion', () => {
  it('deletes exactly one archived conversation', () => {
    expect(deleteArchivedConversation(workspace(), 'archived-one').conversations.map(({ id }) => id))
      .toEqual(['active', 'archived-two']);
  });

  it('does not delete an active or missing conversation', () => {
    const current = workspace();
    expect(deleteArchivedConversation(current, 'active')).toBe(current);
    expect(deleteArchivedConversation(current, 'missing')).toBe(current);
  });

  it('keeps an inconsistent archived conversation when an open tab still references it', () => {
    const current = workspace();
    current.openTabs.push({ id: 'tab-archived', conversationId: 'archived-one', openedAt: 2 });
    expect(deleteArchivedConversation(current, 'archived-one')).toBe(current);
  });

  it('clears every archived conversation while preserving active and open records', () => {
    const current = workspace();
    current.conversations.push(conversation('archived-open', 30));
    current.openTabs.push({ id: 'tab-archived-open', conversationId: 'archived-open', openedAt: 2 });

    expect(clearArchivedConversations(current).conversations.map(({ id }) => id))
      .toEqual(['active', 'archived-open']);
  });
});
