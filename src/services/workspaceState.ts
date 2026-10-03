import type {
  AssistantArtifact,
  ChatMessage,
  Conversation,
  ContextItem,
  DraftAttachment,
  OpenConversationTab,
  PageContext,
  QuoteReference,
  RunActivity,
  WorkspaceState,
} from '../sidepanel/types';
import { legacyDraftContextItems } from '../sidepanel/contextItems';

export const WORKSPACE_STATE_VERSION = 6;
export const MAX_OPEN_TABS = 10;

export interface WorkspaceSnapshot extends WorkspaceState {
  version: typeof WORKSPACE_STATE_VERSION;
  savedAt: number;
}

interface LegacyConversationTab {
  id: string;
  page: PageContext;
  messages: ChatMessage[];
  draftInput: string;
  draftQuotes: QuoteReference[];
  draftAttachments: DraftAttachment[];
}

interface LegacyConversation {
  id: string;
  remoteUuid?: string;
  pendingBranchContext?: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  isDraft?: boolean;
  activeTabId: string;
  tabs: LegacyConversationTab[];
}

interface LegacyConversationV4 extends Omit<Conversation, 'draftContextItems'> {
  draftQuotes: QuoteReference[];
  draftAttachments: DraftAttachment[];
  draftPageReference: {
    url: string;
    mode: 'included' | 'excluded';
  };
}

type LegacyConversationV2 = Omit<LegacyConversationV4, 'draftPageReference'>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestHeading(value: unknown) {
  return isRecord(value)
    && (value.level === 1 || value.level === 2 || value.level === 3)
    && typeof value.text === 'string';
}

function isManifestLink(value: unknown) {
  return isRecord(value)
    && typeof value.title === 'string'
    && typeof value.url === 'string'
    && ['chapter', 'next', 'previous', 'reference', 'unknown'].includes(value.relation as string);
}

function isPageManifest(value: unknown) {
  return isRecord(value)
    && (value.description === undefined || typeof value.description === 'string')
    && Array.isArray(value.outline)
    && value.outline.every(isManifestHeading)
    && (value.leading_excerpt === undefined || typeof value.leading_excerpt === 'string')
    && Array.isArray(value.relevant_links)
    && value.relevant_links.every(isManifestLink)
    && typeof value.truncated === 'boolean';
}

function isPage(value: unknown): value is PageContext {
  return isRecord(value)
    && typeof value.title === 'string'
    && typeof value.site === 'string'
    && typeof value.url === 'string'
    && typeof value.status === 'string'
    && (value.browserTabId === undefined || typeof value.browserTabId === 'number')
    && (value.pageId === undefined || typeof value.pageId === 'string')
    && (value.sourceId === undefined || typeof value.sourceId === 'string')
    && (value.contentHash === undefined || typeof value.contentHash === 'string')
    && (value.extractedAt === undefined || typeof value.extractedAt === 'number')
    && (value.sentAt === undefined || typeof value.sentAt === 'number')
    && (value.deliveredRemoteUuid === undefined || typeof value.deliveredRemoteUuid === 'string')
    && (value.version === undefined || typeof value.version === 'number')
    && (value.pageType === undefined || ['article', 'documentation', 'index', 'search', 'discussion', 'application', 'unknown'].includes(value.pageType as string))
    && (value.accessHint === undefined || ['public_web', 'authenticated_web', 'browser_only', 'local_document', 'unknown'].includes(value.accessHint as string))
    && (value.manifest === undefined || isPageManifest(value.manifest))
    && (value.quality === undefined || typeof value.quality === 'string')
    && (value.truncated === undefined || typeof value.truncated === 'boolean');
}

function isDraftPageReference(value: unknown) {
  return isRecord(value)
    && typeof value.url === 'string'
    && (value.mode === 'included' || value.mode === 'excluded');
}

function isQuote(value: unknown): value is QuoteReference {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && typeof value.pageTitle === 'string'
    && typeof value.pageUrl === 'string'
    && typeof value.createdAt === 'number'
    && (value.origin === undefined || value.origin === 'page' || value.origin === 'assistant')
    && (value.sourceMessageId === undefined || typeof value.sourceMessageId === 'string');
}

