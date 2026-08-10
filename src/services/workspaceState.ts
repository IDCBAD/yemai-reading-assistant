import type {
  ChatMessage,
  Conversation,
  DraftAttachment,
  OpenConversationTab,
  PageContext,
  QuoteReference,
  RunActivity,
  WorkspaceState,
} from '../sidepanel/types';

export const WORKSPACE_STATE_VERSION = 3;
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPage(value: unknown): value is PageContext {
  return isRecord(value)
    && typeof value.title === 'string'
    && typeof value.site === 'string'
    && typeof value.url === 'string'
    && typeof value.status === 'string'
    && (value.browserTabId === undefined || typeof value.browserTabId === 'number');
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
    && typeof value.createdAt === 'number';
}

function isAttachment(value: unknown): value is DraftAttachment {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.filename === 'string'
    && typeof value.sizeLabel === 'string'
    && typeof value.status === 'string'
    && (value.url === undefined || typeof value.url === 'string')
    && (value.errorMessage === undefined || typeof value.errorMessage === 'string');
}

function recoverAttachment(attachment: DraftAttachment): DraftAttachment {
  return attachment.status === 'uploading'
    ? { ...attachment, status: 'failed', errorMessage: '上传在浏览器关闭前未完成，请删除后重新添加。' }
    : attachment;
}

function isActivity(value: unknown): value is RunActivity {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.kind === 'tool'
    && typeof value.title === 'string'
    && typeof value.status === 'string';
}

function isMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && typeof value.createdAt === 'number'
    && typeof value.status === 'string'
    && (value.pageContext === undefined || isPage(value.pageContext))
    && (value.pageContextIssue === undefined || typeof value.pageContextIssue === 'string')
    && (value.activities === undefined || (Array.isArray(value.activities) && value.activities.every(isActivity)))
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

function isConversationV2(value: unknown): value is Omit<Conversation, 'draftPageReference'> {
  return isRecord(value)
    && typeof value.id === 'string'
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
    && Array.isArray(value.draftQuotes)
    && value.draftQuotes.every(isQuote)
    && Array.isArray(value.draftAttachments)
    && value.draftAttachments.every(isAttachment);
}

function isConversation(value: unknown): value is Conversation {
  return isConversationV2(value)
    && isDraftPageReference((value as unknown as UnknownRecord).draftPageReference);
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
  const activities = message.activities?.map((activity) => stopInterruptedActivity(activity, recoveredAt));
  if (message.status !== 'streaming') return { ...message, activities };
  return {
    ...message,
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
      draftQuotes: activeTab.draftQuotes,
      draftAttachments: activeTab.draftAttachments,
      draftPageReference: { url: activeTab.page.url, mode: 'included' },
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
        draftQuotes: tab.draftQuotes,
        draftAttachments: tab.draftAttachments,
        draftPageReference: { url: tab.page.url, mode: 'included' },
      }));
  });

  return [...migratedMain.map((entry) => entry.conversation), ...migratedDrafts];
}

export function createWorkspaceSnapshot(workspace: WorkspaceState, savedAt = Date.now()): WorkspaceSnapshot {
  return {
    version: WORKSPACE_STATE_VERSION,
    conversations: workspace.conversations,
    openTabs: workspace.openTabs,
    activeOpenTabId: workspace.activeOpenTabId,
    savedAt,
  };
}

function normalizeWorkspace<T extends Omit<Conversation, 'draftPageReference'>>(
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
      messages: conversation.messages.map((message) => recoverMessage(message, recoveredAt)),
      draftAttachments: conversation.draftAttachments.map(recoverAttachment),
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

function normalizeV3(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversation, (conversation) => conversation as Conversation);
}

function normalizeV2(value: UnknownRecord, recoveredAt: number) {
  return normalizeWorkspace(value, recoveredAt, isConversationV2, (conversation) => ({
    ...conversation,
    draftPageReference: { url: conversation.page.url, mode: 'included' },
  }));
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
    draftAttachments: conversation.draftAttachments.map(recoverAttachment),
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
  if (value.version === WORKSPACE_STATE_VERSION) return normalizeV3(value, recoveredAt);
  if (value.version === 2) return normalizeV2(value, recoveredAt);
  if (value.version === 1) return normalizeV1(value, recoveredAt);
  return null;
}
