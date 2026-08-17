import type { PageManifest, YemaiAccessHint, YemaiPageType } from '../shared/yemaiContext';
import type { WorkosTransportKind } from '../services/workosTransport';

export type PageStatus = 'not-read' | 'reading' | 'ready' | 'read' | 'changed';

export interface PageContext {
  title: string;
  site: string;
  url: string;
  status: PageStatus;
  browserTabId?: number;
  pageId?: string;
  sourceId?: string;
  contentHash?: string;
  extractedAt?: number;
  sentAt?: number;
  version?: number;
  pageType?: YemaiPageType;
  accessHint?: YemaiAccessHint;
  manifest?: PageManifest;
  quality?: 'high' | 'partial' | 'fallback';
  truncated?: boolean;
}

export type DraftPageReferenceMode = 'included' | 'excluded';

export interface DraftPageReference {
  url: string;
  mode: DraftPageReferenceMode;
}

export interface QuoteReference {
  id: string;
  text: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: number;
  origin?: 'page' | 'assistant';
  sourceMessageId?: string;
}

export type AttachmentStatus = 'uploading' | 'ready' | 'failed';

export interface DraftAttachment {
  id: string;
  filename: string;
  sizeLabel: string;
  status: AttachmentStatus;
  mime?: string;
  url?: string;
  previewUrl?: string;
  uploadTransport?: WorkosTransportKind;
  errorMessage?: string;
}

export type ContextItemKind = 'page' | 'selection' | 'file' | 'image' | 'memory' | 'link';
export type ContextItemStatus = 'preparing' | 'ready' | 'failed';

interface ContextItemBase {
  id: string;
  kind: ContextItemKind;
  included: boolean;
  status: ContextItemStatus;
  createdAt: number;
  issue?: string;
}

export interface PageContextItem extends ContextItemBase {
  kind: 'page';
  page: PageContext;
  role: 'current' | 'referenced';
  delivery?: 'introduce' | 'update' | 'reuse';
}

export interface SelectionContextItem extends ContextItemBase {
  kind: 'selection';
  selection: QuoteReference;
}

export interface FileContextItem extends ContextItemBase {
  kind: 'file';
  attachment: DraftAttachment;
}

export interface ImageContextItem extends ContextItemBase {
  kind: 'image';
  attachment: DraftAttachment;
}

export interface MemoryContextItem extends ContextItemBase {
  kind: 'memory';
  memory: {
    title: string;
    excerpt: string;
    sourceId?: string;
  };
}

export interface LinkContextItem extends ContextItemBase {
  kind: 'link';
  link: {
    title: string;
    url: string;
    site?: string;
  };
}

export type ContextItem =
  | PageContextItem
  | SelectionContextItem
  | FileContextItem
  | ImageContextItem
  | MemoryContextItem
  | LinkContextItem;

export type MessageStatus = 'queued' | 'running' | 'streaming' | 'complete' | 'stopped' | 'failed';
export type MessageStage = 'queued' | 'reading-page' | 'creating-conversation' | 'waiting-first-token' | 'streaming';
export type MessagePresentation = 'page-overview';
export type AgentOrbState = 'searching' | 'listening' | 'working' | 'composing' | 'shaping';
export type RunActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface AgentRunSummary {
  activeMessageId: string;
  status: 'running' | 'streaming';
  stage: Exclude<MessageStage, 'queued'>;
  label: string;
  orbState: AgentOrbState;
  queuedCount: number;
}

export interface RunActivity {
  id: string;
  kind: 'tool';
  title: string;
  status: RunActivityStatus;
  startedAt?: number;
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  respondedAt?: number;
  status: MessageStatus;
  presentation?: MessagePresentation;
  stage?: MessageStage;
  errorMessage?: string;
  activities?: RunActivity[];
  contextItems?: ContextItem[];
  /** Legacy fields retained only for locally stored messages created before context-item snapshots. */
  references?: QuoteReference[];
  attachments?: DraftAttachment[];
  pageContext?: PageContext;
  pageContextMode?: 'manifest' | 'reuse' | 'snapshot';
  pageContextDelivery?: 'introduce' | 'update' | 'reuse';
  pageContextIssue?: string;
}

export interface ConversationBranch {
  rootConversationId: string;
  parentConversationId: string;
  sourceMessageId?: string;
  ordinal: number;
}

export interface Conversation {
  id: string;
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
  page: PageContext;
  pages: PageContext[];
  messages: ChatMessage[];
  draftInput: string;
  draftContextItems: ContextItem[];
}

export interface OpenConversationTab {
  id: string;
  conversationId: string;
  openedAt: number;
}

export interface WorkspaceState {
  conversations: Conversation[];
  openTabs: OpenConversationTab[];
  activeOpenTabId: string;
}