function isAttachment(value: unknown): value is DraftAttachment {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.filename === 'string'
    && typeof value.sizeLabel === 'string'
    && typeof value.status === 'string'
    && (value.mime === undefined || typeof value.mime === 'string')
    && (value.url === undefined || typeof value.url === 'string')
    && (value.uploadTransport === undefined || value.uploadTransport === 'public-v1' || value.uploadTransport === 'internal-v2')
    && (value.errorMessage === undefined || typeof value.errorMessage === 'string');
}

function isContextItem(value: unknown): value is ContextItem {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.included !== 'boolean'
    || !['preparing', 'ready', 'failed'].includes(value.status as string)
    || typeof value.createdAt !== 'number'
    || (value.issue !== undefined && typeof value.issue !== 'string')) return false;

  if (value.kind === 'page') {
    return isPage(value.page)
      && (value.role === 'current' || value.role === 'referenced')
      && (value.delivery === undefined || ['introduce', 'update', 'reuse'].includes(value.delivery as string));
  }
  if (value.kind === 'selection') return isQuote(value.selection);
  if (value.kind === 'file' || value.kind === 'image') return isAttachment(value.attachment);
  if (value.kind === 'memory') {
    return isRecord(value.memory)
      && typeof value.memory.title === 'string'
      && typeof value.memory.excerpt === 'string'
      && (value.memory.sourceId === undefined || typeof value.memory.sourceId === 'string');
  }
  if (value.kind === 'link') {
    return isRecord(value.link)
      && typeof value.link.title === 'string'
      && typeof value.link.url === 'string'
      && (value.link.site === undefined || typeof value.link.site === 'string');
  }
  return false;
}

function recoverAttachment(attachment: DraftAttachment): DraftAttachment {
  return attachment.status === 'uploading'
    ? { ...attachment, status: 'failed', errorMessage: '上传在浏览器关闭前未完成，请重新选择原文件。' }
    : attachment;
}

function cleanAttachment(attachment: DraftAttachment): DraftAttachment {
  const { previewUrl: _previewUrl, ...persisted } = attachment;
  return persisted;
}

function recoverContextItem(item: ContextItem): ContextItem {
  if (item.kind !== 'file' && item.kind !== 'image') return item;
  const attachment = recoverAttachment(item.attachment);
  return {
    ...item,
    status: attachment.status === 'uploading' ? 'preparing' : attachment.status,
    issue: attachment.errorMessage,
    attachment,
  };
}

function isActivity(value: unknown): value is RunActivity {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.kind === 'tool' || value.kind === 'subagent')
    && typeof value.title === 'string'
    && typeof value.status === 'string'
    && (value.subagent === undefined || (isRecord(value.subagent)
      && (value.subagent.sessionId === undefined || (typeof value.subagent.sessionId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.subagent.sessionId)))
      && (value.subagent.agentType === undefined || (typeof value.subagent.agentType === 'string' && value.subagent.agentType.length <= 80))
      && (value.subagent.prompt === undefined || (typeof value.subagent.prompt === 'string' && value.subagent.prompt.length <= 12_000))
      && (value.subagent.answer === undefined || (typeof value.subagent.answer === 'string' && value.subagent.answer.length <= 24_000))
      && (value.subagent.truncated === undefined || typeof value.subagent.truncated === 'boolean')));
}

