import { describe, expect, it } from 'vitest';
import type { ReadingCardRow } from '../data/database';
import { INITIAL_WORKSPACE } from './mockData';
import {
  shouldCloseSearchOnEscape,
  shouldPauseReadingCardsForSearch,
  workspaceSearchScopeForSurface,
  WorkspaceSearchSessionController,
} from './searchSession';

describe('WorkspaceSearchSessionController', () => {
  it('keeps one stable snapshot for the whole open search session', () => {
    const controller = new WorkspaceSearchSessionController();
    const initialCards: ReadingCardRow[] = [];
    const first = controller.open(INITIAL_WORKSPACE, initialCards);
    const updatedWorkspace = { ...INITIAL_WORKSPACE, conversations: [...INITIAL_WORKSPACE.conversations] };
    const updatedCards = [{ id: 'new-card' }] as ReadingCardRow[];

    const repeated = controller.open(updatedWorkspace, updatedCards);

    expect(repeated).toBe(first);
    expect(repeated.workspace).toBe(INITIAL_WORKSPACE);
    expect(repeated.readingCards).toBe(initialCards);
  });

  it('captures the latest data after the previous session closes', () => {
    const controller = new WorkspaceSearchSessionController();
    const first = controller.open(INITIAL_WORKSPACE, []);
    const updatedWorkspace = { ...INITIAL_WORKSPACE, conversations: [...INITIAL_WORKSPACE.conversations] };
    const updatedCards = [{ id: 'new-card' }] as ReadingCardRow[];

    controller.close();
    const reopened = controller.open(updatedWorkspace, updatedCards);

    expect(reopened).not.toBe(first);
    expect(reopened.workspace).toBe(updatedWorkspace);
    expect(reopened.readingCards).toBe(updatedCards);
  });

  it('captures the search scope selected by the surface that opened it', () => {
    const controller = new WorkspaceSearchSessionController();

    const session = controller.open(INITIAL_WORKSPACE, [], 'reading-cards');

    expect(session.initialScope).toBe('reading-cards');
  });
});

describe('contextual workspace search', () => {
  it('uses collection scope when search opens over the collection', () => {
    expect(workspaceSearchScopeForSurface(true)).toBe('reading-cards');
    expect(workspaceSearchScopeForSurface(false)).toBe('all');
  });

  it('pauses the river only while search is visible', () => {
    expect(shouldPauseReadingCardsForSearch(true, false)).toBe(true);
    expect(shouldPauseReadingCardsForSearch(true, true)).toBe(false);
    expect(shouldPauseReadingCardsForSearch(false, false)).toBe(false);
  });

  it('preserves a suspended search when Escape closes the card reader', () => {
    expect(shouldCloseSearchOnEscape(true)).toBe(false);
    expect(shouldCloseSearchOnEscape(false)).toBe(true);
  });
});
