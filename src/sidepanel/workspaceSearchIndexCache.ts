import {
  createWorkspaceSearchIndex,
  type WorkspaceSearchIndex,
} from '../search/workspaceSearch';
import type { WorkspaceSearchSession } from './searchSession';

type SearchIndexBuilder = (session: WorkspaceSearchSession) => WorkspaceSearchIndex;

export interface WorkspaceSearchIndexCacheLike {
  peek: (session: WorkspaceSearchSession) => WorkspaceSearchIndex | null;
  getOrCreate: (session: WorkspaceSearchSession) => WorkspaceSearchIndex;
}

function buildWorkspaceSearchSessionIndex(session: WorkspaceSearchSession) {
  return createWorkspaceSearchIndex(session.workspace, session.readingCards);
}

export class WorkspaceSearchIndexCache implements WorkspaceSearchIndexCacheLike {
  private cached: {
    workspace: WorkspaceSearchSession['workspace'];
    readingCards: WorkspaceSearchSession['readingCards'];
    index: WorkspaceSearchIndex;
  } | null = null;

  constructor(private readonly build: SearchIndexBuilder = buildWorkspaceSearchSessionIndex) {}

  peek(session: WorkspaceSearchSession) {
    return this.cached?.workspace === session.workspace
      && this.cached.readingCards === session.readingCards
      ? this.cached.index
      : null;
  }

  getOrCreate(session: WorkspaceSearchSession) {
    const existing = this.peek(session);
    if (existing) return existing;
    const index = this.build(session);
    this.cached = {
      workspace: session.workspace,
      readingCards: session.readingCards,
      index,
    };
    return index;
  }
}

export const workspaceSearchIndexCache = new WorkspaceSearchIndexCache();