function isSafeStoredArtifactUrl(value: unknown) {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isArtifact(value: unknown): value is AssistantArtifact {
  return isRecord(value)
    && typeof value.id === 'string'
    && ['image', 'html', 'markdown', 'document', 'archive', 'file'].includes(value.kind as string)
    && typeof value.filename === 'string'
    && isSafeStoredArtifactUrl(value.url)
    && (value.mime === undefined || typeof value.mime === 'string')
    && (value.size === undefined || typeof value.size === 'number')
    && isSafeStoredArtifactUrl(value.thumbnailUrl)
    && ['available', 'failed', 'expired'].includes(value.status as string);
}

function cleanArtifact(artifact: AssistantArtifact): AssistantArtifact {
  return {
    id: artifact.id,
    kind: artifact.kind,
    filename: artifact.filename,
    ...(artifact.url ? { url: artifact.url } : {}),
    ...(artifact.mime ? { mime: artifact.mime } : {}),
    ...(artifact.size !== undefined ? { size: artifact.size } : {}),
    ...(artifact.thumbnailUrl ? { thumbnailUrl: artifact.thumbnailUrl } : {}),
    status: artifact.status,
  };
}

function isDecisionAnswer(value: unknown) {
  return typeof value === 'string'
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isDecisionField(value: unknown) {
  if (!isRecord(value) || typeof value.label !== 'string' || typeof value.type !== 'string') return false;
  if (value.type === 'text') return typeof value.defaultValue === 'string';
  if (value.type === 'single-select') {
    return typeof value.defaultValue === 'string'
      && Array.isArray(value.options)
      && value.options.every((option) => typeof option === 'string');
  }
  if (value.type === 'multi-select') {
    return Array.isArray(value.defaultValue)
      && value.defaultValue.every((item) => typeof item === 'string')
      && Array.isArray(value.options)
      && value.options.every((option) => typeof option === 'string');
  }
  return false;
}

function isDecision(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.fields)
    && value.fields.every(isDecisionField)
    && ['pending', 'submitting', 'submitted', 'replied', 'rejected', 'failed'].includes(value.status as string)
    && (value.submittedAction === undefined || value.submittedAction === 'reply' || value.submittedAction === 'reject')
    && (value.toolMessageId === undefined || typeof value.toolMessageId === 'string')
    && (value.toolCallId === undefined || typeof value.toolCallId === 'string')
    && (value.errorMessage === undefined || typeof value.errorMessage === 'string')
    && (value.answers === undefined || (isRecord(value.answers) && Object.values(value.answers).every(isDecisionAnswer)));
}

function isCollectionMaterial(value: unknown) {
  return isRecord(value)
    && typeof value.cardId === 'string'
    && typeof value.title === 'string'
    && (value.kind === 'answer' || value.kind === 'excerpt')
    && (value.question === undefined || typeof value.question === 'string')
    && typeof value.answer === 'string'
    && typeof value.savedAt === 'number'
    && (value.included === undefined || typeof value.included === 'boolean')
    && Array.isArray(value.sources)
    && value.sources.every((source) => isRecord(source)
      && typeof source.title === 'string'
      && typeof source.url === 'string'
      && (source.site === undefined || typeof source.site === 'string'));
}

function isMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && (value.collectionSend === undefined || value.collectionSend === true)
    && (value.collectionMode === undefined || value.collectionMode === 'question')
    && (value.collectionMaterials === undefined || (Array.isArray(value.collectionMaterials)
      && value.collectionMaterials.every(isCollectionMaterial)))
    && typeof value.createdAt === 'number'
    && (value.respondedAt === undefined || typeof value.respondedAt === 'number')
    && typeof value.status === 'string'
    && (value.presentation === undefined || value.presentation === 'page-overview')
    && (value.pageContext === undefined || isPage(value.pageContext))
    && (value.pageContextMode === undefined || ['manifest', 'reuse', 'snapshot'].includes(value.pageContextMode as string))
    && (value.pageContextDelivery === undefined || ['introduce', 'update', 'reuse'].includes(value.pageContextDelivery as string))
    && (value.pageContextIssue === undefined || typeof value.pageContextIssue === 'string')
    && (value.activities === undefined || (Array.isArray(value.activities) && value.activities.every(isActivity)))
    && (value.artifacts === undefined || (Array.isArray(value.artifacts) && value.artifacts.every(isArtifact)))
    && (value.interactions === undefined || (Array.isArray(value.interactions) && value.interactions.every(isDecision)))
    && (value.decision === undefined || isDecision(value.decision))
    && (value.contextItems === undefined || (Array.isArray(value.contextItems) && value.contextItems.every(isContextItem)))
    && (value.references === undefined || (Array.isArray(value.references) && value.references.every(isQuote)))
    && (value.attachments === undefined || (Array.isArray(value.attachments) && value.attachments.every(isAttachment)));
}

