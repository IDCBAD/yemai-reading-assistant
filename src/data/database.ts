import Dexie, { type Table } from 'dexie';
import type {
  AssistantArtifact,
  ChatMessage,
  ContextItem,
  Conversation,
  ConversationBranch,
  OpenConversationTab,
  PageContext,
} from '../sidepanel/types';
import type { WorkosTransportKind } from '../services/workosTransport';

export const YEMAI_DATABASE_NAME = 'yemai-reading-assistant';
export const YEMAI_DATABASE_VERSION = 1;

export interface ConversationRow {
  id: string;
  position: number;
  remoteUuid?: string;
  remoteTransport?: WorkosTransportKind;
  remoteAgentUuid?: string;
  pendingBranchContext?: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  isDraft?: boolean;
  archivedAt?: number;
  branch?: ConversationBranch;
  parentConversationId?: string;
  page: PageContext;
  draftInput: string;
  draftContextItems: ContextItem[];
}

export interface MessageRow extends Omit<ChatMessage, 'artifacts'> {
  conversationId: string;
  position: number;
}

export interface ConversationSourceRow {
  id: string;
  conversationId: string;
  position: number;
  sourceId?: string;
  revisionId?: string;
  url: string;
  sentAt?: number;
  page: PageContext;
}

export interface ArtifactRow extends AssistantArtifact {
  key: string;
  conversationId: string;
  messageId: string;
  position: number;
}

export interface WorkspaceUiState {
  openTabs: OpenConversationTab[];
  activeOpenTabId: string;
  savedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class YemaiDatabase extends Dexie {
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  conversationSources!: Table<ConversationSourceRow, string>;
  artifacts!: Table<ArtifactRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = YEMAI_DATABASE_NAME) {
    super(name);
    this.version(YEMAI_DATABASE_VERSION).stores({
      conversations: '&id,position,updatedAt,archivedAt,parentConversationId',
      messages: '&id,conversationId,[conversationId+position],createdAt,role,status',
      conversationSources: '&id,conversationId,[conversationId+position],sourceId,revisionId,url,sentAt',
      artifacts: '&key,id,conversationId,messageId,[messageId+position],filename,status',
      meta: '&key',
    });
  }
}

export const yemaiDatabase = new YemaiDatabase();
