import type { OpenConversationTab, WorkspaceState } from './types';

export function openConversationInWorkspace(
  workspace: WorkspaceState,
  conversationId: string,
  maxTabs: number,
  createTab: (conversationId: string) => OpenConversationTab,
) {
  const existing = workspace.openTabs.find((tab) => tab.conversationId === conversationId);
  if (existing) return { ...workspace, activeOpenTabId: existing.id };

  const conversation = workspace.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.archivedAt || workspace.openTabs.length >= maxTabs) return workspace;

  const tab = createTab(conversationId);
  return {
    ...workspace,
    openTabs: [...workspace.openTabs, tab],
    activeOpenTabId: tab.id,
  };
}

export function selectWorkspaceTab(workspace: WorkspaceState, tabId: string) {
  if (!workspace.openTabs.some((tab) => tab.id === tabId)) return workspace;
  return { ...workspace, activeOpenTabId: tabId };
}

export function closeWorkspaceTab(workspace: WorkspaceState, tabId: string) {
  const closingIndex = workspace.openTabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0 || workspace.openTabs.length === 1) return workspace;

  const openTabs = workspace.openTabs.filter((tab) => tab.id !== tabId);
  const activeOpenTabId = workspace.activeOpenTabId === tabId
    ? openTabs[Math.min(closingIndex, openTabs.length - 1)]!.id
    : workspace.activeOpenTabId;
  return { ...workspace, openTabs, activeOpenTabId };
}