function isBranch(value: unknown) {
  return isRecord(value)
    && typeof value.rootConversationId === 'string'
    && typeof value.parentConversationId === 'string'
    && (value.sourceMessageId === undefined || typeof value.sourceMessageId === 'string')
    && typeof value.ordinal === 'number';
}

function isConversationBase(value: unknown): value is UnknownRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.remoteTransport === undefined || value.remoteTransport === 'public-v1' || value.remoteTransport === 'internal-v2')
    && (value.remoteAgentUuid === undefined || typeof value.remoteAgentUuid === 'string')
    && (value.remoteApiBase === undefined || typeof value.remoteApiBase === 'string')
    && typeof value.title === 'string'
    && typeof value.subtitle === 'string'
    && typeof value.updatedAt === 'number'
    && (value.archivedAt === undefined || typeof value.archivedAt === 'number')
    && (value.branch === undefined || isBranch(value.branch))
    && isPage(value.page)
    && Array.isArray(value.pages)
    && value.pages.length > 0
    && value.pages.every(isPage)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && typeof value.draftInput === 'string'
    && (value.collectionOrigin === undefined || value.collectionOrigin === 'isolated' || value.collectionOrigin === 'reading')
    && (value.draftCollectionMaterials === undefined || (Array.isArray(value.draftCollectionMaterials)
      && value.draftCollectionMaterials.every(isCollectionMaterial)));
}

function isConversation(value: unknown): value is Conversation {
  return isConversationBase(value)
    && Array.isArray(value.draftContextItems)
    && value.draftContextItems.every(isContextItem);
}

function isConversationV4(value: unknown): value is LegacyConversationV4 {
  return isConversationBase(value)
    && Array.isArray(value.draftQuotes)
    && value.draftQuotes.every(isQuote)
    && Array.isArray(value.draftAttachments)
    && value.draftAttachments.every(isAttachment)
    && isDraftPageReference(value.draftPageReference);
}

function isConversationV2(value: unknown): value is LegacyConversationV2 {
  return isConversationBase(value)
    && Array.isArray(value.draftQuotes)
    && value.draftQuotes.every(isQuote)
    && Array.isArray(value.draftAttachments)
    && value.draftAttachments.every(isAttachment);
}

function isOpenTab(value: unknown): value is OpenConversationTab {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.openedAt === 'number';
}

function isLegacyTab(value: unknown): value is LegacyConversationTab {
  return isRecord(value)
    && typeof value.id === 'string'
    && isPage(value.page)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && typeof value.draftInput === 'string'
    && Array.isArray(value.draftQuotes)
    && value.draftQuotes.every(isQuote)
    && Array.isArray(value.draftAttachments)
    && value.draftAttachments.every(isAttachment);
}

function isLegacyConversation(value: unknown): value is LegacyConversation {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.subtitle === 'string'
    && typeof value.updatedAt === 'number'
    && typeof value.activeTabId === 'string'
    && Array.isArray(value.tabs)
    && value.tabs.length > 0
    && value.tabs.every(isLegacyTab);
}

function stopInterruptedActivity(activity: RunActivity, recoveredAt: number): RunActivity {
  return activity.status === 'pending' || activity.status === 'running'
    ? { ...activity, status: 'stopped', completedAt: recoveredAt }
    : activity;
}

function recoverMessage(message: ChatMessage, recoveredAt: number): ChatMessage {
  const { decision: legacyDecision, ...current } = message;
  const interactions = message.interactions ?? (legacyDecision ? [legacyDecision] : undefined);
  const activities = message.activities?.map((activity) => stopInterruptedActivity(activity, recoveredAt));
  if (message.status !== 'streaming') return { ...current, interactions, activities };
  return {
    ...current,
    interactions,
    status: 'stopped',
    stage: undefined,
    errorMessage: undefined,
    activities,
  };
}

