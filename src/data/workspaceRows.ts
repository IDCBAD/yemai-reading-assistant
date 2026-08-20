import type {
  ArtifactRow,
  ConversationRow,
  ConversationSourceRow,
  MessageRow,
  WorkspaceUiState,
} from './database';
import type { PageContext, WorkspaceState } from '../sidepanel/types';
import {
  createWorkspaceSnapshot,
  normalizeWorkspaceSnapshot,
  WORKSPACE_STATE_VERSION,
  type WorkspaceSnapshot,
} from '../services/workspaceState';

export interface WorkspaceRows {
  conversations: ConversationRow[];
  messages: MessageRow[];
  sources: ConversationSourceRow[];
  artifacts: ArtifactRow[];
  ui: WorkspaceUiState;
}

function sourceIdentity(page: PageContext, position: number) {
  return page.sourceId || page.pageId || page.url || `position-${position}`;
}

export function workspaceToRows(workspace: WorkspaceState, savedAt = Date.now()): WorkspaceRows {
  const snapshot = createWorkspaceSnapshot(workspace, savedAt);
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  const sources: ConversationSourceRow[] = [];
  const artifacts: ArtifactRow[] = [];

  snapshot.conversations.forEach((conversation, position) => {
    const { messages: conversationMessages, pages, ...persisted } = conversation;
    conversations.push({
      ...persisted,
      position,
      parentConversationId: conversation.branch?.parentConversationId,
    });

    pages.forEach((page, sourcePosition) => {
      sources.push({
        id: `${conversation.id}:${sourceIdentity(page, sourcePosition)}`,
        conversationId: conversation.id,
        position: sourcePosition,
        sourceId: page.sourceId,
        revisionId: page.contentHash,
        url: page.url,
        sentAt: page.sentAt,
        page,
      });
    });

    conversationMessages.forEach((message, messagePosition) => {
      const { artifacts: messageArtifacts, ...storedMessage } = message;
      messages.push({
        ...storedMessage,
        conversationId: conversation.id,
        position: messagePosition,
      });
      messageArtifacts?.forEach((artifact, artifactPosition) => {
        artifacts.push({
          ...artifact,
          key: `${message.id}:${artifact.id}`,
          conversationId: conversation.id,
          messageId: message.id,
          position: artifactPosition,
        });
      });
    });
  });

  return {
    conversations,
    messages,
    sources,
    artifacts,
    ui: {
      openTabs: snapshot.openTabs,
      activeOpenTabId: snapshot.activeOpenTabId,
      savedAt: snapshot.savedAt,
    },
  };
}

export function rowsToWorkspace(rows: Omit<WorkspaceRows, 'ui'>, ui: WorkspaceUiState, recoveredAt = Date.now()) {
  if (rows.conversations.length === 0) return null;

  const messagesByConversation = new Map<string, MessageRow[]>();
  rows.messages.forEach((message) => {
    const group = messagesByConversation.get(message.conversationId) ?? [];
    group.push(message);
    messagesByConversation.set(message.conversationId, group);
  });
  const sourcesByConversation = new Map<string, ConversationSourceRow[]>();
  rows.sources.forEach((source) => {
    const group = sourcesByConversation.get(source.conversationId) ?? [];
    group.push(source);
    sourcesByConversation.set(source.conversationId, group);
  });
  const artifactsByMessage = new Map<string, ArtifactRow[]>();
  rows.artifacts.forEach((artifact) => {
    const group = artifactsByMessage.get(artifact.messageId) ?? [];
    group.push(artifact);
    artifactsByMessage.set(artifact.messageId, group);
  });

  const conversations = [...rows.conversations]
    .sort((left, right) => left.position - right.position)
    .map((row) => {
      const {
        position: _position,
        parentConversationId: _parentConversationId,
        ...conversation
      } = row;
      const pages = [...(sourcesByConversation.get(row.id) ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((source) => source.page);
      const messages = [...(messagesByConversation.get(row.id) ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((messageRow) => {
          const {
            conversationId: _conversationId,
            position: _messagePosition,
            ...message
          } = messageRow;
          const messageArtifacts = [...(artifactsByMessage.get(message.id) ?? [])]
            .sort((left, right) => left.position - right.position)
            .map((artifactRow) => {
              const {
                key: _artifactKey,
                conversationId: _artifactConversationId,
                messageId: _messageId,
                position: _artifactPosition,
                ...artifact
              } = artifactRow;
              return artifact;
            });
          return {
            ...message,
            ...(messageArtifacts.length ? { artifacts: messageArtifacts } : {}),
          };
        });
      return {
        ...conversation,
        pages: pages.length ? pages : [conversation.page],
        messages,
      };
    });

  const snapshot: WorkspaceSnapshot = {
    version: WORKSPACE_STATE_VERSION,
    conversations,
    openTabs: ui.openTabs,
    activeOpenTabId: ui.activeOpenTabId,
    savedAt: ui.savedAt,
  };
  return normalizeWorkspaceSnapshot(snapshot, recoveredAt);
}
