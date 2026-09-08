import { describe, expect, it, vi } from 'vitest';
import type { ReadingCardRow } from '../data/database';
import type { WorkspaceSearchIndex } from '../search/workspaceSearch';
import { INITIAL_WORKSPACE } from './mockData';
import type { WorkspaceSearchSession } from './searchSession';
import { WorkspaceSearchIndexCache } from './workspaceSearchIndexCache';

function session(
  workspace = INITIAL_WORKSPACE,
  readingCards: ReadingCardRow[] = [],
): WorkspaceSearchSession {
  return { workspace, readingCards, initialScope: 'all' };
}

describe('WorkspaceSearchIndexCache', () => {
  it('reuses the index when search reopens without data changes', () => {
    const index = { documentCount: 1 } as WorkspaceSearchIndex;
    const build = vi.fn(() => index);
    const cache = new WorkspaceSearchIndexCache(build);
    const readingCards: ReadingCardRow[] = [];

    const first = cache.getOrCreate(session(INITIAL_WORKSPACE, readingCards));
    const reopened = cache.getOrCreate(session(INITIAL_WORKSPACE, readingCards));

    expect(reopened).toBe(first);
    expect(build).toHaveBeenCalledOnce();
  });

  it('does not build while checking whether a warm index exists', () => {
    const build = vi.fn(() => ({ documentCount: 1 }) as WorkspaceSearchIndex);
    const cache = new WorkspaceSearchIndexCache(build);
    const current = session();

    expect(cache.peek(current)).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });

  it('rebuilds after either workspace or reading cards change', () => {
    const build = vi.fn((current: WorkspaceSearchSession) => ({
      documentCount: current.workspace.conversations.length + current.readingCards.length,
    }) as WorkspaceSearchIndex);
    const cache = new WorkspaceSearchIndexCache(build);
    const readingCards: ReadingCardRow[] = [];
    const initial = session(INITIAL_WORKSPACE, readingCards);

    cache.getOrCreate(initial);
    cache.getOrCreate(session({ ...INITIAL_WORKSPACE }, readingCards));
    cache.getOrCreate(session(INITIAL_WORKSPACE, [...readingCards]));

    expect(build).toHaveBeenCalledTimes(3);
  });
});
