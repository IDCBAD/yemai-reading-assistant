import { describe, expect, it } from 'vitest';
import type { Conversation } from './types';
import { buildConversationForest } from './conversationHierarchy';

const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };

function conversation(id: string, updatedAt: number, parentConversationId?: string): Conversation {
  return {
    id,
    title: id,
    subtitle: '刚刚',
    updatedAt,
    branch: parentConversationId ? {
      rootConversationId: 'root',
      parentConversationId,
      ordinal: updatedAt,
    } : undefined,
    page,
    pages: [page],
    messages: [],
    draftInput: '',
    draftQuotes: [],
    draftAttachments: [],
    draftPageReference: { url: page.url, mode: 'included' },
  };
}

describe('conversation history hierarchy', () => {
  it('nests branches under their direct parent and promotes active groups by descendant recency', () => {
    const forest = buildConversationForest([
      conversation('older-root', 30),
      conversation('root', 10),
      conversation('branch-1', 20, 'root'),
      conversation('branch-2', 40, 'branch-1'),
    ]);

    expect(forest.map((node) => node.conversation.id)).toEqual(['root', 'older-root']);
    expect(forest[0]?.children[0]?.conversation.id).toBe('branch-1');
    expect(forest[0]?.children[0]?.children[0]?.conversation.id).toBe('branch-2');
  });

  it('keeps a branch accessible when its parent is absent from the current history view', () => {
    const forest = buildConversationForest([conversation('orphan', 20, 'archived-parent')]);
    expect(forest[0]?.conversation.id).toBe('orphan');
  });
});
