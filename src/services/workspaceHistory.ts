import type { WorkspaceState } from '../sidepanel/types';

export function deleteArchivedConversation(workspace: WorkspaceState, conversationId: string): WorkspaceState {
  const target = workspace.conversations.find((conversation) => conversation.id === conversationId);
  if (target?.archivedAt === undefined) return workspace;
  if (workspace.openTabs.some((tab) => tab.conversationId === conversationId)) return workspace;
  return {
    ...workspace,
    conversations: workspace.conversations.filter((conversation) => conversation.id !== conversationId),
  };
}

export function clearArchivedConversations(workspace: WorkspaceState): WorkspaceState {
  const openConversationIds = new Set(workspace.openTabs.map((tab) => tab.conversationId));
  const conversations = workspace.conversations.filter((conversation) =>
    conversation.archivedAt === undefined || openConversationIds.has(conversation.id));
  return conversations.length === workspace.conversations.length
    ? workspace
    : { ...workspace, conversations };
}
