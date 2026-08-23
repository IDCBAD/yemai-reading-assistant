import { describe, expect, it } from 'vitest';
import type { Conversation, WorkspaceState } from './types';
import {
  commandPaletteHighlightParts,
  nextCommandPaletteIndex,
  openCommandPaletteResult,
} from './commandPalette';

const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };

function conversation(id: string, archivedAt?: number): Conversation {
  return {
    id,
    title: id,
    subtitle: '刚刚',
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
    conversations: [conversation('open'), conversation('archived', 10)],
    openTabs: [{ id: 'tab-open', conversationId: 'open', openedAt: 1 }],
    activeOpenTabId: 'tab-open',
  };
}

describe('openCommandPaletteResult', () => {
  it('restores an archived result and opens it in one operation', () => {
    const next = openCommandPaletteResult(workspace(), { conversationId: 'archived' }, 3, (conversationId) => ({
      id: 'tab-restored', conversationId, openedAt: 2,
    }));
    expect(next.conversations.find((item) => item.id === 'archived')?.archivedAt).toBeUndefined();
    expect(next.openTabs.at(-1)).toMatchObject({ conversationId: 'archived' });
    expect(next.activeOpenTabId).toBe('tab-restored');
  });

  it('does not restore a result when no work page is available', () => {
    const current = workspace();
    const next = openCommandPaletteResult(current, { conversationId: 'archived' }, 1, () => {
      throw new Error('should not create a tab');
    });
    expect(next).toBe(current);
    expect(next.conversations.find((item) => item.id === 'archived')?.archivedAt).toBe(10);
  });
});

describe('nextCommandPaletteIndex', () => {
  it('wraps in both directions', () => {
    expect(nextCommandPaletteIndex(2, 1, 3)).toBe(0);
    expect(nextCommandPaletteIndex(0, -1, 3)).toBe(2);
  });

  it('skips results that cannot be opened', () => {
    expect(nextCommandPaletteIndex(0, 1, 4, new Set([1, 2]))).toBe(3);
    expect(nextCommandPaletteIndex(-1, 1, 2, new Set([0, 1]))).toBe(-1);
  });
});

describe('commandPaletteHighlightParts', () => {
  it('marks a case-insensitive exact query without using HTML injection', () => {
    expect(commandPaletteHighlightParts('Agent Evaluation Matrix', 'evaluation')).toEqual([
      { value: 'Agent ', match: false },
      { value: 'Evaluation', match: true },
      { value: ' Matrix', match: false },
    ]);
  });

  it('highlights the actual indexed terms when a natural-language query is not contiguous', () => {
    expect(commandPaletteHighlightParts('智能体的可靠性值得评估', '智能体可靠性', ['智能', '体', '可靠性']))
      .toEqual([
        { value: '智能', match: true },
        { value: '体', match: true },
        { value: '的', match: false },
        { value: '可靠性', match: true },
        { value: '值得评估', match: false },
      ]);
  });

  it('renders the searched word at its original position after a leading ellipsis', () => {
    expect(commandPaletteHighlightParts('…，但不能替代“意义判断型”的工作', '意义', ['意义']))
      .toEqual([
        { value: '…，但不能替代“', match: false },
        { value: '意义', match: true },
        { value: '判断型”的工作', match: false },
      ]);
  });
});
