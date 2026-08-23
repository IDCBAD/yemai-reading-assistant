import { describe, expect, it } from 'vitest';
import type { Conversation } from './types';
import { createReadingCard, openReadingCardSourceInWorkspace, readingCardSourceAvailable } from './readingCards';

function conversation(): Conversation {
  const page = { title: 'Agent 文章', site: 'example.com', url: 'https://example.com/agent', status: 'read' as const };
  return {
    id: 'conversation-1',
    title: 'Agent 评估讨论',
    subtitle: '1 个页面',
    updatedAt: 10,
    page,
    pages: [page],
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: '## 评估框架\n\n可靠性与安全性都很重要。',
      createdAt: 11,
      respondedAt: 12,
      status: 'complete',
    }],
    draftInput: '',
    draftContextItems: [],
  };
}

describe('createReadingCard', () => {
  it('creates a stable readable snapshot with provenance', () => {
    const source = conversation();
    const card = createReadingCard(source, source.messages[0]!, [], 20);
    expect(card).toMatchObject({
      id: 'reading-card:conversation-1:message-1',
      title: '评估框架',
      bodyMarkdown: source.messages[0]!.content,
      messageCreatedAt: 12,
      createdAt: 20,
    });
    expect(card.excerpt).toContain('可靠性与安全性');
    expect(card.sources[0]).toMatchObject({ url: 'https://example.com/agent' });
  });

  it('remains readable when the original conversation is gone', () => {
    const source = conversation();
    const card = createReadingCard(source, source.messages[0]!, [], 20);
    expect(readingCardSourceAvailable(card, [source])).toBe(true);
    expect(readingCardSourceAvailable(card, [])).toBe(false);
    expect(card.bodyMarkdown).toContain('可靠性');
  });

  it('restores an archived source and opens its work page atomically', () => {
    const source = conversation();
    source.archivedAt = 30;
    const card = createReadingCard(source, source.messages[0]!, [], 20);
    const workspace = { conversations: [source], openTabs: [], activeOpenTabId: '' };

    const next = openReadingCardSourceInWorkspace(workspace, card, 10, (conversationId) => ({
      id: 'open-1', conversationId, openedAt: 40,
    }));

    expect(next.conversations[0]?.archivedAt).toBeUndefined();
    expect(next.openTabs[0]).toMatchObject({ conversationId: source.id });
    expect(next.activeOpenTabId).toBe('open-1');
  });

  it('does not partially restore a source when the work page limit is reached', () => {
    const source = conversation();
    source.archivedAt = 30;
    const card = createReadingCard(source, source.messages[0]!, [], 20);
    const workspace = {
      conversations: [source],
      openTabs: [{ id: 'occupied', conversationId: 'another', openedAt: 1 }],
      activeOpenTabId: 'occupied',
    };

    const next = openReadingCardSourceInWorkspace(workspace, card, 1, () => {
      throw new Error('should not create a work page');
    });

    expect(next).toBe(workspace);
    expect(next.conversations[0]?.archivedAt).toBe(30);
  });
});