function uniquePages(pages: PageContext[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = page.url || `${page.site}:${page.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanLegacyTitle(title: string) {
  const match = title.match(/(?:\s*·\s*分支)+\s*$/u);
  if (!match) return { baseTitle: title.trim() || '新的阅读对话', depth: 0 };
  const suffix = match[0];
  return {
    baseTitle: title.slice(0, title.length - suffix.length).trim() || '新的阅读对话',
    depth: (suffix.match(/分支/gu) ?? []).length,
  };
}

function hasDraft(tab: LegacyConversationTab) {
  return Boolean(tab.draftInput.trim() || tab.draftQuotes.length || tab.draftAttachments.length);
}

function migrateLegacyConversations(legacyConversations: LegacyConversation[]) {
  const migratedMain = legacyConversations.map((legacy) => {
    const activeTab = legacy.tabs.find((tab) => tab.id === legacy.activeTabId) ?? legacy.tabs[0]!;
    const pages = uniquePages(legacy.tabs.map((tab) => ({ ...tab.page })));
    const messages = legacy.tabs
      .flatMap((tab, tabIndex) => tab.messages.map((message, messageIndex) => ({
        message: { ...message, pageContext: message.pageContext ?? { ...tab.page } },
        order: tabIndex * 1_000_000 + messageIndex,
      })))
      .sort((left, right) => left.message.createdAt - right.message.createdAt || left.order - right.order)
      .map(({ message }) => message);
    const title = cleanLegacyTitle(legacy.title);
    const conversation: Conversation = {
      id: legacy.id,
      remoteUuid: legacy.remoteUuid,
      pendingBranchContext: legacy.pendingBranchContext,
      title: title.baseTitle,
      subtitle: legacy.subtitle,
      updatedAt: legacy.updatedAt,
      isDraft: legacy.isDraft,
      page: { ...activeTab.page },
      pages: pages.length ? pages : [{ ...activeTab.page }],
      messages,
      draftInput: activeTab.draftInput,
      draftContextItems: legacyDraftContextItems(
        activeTab.page,
        { url: activeTab.page.url, mode: 'included' },
        activeTab.draftQuotes,
        activeTab.draftAttachments,
      ),
    };
    return { conversation, baseTitle: title.baseTitle, depth: title.depth };
  });

  const groups = new Map<string, typeof migratedMain>();
  migratedMain.forEach((entry) => {
    const group = groups.get(entry.baseTitle) ?? [];
    group.push(entry);
    groups.set(entry.baseTitle, group);
  });

  groups.forEach((entries) => {
    const chronological = [...entries].sort((left, right) => left.conversation.updatedAt - right.conversation.updatedAt);
    let currentRoot: (typeof chronological)[number] | undefined;
    const branchesByRoot = new Map<string, typeof chronological>();
    chronological.forEach((entry) => {
      if (entry.depth === 0) {
        currentRoot = entry;
        return;
      }
      if (!currentRoot) {
        currentRoot = entry;
        return;
      }
      const root = currentRoot;
      const earlierBranches = branchesByRoot.get(root.conversation.id) ?? [];
      const earlierParent = [...earlierBranches]
        .reverse()
        .find((candidate) => candidate.depth === Math.max(0, entry.depth - 1));
      entry.conversation.branch = {
        rootConversationId: root.conversation.id,
        parentConversationId: earlierParent?.conversation.id ?? root.conversation.id,
        ordinal: earlierBranches.length + 1,
      };
      entry.conversation.subtitle = `分支 ${earlierBranches.length + 1} · 已迁移`;
      branchesByRoot.set(root.conversation.id, [...earlierBranches, entry]);
    });
  });

  const migratedDrafts: Conversation[] = legacyConversations.flatMap((legacy) => {
    const activeTab = legacy.tabs.find((tab) => tab.id === legacy.activeTabId) ?? legacy.tabs[0]!;
    const baseTitle = cleanLegacyTitle(legacy.title).baseTitle;
    return legacy.tabs
      .filter((tab) => tab.id !== activeTab.id && hasDraft(tab))
      .map((tab) => ({
        id: `${legacy.id}-draft-${tab.id}`,
        title: `${baseTitle}（迁移草稿）`,
        subtitle: '未发送草稿 · 已迁移',
        updatedAt: legacy.updatedAt,
        isDraft: true,
        page: { ...tab.page },
        pages: [{ ...tab.page }],
        messages: [],
        draftInput: tab.draftInput,
        draftContextItems: legacyDraftContextItems(
          tab.page,
          { url: tab.page.url, mode: 'included' },
          tab.draftQuotes,
          tab.draftAttachments,
        ),
      }));
  });

  return [...migratedMain.map((entry) => entry.conversation), ...migratedDrafts];
}

export function createWorkspaceSnapshot(workspace: WorkspaceState, savedAt = Date.now()): WorkspaceSnapshot {
  const conversations = workspace.conversations.map((conversation) => ({
    ...conversation,
    page: cleanPageContext(conversation.page),
    pages: conversation.pages.map(cleanPageContext),
    messages: conversation.messages.map((message) => {
      const { decision: legacyDecision, ...current } = message;
      return {
        ...current,
        interactions: message.interactions ?? (legacyDecision ? [legacyDecision] : undefined),
        artifacts: message.artifacts?.map(cleanArtifact),
        pageContext: message.pageContext ? cleanPageContext(message.pageContext) : undefined,
        attachments: message.attachments?.map(cleanAttachment),
        contextItems: message.contextItems?.map(cleanContextItem),
      };
    }),
    draftContextItems: conversation.draftContextItems.map(cleanContextItem),
  }));
  return {
    version: WORKSPACE_STATE_VERSION,
    conversations,
    openTabs: workspace.openTabs,
    activeOpenTabId: workspace.activeOpenTabId,
    savedAt,
  };
}

function cleanPageContext(page: PageContext): PageContext {
  return {
    title: page.title,
    site: page.site,
    url: page.url,
    status: page.status,
    ...(page.browserTabId !== undefined ? { browserTabId: page.browserTabId } : {}),
    ...(page.pageId ? { pageId: page.pageId } : {}),
    ...(page.sourceId ? { sourceId: page.sourceId } : {}),
    ...(page.contentHash ? { contentHash: page.contentHash } : {}),
    ...(page.extractedAt !== undefined ? { extractedAt: page.extractedAt } : {}),
    ...(page.sentAt !== undefined ? { sentAt: page.sentAt } : {}),
    ...(page.deliveredRemoteUuid ? { deliveredRemoteUuid: page.deliveredRemoteUuid } : {}),
    ...(page.version !== undefined ? { version: page.version } : {}),
    ...(page.pageType ? { pageType: page.pageType } : {}),
    ...(page.accessHint ? { accessHint: page.accessHint } : {}),
    ...(page.manifest ? { manifest: page.manifest } : {}),
    ...(page.quality ? { quality: page.quality } : {}),
    ...(page.truncated !== undefined ? { truncated: page.truncated } : {}),
  };
}

function cleanContextItem(item: ContextItem): ContextItem {
  if (item.kind === 'page') return { ...item, page: cleanPageContext(item.page) };
  if (item.kind === 'selection') return { ...item, selection: { ...item.selection } };
  if (item.kind === 'file' || item.kind === 'image') {
    return { ...item, attachment: cleanAttachment(item.attachment) };
  }
  if (item.kind === 'memory') return { ...item, memory: { ...item.memory } };
  return { ...item, link: { ...item.link } };
}

function normalizeWorkspace<T extends { id: string }>(
  value: UnknownRecord,
  recoveredAt: number,
  validator: (conversation: unknown) => conversation is T,
  migrate: (conversation: T) => Conversation,
): WorkspaceSnapshot | null {
  if (!Array.isArray(value.conversations)
    || value.conversations.length === 0
    || !value.conversations.every(validator)
    || !Array.isArray(value.openTabs)
    || !value.openTabs.every(isOpenTab)
    || typeof value.activeOpenTabId !== 'string'
    || typeof value.savedAt !== 'number') return null;

  const conversations = value.conversations
    .filter((conversation, index, items) => items.findIndex((item) => item.id === conversation.id) === index)
    .map((conversation) => migrate(conversation))
    .map((conversation) => ({
      ...conversation,
      page: cleanPageContext(conversation.page),
      pages: conversation.pages.map(cleanPageContext),
      messages: conversation.messages.map((message) => recoverMessage(message, recoveredAt)),
      draftContextItems: conversation.draftContextItems.map(recoverContextItem),
    }));
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const openConversationIds = new Set<string>();
  const openTabs = value.openTabs.filter((tab) => {
    if (!conversationIds.has(tab.conversationId) || openConversationIds.has(tab.conversationId)) return false;
    openConversationIds.add(tab.conversationId);
    return true;
  }).slice(0, MAX_OPEN_TABS);
  if (openTabs.length === 0) return null;
  const activeOpenTabId = openTabs.some((tab) => tab.id === value.activeOpenTabId)
    ? value.activeOpenTabId
    : openTabs[0]!.id;
  const openIds = new Set(openTabs.map((tab) => tab.conversationId));
  const normalizedConversations = conversations.map((conversation) => openIds.has(conversation.id) && conversation.archivedAt
    ? { ...conversation, archivedAt: undefined }
    : conversation);

  return createWorkspaceSnapshot({ conversations: normalizedConversations, openTabs, activeOpenTabId }, value.savedAt);
}

function normalizeCurrentWorkspace(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversation, (conversation) => conversation as Conversation);
}

function migrateV4Conversation(conversation: LegacyConversationV4): Conversation {
  const { draftQuotes, draftAttachments, draftPageReference, ...current } = conversation;
  return {
    ...current,
    draftContextItems: legacyDraftContextItems(
      conversation.page,
      draftPageReference,
      draftQuotes,
      draftAttachments,
    ),
  };
}

function normalizeV4(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversationV4, migrateV4Conversation);
}

function normalizeV3(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversationV4, migrateV4Conversation);
}

function normalizeV2(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversationV2, (conversation) => {
    const { draftQuotes, draftAttachments, ...current } = conversation;
    return {
      ...current,
      draftContextItems: legacyDraftContextItems(
        conversation.page,
        undefined,
        draftQuotes,
        draftAttachments,
      ),
    };
  });
}

function normalizeV1(value: UnknownRecord, recoveredAt: number): WorkspaceSnapshot | null {
  if (!Array.isArray(value.conversations)
    || value.conversations.length === 0
    || !value.conversations.every(isLegacyConversation)
    || typeof value.activeConversationId !== 'string'
    || typeof value.savedAt !== 'number') return null;

  const legacyConversations = value.conversations as LegacyConversation[];
  const conversations = migrateLegacyConversations(legacyConversations).map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => recoverMessage(message, recoveredAt)),
    draftContextItems: conversation.draftContextItems.map(recoverContextItem),
  }));
  const activeConversationId = conversations.some((conversation) => conversation.id === value.activeConversationId)
    ? value.activeConversationId
    : conversations[0]!.id;
  const openTab: OpenConversationTab = {
    id: `open-${activeConversationId}`,
    conversationId: activeConversationId,
    openedAt: value.savedAt,
  };
  return createWorkspaceSnapshot({
    conversations,
    openTabs: [openTab],
    activeOpenTabId: openTab.id,
  }, value.savedAt);
}

export function normalizeWorkspaceSnapshot(value: unknown, recoveredAt = Date.now()): WorkspaceSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version === WORKSPACE_STATE_VERSION || value.version === 5) return normalizeCurrentWorkspace(value, recoveredAt);
  if (value.version === 4) return normalizeV4(value, recoveredAt);
  if (value.version === 3) return normalizeV3(value, recoveredAt);
  if (value.version === 2) return normalizeV2(value, recoveredAt);
  if (value.version === 1) return normalizeV1(value, recoveredAt);
  return null;
}
