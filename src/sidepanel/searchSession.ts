import type { ReadingCardRow } from '../data/database';
import type { WorkspaceState } from './types';

export interface WorkspaceSearchSession {
  workspace: WorkspaceState;
  readingCards: ReadingCardRow[];
}

export class WorkspaceSearchSessionController {
  private currentSession: WorkspaceSearchSession | null = null;

  open(workspace: WorkspaceState, readingCards: ReadingCardRow[]): WorkspaceSearchSession {
    if (!this.currentSession) {
      this.currentSession = { workspace, readingCards };
    }
    return this.currentSession;
  }

  close() {
    this.currentSession = null;
  }
}
