import type { PageManifest, YemaiAccessHint, YemaiPageType } from '../shared/yemaiContext';
import type { WorkosA2uiField, WorkosA2uiInterrupt } from '../services/workosSse';
import type { WorkosTransportKind } from '../services/workosTransport';
import type { SubagentSnapshot } from '../shared/agentActivity';

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
  deliveredRemoteUuid?: string;
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

export type AssistantArtifactKind = 'image' | 'html' | 'markdown' | 'document' | 'archive' | 'file';
export type AssistantArtifactStatus = 'available' | 'failed' | 'expired';

/**
 * A file produced by the Agent. Output artifacts are deliberately separate
 * from DraftAttachment, which represents user input sent to WorkOS.
 */
export interface AssistantArtifact {
  id: string;
  kind: AssistantArtifactKind;
  filename: string;
  url?: string;
  mime?: string;
  size?: number;
  thumbnailUrl?: string;
  status: AssistantArtifactStatus;
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
export type MessageStage = 'queued' | 'reading-page' | 'creating-conversation' | 'waiting-first-token' | 'waiting-user-input' | 'streaming';
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
  kind: 'tool' | 'subagent';
  title: string;
  status: RunActivityStatus;
  startedAt?: number;
  completedAt?: number;
  subagent?: SubagentSnapshot;
}

export type AgentDecisionStatus = 'pending' | 'submitting' | 'submitted' | 'replied' | 'rejected' | 'failed';

export interface AgentDecision extends WorkosA2uiInterrupt {
  status: AgentDecisionStatus;
  submittedAction?: 'reply' | 'reject';
  answers?: Record<string, string | string[]>;
  errorMessage?: string;
}

export interface CollectionMaterial {
  cardId: string;
  title: string;
  kind: 'answer' | 'excerpt';
  question?: string;
  answer: string;
  sources: Array<{ title: string; url: string; site?: string }>;
  savedAt: number;
  /** Draft-only inclusion choice. Older materials default to included. */
  included?: boolean;
}

export type AgentDecisionField = WorkosA2uiField;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Frozen materials sent from a collection selection, kept even if cards are removed later. */
  collectionMaterials?: CollectionMaterial[];
  /** A normal user question with selected collection materials attached as context. */
  collectionMode?: 'question';
  /** First answer of a collection synthesis, so an uncertain submit is never offered as a blind retry. */
  collectionSend?: true;
  createdAt: number;
  respondedAt?: number;
  /** Local wall-clock time when this attempt began running, excluding queue wait. */
  runStartedAt?: number;
  /** Local wall-clock time when this attempt completed, failed, or was stopped. */
  runFinishedAt?: number;
  status: MessageStatus;
  presentation?: MessagePresentation;
  stage?: MessageStage;
  errorMessage?: string;
  activities?: RunActivity[];
  artifacts?: AssistantArtifact[];
  interactions?: AgentDecision[];
  /** @deprecated Migrated to interactions when locally stored conversations are restored. */
  decision?: AgentDecision;
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
  remoteApiBase?: string;
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
  /** Distinguish page-free collection chats from collections added to ordinary reading. */
  collectionOrigin?: 'isolated' | 'reading';
  /** Frozen collections waiting to be included in the next question. */
  draftCollectionMaterials?: CollectionMaterial[];
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
