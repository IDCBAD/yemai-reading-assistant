import type { ReadingCardRow } from '../data/database';
import type { WorkspaceSearchScope } from '../search/workspaceSearch';
import type { WorkspaceState } from './types';

export interface WorkspaceSearchSession {
  workspace: WorkspaceState;
  readingCards: ReadingCardRow[];
  initialScope: WorkspaceSearchScope;
}

export function workspaceSearchScopeForSurface(readingCardsOpen: boolean): WorkspaceSearchScope {
  return readingCardsOpen ? 'reading-cards' : 'all';
}

export function shouldCloseSearchOnEscape(suspended: boolean) {
  return !suspended;
}

export function shouldPauseReadingCardsForSearch(searchOpen: boolean, suspended: boolean) {
  return searchOpen && !suspended;
}

export class WorkspaceSearchSessionController {
  private currentSession: WorkspaceSearchSession | null = null;

  open(
    workspace: WorkspaceState,
    readingCards: ReadingCardRow[],
    initialScope: WorkspaceSearchScope = 'all',
  ): WorkspaceSearchSession {
    if (!this.currentSession) {
      this.currentSession = { workspace, readingCards, initialScope };
    }
    return this.currentSession;
  }

  close() {
    this.currentSession = null;
  }
}
