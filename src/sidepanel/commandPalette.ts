import type { WorkspaceSearchResult } from '../search/workspaceSearch';
import { findSearchTextMatches } from '../search/searchTextMatches';
import type { OpenConversationTab, WorkspaceState } from './types';
import { openConversationInWorkspace } from './workspaceNavigation';

export function openCommandPaletteResult(
  workspace: WorkspaceState,
  result: Pick<WorkspaceSearchResult, 'conversationId'>,
  maxTabs: number,
  createTab: (conversationId: string) => OpenConversationTab,
) {
  const target = workspace.conversations.find((conversation) => conversation.id === result.conversationId);
  const alreadyOpen = workspace.openTabs.some((tab) => tab.conversationId === result.conversationId);
  if (!target || (!alreadyOpen && workspace.openTabs.length >= maxTabs)) return workspace;
  const restored = target.archivedAt === undefined
    ? workspace
    : {
        ...workspace,
        conversations: workspace.conversations.map((conversation) => conversation.id === result.conversationId
          ? { ...conversation, archivedAt: undefined }
          : conversation),
      };
  return openConversationInWorkspace(restored, result.conversationId, maxTabs, createTab);
}

export function nextCommandPaletteIndex(
  currentIndex: number,
  direction: 1 | -1,
  itemCount: number,
  disabledIndexes: ReadonlySet<number> = new Set(),
) {
  if (itemCount <= 0 || disabledIndexes.size >= itemCount) return -1;
  let index = currentIndex;
  for (let attempt = 0; attempt < itemCount; attempt += 1) {
    index = (index + direction + itemCount) % itemCount;
    if (!disabledIndexes.has(index)) return index;
  }
  return -1;
}

export function commandPaletteHighlightParts(value: string, query: string, matchedTerms: string[] = []) {
  const matches = findSearchTextMatches(value, query, matchedTerms);
  if (matches.length === 0) return [{ value, match: false }];
  const parts: Array<{ value: string; match: boolean }> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) parts.push({ value: value.slice(cursor, match.start), match: false });
    parts.push({ value: value.slice(match.start, match.end), match: true });
    cursor = match.end;
  }
  if (cursor < value.length) parts.push({ value: value.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ value, match: false }];
}
