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
import type { CognitionProjectionRow } from '../cognition/cognitionLoop';

export const YEMAI_DATABASE_NAME = 'yemai-reading-assistant';
export const YEMAI_DATABASE_VERSION = 3;

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

export interface ReadingCardSource {
  title: string;
  url: string;
  site?: string;
}

export type ReadingCardKind = 'answer' | 'excerpt';

export interface ReadingCardRow {
  id: string;
  /** Missing on cards saved before excerpt collection existed; treat as `answer`. */
  kind?: ReadingCardKind;
  sourceConversationId: string;
  sourceMessageId: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  sources: ReadingCardSource[];
  artifacts: AssistantArtifact[];
  messageCreatedAt: number;
  createdAt: number;
  updatedAt: number;
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
  readingCards!: Table<ReadingCardRow, string>;
  cognitionProjection!: Table<CognitionProjectionRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = YEMAI_DATABASE_NAME) {
    super(name);
    const workspaceStores = {
      conversations: '&id,position,updatedAt,archivedAt,parentConversationId',
      messages: '&id,conversationId,[conversationId+position],createdAt,role,status',
      conversationSources: '&id,conversationId,[conversationId+position],sourceId,revisionId,url,sentAt',
      artifacts: '&key,id,conversationId,messageId,[messageId+position],filename,status',
      meta: '&key',
    };
    this.version(1).stores(workspaceStores);
    this.version(2).stores({
      ...workspaceStores,
      readingCards: '&id,sourceConversationId,sourceMessageId,[sourceConversationId+sourceMessageId],createdAt,updatedAt',
    });
    this.version(YEMAI_DATABASE_VERSION).stores({
      ...workspaceStores,
      readingCards: '&id,sourceConversationId,sourceMessageId,[sourceConversationId+sourceMessageId],createdAt,updatedAt',
      cognitionProjection: '&id,filename,type,status,updatedAt',
    });
  }
}

export const yemaiDatabase = new YemaiDatabase();
