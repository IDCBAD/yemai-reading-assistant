import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  buildAgentContent,
  preparePageReference,
  WORKOS_AGENT_CAPABILITIES,
} from '../services/buildAgentContent';
import { buildBranchContext, buildTransportHandoffContext, prependBranchContext } from '../services/buildBranchContext';
import { decideCurrentPageDelivery, type CurrentPageDeliveryDecision } from '../services/contextDeliveryPolicy';
import {
  EMPTY_WORKOS_CONNECTION_SETTINGS,
  isActiveWorkosConnectionConfigured,
  loadWorkosConnectionSettings,
  removeWorkosCredentials,
  saveWorkosConnectionSettings,
  type WorkosConnectionSettings,
} from '../services/workosConnection';
import {
  createWorkosFileUploader,
  isWorkosFileUploadConfigured,
} from '../services/workosFileUpload';
import type { WorkosToolActivity } from '../services/workosSse';
import { hasWorkosRemoteTargetChanged, WorkosApiError } from '../services/workosTransport';
import { createWorkosTransport, validateWorkosConnection } from '../services/workosTransportFactory';
import { loadWorkspaceState, saveWorkspaceState } from '../services/workspaceStorage';
import { MAX_OPEN_TABS } from '../services/workspaceState';
import type {
  ExtensionEvent,
  ExtensionRequest,
  PageResponse,
  PageSnapshot,
  SelectionConsumeResponse,
} from '../shared/extensionMessages';
import {
  ConversationRequestCoordinator,
  deriveActiveConversationIds,
  deriveAgentRunSummary,
  reconcileTransientMessages,
  waitForAbortable,
} from './agentQueue';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { ConfirmDialog, HistoryPopover, SettingsDrawer } from './components/Overlays';
import { TopBar } from './components/TopBar';
import {
  attachmentContextItem,
  cloneContextItems,
  contextAttachments,
  contextItemIncluded,
  contextItemsFromMessage,
  contextPage,
  contextSelections,
  createContextSnapshot,
  legacyDraftContextItems,
  removeContextItem,
  retainContextAfterSend,
  selectionContextItem,
  syncCurrentPageContextItem,
  updateAttachmentContextItem,
  updatePageContextSnapshot,
} from './contextItems';
import {
  attachmentAcceptForChannel,
  isFileUploadSupported,
  isImageFile,
} from './fileTypes';
import { CURRENT_PAGE, INITIAL_WORKSPACE } from './mockData';
import { shouldRefreshPageMetadataForTab, type BrowserTabChange } from './pageMetadataSync';
import { shouldPreparePageReference } from './pageReference';
import type {
  ChatMessage,
  Conversation,
  OpenConversationTab,
  PageContext,
  RunActivity,
  RunActivityStatus,
  WorkspaceState,
} from './types';
import { closeWorkspaceTab, openConversationInWorkspace } from './workspaceNavigation';

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_DRAFT_ATTACHMENTS = 5;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentValidationError(file: File, channel: WorkosConnectionSettings['transport']) {
  if (file.size > MAX_ATTACHMENT_BYTES) return '单个附件不能超过 20 MB。';
  if (!isFileUploadSupported(file.name, file.type, channel)) {
    return channel === 'internal-v2'
      ? '当前内部上传通道支持 PDF、Word、Excel、CSV、Markdown、HTML、TXT、JSON 和常见图片。'
      : '当前公开 v1 上传通道支持 PDF、Word、Excel、CSV、Markdown、TXT、JSON 和常见图片，不支持 HTML。';
  }
  return null;
}

function createConversation(currentPage: PageContext = CURRENT_PAGE): Conversation {
  const page = { ...currentPage, status: 'not-read' as const };
  return {
    id: makeId('conversation'),
    title: '新的阅读对话',
    subtitle: '1 个页面 · 尚未发送',
    updatedAt: Date.now(),
    isDraft: true,
    page,
    pages: [page],
    messages: [],
    draftInput: '',
    draftContextItems: legacyDraftContextItems(page, undefined),
  };
}

function pageContextFromSnapshot(snapshot: PageSnapshot, status: PageContext['status'] = 'ready'): PageContext {
  const { markdown: _markdown, ...page } = snapshot;
  return { ...page, status };
}

function sentPageContext(snapshot: PageSnapshot, sentAt: number, version: number): PageContext {
  return { ...pageContextFromSnapshot(snapshot, 'read'), sentAt, version };
}

function createOpenTab(conversationId: string): OpenConversationTab {
  return { id: makeId('open-tab'), conversationId, openedAt: Date.now() };
}

function cloneMessagesForBranch(messages: ChatMessage[]) {
  return messages.map((message) => ({
    ...message,
    id: makeId('message'),
    pageContext: message.pageContext ? { ...message.pageContext } : undefined,
    references: message.references?.map((reference) => ({ ...reference, id: makeId('quote') })),
    attachments: message.attachments?.map((attachment) => ({ ...attachment, id: makeId('attachment') })),
    contextItems: message.contextItems ? cloneContextItems(message.contextItems, makeId) : undefined,
    activities: message.activities?.map((activity) => ({ ...activity })),
  }));
}

function recentSubtitle(conversation: Conversation) {
  return conversation.branch
    ? `分支 ${conversation.branch.ordinal} · 刚刚`
    : `${conversation.pages.length} 个页面 · 刚刚`;
}

interface QueuedAgentRequest {
  conversationId: string;
  messageId: string;
  userMessage: ChatMessage;
  needsPageRead: boolean;
  pageSnapshotPromise: Promise<PagePreparationResult>;
}

interface PagePreparationResult {
  snapshot?: PageSnapshot;
  error?: string;
}

function pageSnapshotKey(conversationId: string, url: string) {
  return `${conversationId}\n${url}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workosConnection, setWorkosConnection] = useState<WorkosConnectionSettings | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageContext>(CURRENT_PAGE);
  const [pageIssue, setPageIssue] = useState<string | null>(null);
  const [pageMetadataRevision, setPageMetadataRevision] = useState(0);
  const [selectionBubbleEnabled, setSelectionBubbleEnabled] = useState(true);
  const workspaceRef = useRef<WorkspaceState>(INITIAL_WORKSPACE);
  const currentPageRef = useRef<PageContext>(CURRENT_PAGE);
  const activeBrowserTabIdRef = useRef<number | undefined>(undefined);
  const pageMetadataRequestRef = useRef(0);
  const pendingPageSnapshotsRef = useRef(new Map<string, PageSnapshot>());
  const pendingPagePreparationsRef = useRef(new Map<string, Promise<PagePreparationResult>>());
  const attachmentPreviewUrlsRef = useRef(new Set<string>());
  const attachmentFilesRef = useRef(new Map<string, File>());
  const attachmentUploadsRef = useRef(new Set<string>());
  const requestRunnerRef = useRef<(request: QueuedAgentRequest, signal: AbortSignal) => Promise<void>>(
    async () => undefined,
  );
  const requestCoordinatorRef = useRef<ConversationRequestCoordinator<QueuedAgentRequest> | null>(null);
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = new ConversationRequestCoordinator((request, signal) =>
      requestRunnerRef.current(request, signal));
  }

  const activeOpenTab = useMemo(
    () => workspace.openTabs.find((tab) => tab.id === workspace.activeOpenTabId) ?? workspace.openTabs[0]!,
    [workspace.activeOpenTabId, workspace.openTabs],
  );
  const activeConversation = useMemo(
    () => workspace.conversations.find((conversation) => conversation.id === activeOpenTab.conversationId)
      ?? workspace.conversations[0]!,
    [activeOpenTab.conversationId, workspace.conversations],
  );
  const activeConversationIds = useMemo(
    () => deriveActiveConversationIds(workspace.conversations),
    [workspace.conversations],
  );
  const runSummary = useMemo(
    () => deriveAgentRunSummary(activeConversation.messages),
    [activeConversation.messages],
  );
  const displayedPage = useMemo(() => {
    if (currentPage.status === 'reading') return currentPage;
    const pendingPage = pendingPageSnapshotsRef.current.get(pageSnapshotKey(activeConversation.id, currentPage.url));
    if (pendingPage?.url === currentPage.url) {
      return { ...currentPage, ...pageContextFromSnapshot(pendingPage, 'ready') };
    }
    const sentPage = activeConversation.pages.find((page) => page.url === currentPage.url && page.sentAt);
    return sentPage
      ? { ...currentPage, ...sentPage, title: currentPage.title, site: currentPage.site, status: 'read' as const }
      : { ...currentPage, status: currentPage.status === 'changed' ? 'changed' as const : 'not-read' as const };
  }, [activeConversation.pages, currentPage]);
  const draftContextItems = useMemo(
    () => syncCurrentPageContextItem(activeConversation.draftContextItems, displayedPage, pageIssue ?? undefined),
    [activeConversation.draftContextItems, displayedPage, pageIssue],
  );
  const currentPageItem = useMemo(
    () => draftContextItems.find((item) => item.kind === 'page' && item.role === 'current'),
    [draftContextItems],
  );
  const pageReferenceIncluded = Boolean(currentPageItem?.included && currentPage.url);
  const activeConnectionConfigured = workosConnection
    ? isActiveWorkosConnectionConfigured(workosConnection)
    : false;
  currentPageRef.current = currentPage;

  useEffect(() => {
    if (!workspaceHydrated || !currentPage.url) return;
    setWorkspace((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) => {
        if (conversation.id !== activeConversation.id) return conversation;
        return {
          ...conversation,
          draftContextItems: syncCurrentPageContextItem(
            conversation.draftContextItems,
            currentPage,
            pageIssue ?? undefined,
          ),
        };
      }),
    }));
  }, [activeConversation.id, currentPage, pageIssue, workspaceHydrated]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => () => {
    attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    attachmentPreviewUrlsRef.current.clear();
    attachmentFilesRef.current.clear();
    attachmentUploadsRef.current.clear();
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadWorkspaceState()
      .then((stored) => {
        if (!mounted || !stored) return;
        setWorkspace({
          conversations: stored.conversations.map((conversation) => ({
            ...conversation,
            messages: reconcileTransientMessages(conversation.messages),
          })),
          openTabs: stored.openTabs,
          activeOpenTabId: stored.activeOpenTabId,
        });
      })
      .catch(() => {
        if (!mounted) return;
        setConnectionIssue('无法读取本地历史，会话暂时不会在重启后恢复。');
      })
      .finally(() => {
        if (mounted) setWorkspaceHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void browser.storage.local.get('selectionBubbleEnabled').then((stored) => {
      if (mounted && typeof stored.selectionBubbleEnabled === 'boolean') {
        setSelectionBubbleEnabled(stored.selectionBubbleEnabled);
      }
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const saveTimer = window.setTimeout(() => {
      void saveWorkspaceState(workspace).catch(() => {
        setConnectionIssue('无法保存本地历史，请检查扩展存储权限。');
      });
    }, 350);
    return () => window.clearTimeout(saveTimer);
  }, [workspace, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const flushWorkspace = () => {
      void saveWorkspaceState(workspaceRef.current).catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushWorkspace();
    };
    window.addEventListener('pagehide', flushWorkspace);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushWorkspace);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushWorkspace();
    };
  }, [workspaceHydrated]);

  const updateConversation = useCallback(
    (conversationId: string, updater: (conversation: Conversation) => Conversation) => {
      const current = workspaceRef.current;
      const next = {
        ...current,
        conversations: current.conversations.map((conversation) =>
          conversation.id === conversationId ? updater(conversation) : conversation),
      };
      workspaceRef.current = next;
      setWorkspace(next);
    },
    [],
  );

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
      }));
    },
    [updateConversation],
  );

  const upsertMessageActivity = useCallback(
    (conversationId: string, messageId: string, activity: WorkosToolActivity) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== messageId) return message;
          const nextActivity: RunActivity = { ...activity, kind: 'tool' };
          const existing = message.activities ?? [];
          const index = existing.findIndex((item) => item.id === activity.id);
          return {
            ...message,
            activities: index < 0
              ? [...existing, nextActivity]
              : existing.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextActivity } : item),
          };
        }),
      }));
    },
    [updateConversation],
  );

  const settleMessageActivities = useCallback(
    (conversationId: string, messageId: string, status: RunActivityStatus) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === messageId ? {
          ...message,
          activities: message.activities?.map((activity) =>
            activity.status === 'pending' || activity.status === 'running'
              ? { ...activity, status, completedAt: Date.now() }
              : activity,
          ),
        } : message),
      }));
    },
    [updateConversation],
  );

  const patchActiveConversation = useCallback(
    (patch: Partial<Conversation>) => {
      updateConversation(activeConversation.id, (conversation) => ({ ...conversation, ...patch }));
    },
    [activeConversation.id, updateConversation],
  );

  const stopRequest = useCallback((conversationId: string, messageId: string) => {
    updateMessage(conversationId, messageId, {
      status: 'stopped',
      stage: undefined,
      errorMessage: undefined,
    });
    settleMessageActivities(conversationId, messageId, 'stopped');
    requestCoordinatorRef.current?.stop(conversationId);
  }, [settleMessageActivities, updateMessage]);

  const stopAllRequests = useCallback(() => {
    requestCoordinatorRef.current?.clear();
    setWorkspace((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) => ({
        ...conversation,
        messages: reconcileTransientMessages(conversation.messages),
      })),
    }));
  }, []);

  const refreshPageMetadata = useCallback(async (invalidateSnapshot = false, tabId?: number) => {
    const requestId = ++pageMetadataRequestRef.current;
    const request: ExtensionRequest = { type: 'page:get-active-metadata', tabId };
    const response = await browser.runtime.sendMessage(request).catch(() => null) as PageResponse | null;
    if (requestId !== pageMetadataRequestRef.current) return;
    if (response?.page) {
      activeBrowserTabIdRef.current = response.page.browserTabId ?? tabId;
      if (invalidateSnapshot) {
        pendingPageSnapshotsRef.current.delete(pageSnapshotKey(activeConversation.id, response.page.url));
        setPageMetadataRevision((revision) => revision + 1);
      }
      setCurrentPage({ ...response.page, status: 'not-read' });
      setPageIssue(null);
    } else {
      setCurrentPage({ title: '当前页面', site: '', url: '', status: 'not-read' });
      setPageIssue(response?.error ?? '无法连接当前网页，请刷新后重试。');
    }
  }, [activeConversation.id]);

  const consumePendingQuotes = useCallback(async () => {
    const request: ExtensionRequest = { type: 'selection:consume' };
    const response = await browser.runtime.sendMessage(request).catch(() => null) as SelectionConsumeResponse | null;
    if (!response?.quotes?.length) return;
    updateConversation(activeConversation.id, (conversation) => {
      const nextItems = [...conversation.draftContextItems];
      response.quotes.forEach((quote) => {
        const alreadyAdded = nextItems.some((item) => item.kind === 'selection'
          && item.selection.pageUrl === quote.pageUrl
          && item.selection.text === quote.text);
        if (!alreadyAdded) nextItems.push(selectionContextItem(quote));
      });
      return { ...conversation, draftContextItems: nextItems };
    });
  }, [activeConversation.id, updateConversation]);

  useEffect(() => {
    const port = browser.runtime.connect({ name: 'yebian-sidepanel' });
    return () => port.disconnect();
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const onRuntimeMessage = (message: ExtensionEvent) => {
      if (message?.type === 'selection:available') void consumePendingQuotes();
      return undefined;
    };
    browser.runtime.onMessage.addListener(onRuntimeMessage);
    void consumePendingQuotes();
    return () => browser.runtime.onMessage.removeListener(onRuntimeMessage);
  }, [consumePendingQuotes, workspaceHydrated]);

  useEffect(() => {
    const onActivated = (activeInfo: { tabId: number }) => {
      activeBrowserTabIdRef.current = activeInfo.tabId;
      void refreshPageMetadata(false, activeInfo.tabId);
    };
    const onUpdated = (tabId: number, changeInfo: BrowserTabChange) => {
      if (shouldRefreshPageMetadataForTab(tabId, activeBrowserTabIdRef.current, changeInfo)) {
        void refreshPageMetadata(true, tabId);
      }
    };
    const onWindowFocus = () => void refreshPageMetadata(false, activeBrowserTabIdRef.current);
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    window.addEventListener('focus', onWindowFocus);
    void refreshPageMetadata();
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [refreshPageMetadata]);

  useEffect(() => {
    let mounted = true;
    void loadWorkosConnectionSettings()
      .then((settings) => {
        if (!mounted) return;
        setWorkosConnection(settings);
        if (!isActiveWorkosConnectionConfigured(settings)) {
          setConnectionIssue('请先配置当前 WorkOS 连接通道，再发送第一条消息。');
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setWorkosConnection({ ...EMPTY_WORKOS_CONNECTION_SETTINGS });
        setConnectionIssue('无法读取扩展存储，请确认页面由已安装的 Chrome 插件打开。');
        setSettingsOpen(true);
      });
    return () => {
      mounted = false;
      requestCoordinatorRef.current?.clear();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHistoryOpen(false);
      setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startNewConversation = () => {
    if (!workspaceHydrated || workspace.openTabs.length >= MAX_OPEN_TABS) return;
    const conversation = createConversation(currentPage);
    const tab = createOpenTab(conversation.id);
    setWorkspace((current) => ({
      conversations: [conversation, ...current.conversations],
      openTabs: [...current.openTabs, tab],
      activeOpenTabId: tab.id,
    }));
    setHistoryOpen(false);
  };

  const closeTab = (tabId: string) => {
    if (!workspaceHydrated) return;
    setWorkspace((current) => closeWorkspaceTab(current, tabId));
  };

  const selectTab = (tabId: string) => {
    setWorkspace((current) => ({ ...current, activeOpenTabId: tabId }));
    setHistoryOpen(false);
  };

  const selectHistory = (conversationId: string) => {
    setWorkspace((current) => openConversationInWorkspace(
      current,
      conversationId,
      MAX_OPEN_TABS,
      createOpenTab,
    ));
    setHistoryOpen(false);
  };

  const archiveConversation = (conversationId: string) => {
    setWorkspace((current) => {
      if (current.openTabs.some((tab) => tab.conversationId === conversationId)) return current;
      return {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === conversationId
          ? { ...conversation, archivedAt: Date.now() }
          : conversation),
      };
    });
  };

  const restoreConversation = (conversationId: string) => {
    updateConversation(conversationId, (conversation) => ({ ...conversation, archivedAt: undefined }));
  };

  const branchFromMessage = (message: ChatMessage) => {
    if (!workspaceHydrated || runSummary || workspace.openTabs.length >= MAX_OPEN_TABS) return;
    const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) return;
    const sourceMessages = activeConversation.messages.slice(0, messageIndex + 1);
    const rootConversationId = activeConversation.branch?.rootConversationId ?? activeConversation.id;
    const ordinal = workspace.conversations.reduce((maximum, conversation) =>
      conversation.branch?.rootConversationId === rootConversationId
        ? Math.max(maximum, conversation.branch.ordinal)
        : maximum, 0) + 1;
    const conversation: Conversation = {
      id: makeId('conversation'),
      title: activeConversation.title,
      subtitle: `分支 ${ordinal} · 刚刚`,
      updatedAt: Date.now(),
      isDraft: false,
      branch: {
        rootConversationId,
        parentConversationId: activeConversation.id,
        sourceMessageId: message.id,
        ordinal,
      },
      page: { ...activeConversation.page },
      pages: activeConversation.pages.map((page) => ({ ...page })),
      messages: cloneMessagesForBranch(sourceMessages),
      draftInput: '',
      draftContextItems: legacyDraftContextItems(activeConversation.page, undefined),
      pendingBranchContext: buildBranchContext(sourceMessages),
    };
    const tab = createOpenTab(conversation.id);
    setWorkspace((current) => ({
      conversations: [conversation, ...current.conversations],
      openTabs: [...current.openTabs, tab],
      activeOpenTabId: tab.id,
    }));
    setHistoryOpen(false);
  };

  const preparePageContext = useCallback((conversationId: string, page: PageContext) => {
    if (!page.url) return Promise.resolve<PagePreparationResult>({ error: '当前页面不支持读取。' });
    const key = pageSnapshotKey(conversationId, page.url);
    const cached = pendingPageSnapshotsRef.current.get(key);
    if (cached) return Promise.resolve<PagePreparationResult>({ snapshot: cached });
    const pending = pendingPagePreparationsRef.current.get(key);
    if (pending) return pending;

    setCurrentPage((current) => current.url === page.url
      ? { ...current, status: 'reading' }
      : current);
    const request: ExtensionRequest = {
      type: 'page:extract-active',
      tabId: page.browserTabId,
      expectedUrl: page.url,
    };
    const preparation = (async (): Promise<PagePreparationResult> => {
      const response = await browser.runtime.sendMessage(request).catch(() => null) as PageResponse | null;
      if (!response?.page || !('markdown' in response.page)) {
        const error = response?.error ?? '当前页面正文读取失败。';
        setCurrentPage((current) => current.url === page.url
          ? { ...current, status: 'not-read' }
          : current);
        if (currentPageRef.current.url === page.url) setPageIssue(error);
        return { error };
      }
      const snapshot = response.page as PageSnapshot;
      pendingPageSnapshotsRef.current.set(key, snapshot);
      setCurrentPage((current) => current.url === snapshot.url
        ? pageContextFromSnapshot(snapshot, 'ready')
        : current);
      if (currentPageRef.current.url === snapshot.url) setPageIssue(null);
      return { snapshot };
    })().finally(() => {
      pendingPagePreparationsRef.current.delete(key);
    });
    pendingPagePreparationsRef.current.set(key, preparation);
    return preparation;
  }, []);

  useEffect(() => {
    if (!workspaceHydrated || !currentPage.url) return;
    const timer = window.setTimeout(() => {
      void preparePageContext(activeConversation.id, currentPage);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    activeConversation.id,
    currentPage.browserTabId,
    currentPage.title,
    currentPage.url,
    pageMetadataRevision,
    preparePageContext,
    workspaceHydrated,
  ]);

  const runAgentRequest = async (request: QueuedAgentRequest, signal: AbortSignal) => {
    const connection = workosConnection;
    if (!connection || !isActiveWorkosConnectionConfigured(connection)) return;
    const transport = createWorkosTransport(connection);
    const { conversationId, messageId, userMessage, needsPageRead } = request;
    updateMessage(conversationId, messageId, {
      status: 'running',
      stage: needsPageRead ? 'reading-page' : 'waiting-first-token',
      errorMessage: undefined,
    });
    let receivedText = false;
    let terminalError: string | null = null;
    let branchContextConsumed = false;
    const preparation = await waitForAbortable(request.pageSnapshotPromise, signal);
    if (signal.aborted) return;
    const pageSnapshot = preparation?.snapshot;
    const currentConversation = workspaceRef.current.conversations.find((conversation) => conversation.id === conversationId);
    const pendingBranchContext = currentConversation?.pendingBranchContext;
    const connectionTargetChanged = hasWorkosRemoteTargetChanged(
      currentConversation?.remoteUuid,
      currentConversation?.remoteTransport,
      currentConversation?.remoteAgentUuid,
      transport.kind,
      connection.agentUuid,
    );
    const earlierMessages = currentConversation?.messages.filter(
      (message) => message.id !== userMessage.id && message.id !== messageId,
    ) ?? [];
    const transportHandoffContext = connectionTargetChanged && earlierMessages.length
      ? buildTransportHandoffContext(earlierMessages)
      : undefined;
    const continuationContext = pendingBranchContext ?? transportHandoffContext;
    const messageContextItems = contextItemsFromMessage(userMessage);
    const messagePageItem = contextPage(messageContextItems);
    const messagePage = messagePageItem?.page;
    const messageSelections = contextSelections(messageContextItems);
    const messageAttachments = contextAttachments(messageContextItems);
    const preparedPage = messagePage
      ? preparePageReference(pageSnapshot ?? messagePage)
      : undefined;
    const previousPage = currentConversation?.remoteUuid && !connectionTargetChanged && preparedPage
      ? currentConversation.pages.find((page) =>
          (page.sourceId && page.sourceId === preparedPage.source.source_id)
          || page.url === preparedPage.source.url)
      : undefined;
    const pageDecision: CurrentPageDeliveryDecision = decideCurrentPageDelivery({
      included: Boolean(messagePage),
      prepared: preparedPage,
      previous: previousPage
        ? {
            source_id: previousPage.sourceId ?? preparedPage!.source.source_id,
            revision_id: previousPage.contentHash,
            delivered_at: previousPage.sentAt ? new Date(previousPage.sentAt).toISOString() : undefined,
          }
        : undefined,
      agent: WORKOS_AGENT_CAPABILITIES,
    });
    const pageContextMode = pageDecision.mode === 'none' ? undefined : pageDecision.mode;
    const pageContextDelivery = pageDecision.mode === 'none'
      ? undefined
      : pageDecision.mode === 'reuse'
        ? 'reuse' as const
        : pageDecision.delivery;

    if (pageSnapshot) {
      updateMessage(conversationId, userMessage.id, {
        contextItems: updatePageContextSnapshot(
          messageContextItems,
          pageContextFromSnapshot(pageSnapshot, 'ready'),
          undefined,
          pageContextDelivery,
        ),
        pageContextMode,
        pageContextDelivery,
        pageContextIssue: undefined,
      });
    } else if (needsPageRead && messagePage) {
      const issue = preparation?.error ?? '当前页仅以链接加入，正文未能读取。';
      updateMessage(conversationId, userMessage.id, {
        contextItems: updatePageContextSnapshot(
          messageContextItems,
          { ...messagePage, status: 'not-read' },
          issue,
          pageContextDelivery,
        ),
        pageContextMode,
        pageContextDelivery,
        pageContextIssue: issue,
      });
    }

    const content = buildAgentContent({
      question: userMessage.content,
      quotes: messageSelections,
      ...(preparedPage ? { page: { prepared: preparedPage, decision: pageDecision } } : {}),
    });
    const consumeBranchContext = () => {
      if (!pendingBranchContext || branchContextConsumed) return;
      branchContextConsumed = true;
      updateConversation(conversationId, (conversation) => ({ ...conversation, pendingBranchContext: undefined }));
    };

    try {
      let remoteUuid = connectionTargetChanged ? undefined : currentConversation?.remoteUuid;
      if (!remoteUuid) {
        updateMessage(conversationId, messageId, { stage: 'creating-conversation' });
        remoteUuid = await transport.createConversation(signal);
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          remoteUuid,
          remoteTransport: transport.kind,
          remoteAgentUuid: connection.agentUuid,
        }));
      }
      updateMessage(conversationId, messageId, { stage: 'waiting-first-token' });
      await transport.executeStream(
        remoteUuid,
        {
          content: prependBranchContext(continuationContext, content),
          attachments: messageAttachments
            .filter((attachment) => attachment.status === 'ready' && attachment.url)
            .map((attachment) => ({
              url: attachment.url!,
              filename: attachment.filename,
              ...(attachment.mime ? { mime: attachment.mime } : {}),
            })),
        },
        {
          onText: (text) => {
            consumeBranchContext();
            const respondedAt = !receivedText && text.length > 0 ? Date.now() : undefined;
            receivedText = receivedText || text.length > 0;
            updateMessage(conversationId, messageId, {
              content: text,
              stage: 'streaming',
              status: 'streaming',
              ...(respondedAt ? { respondedAt } : {}),
            });
          },
          onActivity: (activity) => {
            consumeBranchContext();
            upsertMessageActivity(conversationId, messageId, activity);
          },
          onError: (message) => {
            terminalError = message;
          },
        },
        signal,
      );
      consumeBranchContext();
      if (terminalError) throw new WorkosApiError(terminalError);
      if (!receivedText) throw new WorkosApiError('Agent 已结束运行，但没有返回可显示的文本。');
      if (preparedPage && pageDecision.mode !== 'none' && messagePage) {
        const deliveredAt = Date.now();
        updateConversation(conversationId, (conversation) => {
          const existing = conversation.pages.find((page) =>
            (page.sourceId && page.sourceId === preparedPage.source.source_id)
            || page.url === preparedPage.source.url);
          const basePage = pageSnapshot
            ? sentPageContext(pageSnapshot, deliveredAt, pageDecision.mode === 'reuse'
                ? existing?.version ?? 1
                : (existing?.version ?? 0) + 1)
            : {
                ...messagePage,
                sourceId: preparedPage.source.source_id,
                manifest: preparedPage.manifest,
                status: 'read' as const,
                sentAt: deliveredAt,
                version: pageDecision.mode === 'reuse'
                  ? existing?.version ?? 1
                  : (existing?.version ?? 0) + 1,
              };
          const deliveredPage = {
            ...basePage,
            sourceId: preparedPage.source.source_id,
            manifest: preparedPage.manifest,
          };
          const pages = existing
            ? conversation.pages.map((page) => page === existing
                ? pageDecision.mode === 'reuse'
                  ? { ...page, sourceId: deliveredPage.sourceId, manifest: deliveredPage.manifest }
                  : deliveredPage
                : page)
            : [...conversation.pages, deliveredPage];
          return {
            ...conversation,
            page: deliveredPage,
            pages,
            subtitle: conversation.branch
              ? `分支 ${conversation.branch.ordinal} · 刚刚`
              : `${pages.length} 个页面 · 刚刚`,
          };
        });
        updateMessage(conversationId, userMessage.id, {
          contextItems: updatePageContextSnapshot(
            messageContextItems,
            {
              ...(pageSnapshot ? pageContextFromSnapshot(pageSnapshot, 'read') : messagePage),
              sentAt: deliveredAt,
            },
            pageSnapshot ? undefined : preparation?.error,
            pageContextDelivery,
          ),
          pageContextMode,
          pageContextDelivery,
          pageContextIssue: pageSnapshot ? undefined : preparation?.error,
        });
        setCurrentPage((page) => page.url === preparedPage.source.url
          ? {
              ...page,
              ...(pageSnapshot ? pageContextFromSnapshot(pageSnapshot, 'read') : {}),
              sentAt: deliveredAt,
            }
          : page);
      }
      updateMessage(conversationId, messageId, {
        status: 'complete',
        stage: undefined,
        errorMessage: undefined,
      });
      settleMessageActivities(conversationId, messageId, 'completed');
      setConnectionIssue(null);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Agent 请求失败，请稍后重试。';
      updateMessage(conversationId, messageId, {
        status: 'failed',
        stage: undefined,
        errorMessage: message,
      });
      settleMessageActivities(conversationId, messageId, 'failed');
      setConnectionIssue(message);
      if (error instanceof WorkosApiError && (error.status === 401 || error.status === 403)) {
        setSettingsOpen(true);
      }
    }
  };
  requestRunnerRef.current = runAgentRequest;

  const sendMessage = () => {
    if (!workspaceHydrated || workosConnection === null) return;
    if (!activeConnectionConfigured) {
      setConnectionIssue('请先配置当前 WorkOS 连接通道，再发送消息。');
      setSettingsOpen(true);
      return;
    }
    if (draftContextItems.some((item) => item.included
      && (item.kind === 'file' || item.kind === 'image')
      && item.status === 'preparing')) {
      setConnectionIssue('附件仍在上传，请等待完成后再发送。');
      return;
    }
    const readyAttachments = contextAttachments(draftContextItems).filter((attachment) => attachment.url);
    const readySelections = contextSelections(draftContextItems);
    const hasContent = activeConversation.draftInput.trim()
      || readySelections.length > 0
      || readyAttachments.length > 0;
    if (!hasContent) return;

    const now = Date.now();
    const conversationAtSend = activeConversation;
    const pageAtSend = contextPage(draftContextItems)?.page ?? displayedPage;
    const includeCurrentPage = shouldPreparePageReference(pageReferenceIncluded, pageAtSend);
    const snapshotKey = pageSnapshotKey(conversationAtSend.id, pageAtSend.url);
    const queuedSnapshot = includeCurrentPage ? pendingPageSnapshotsRef.current.get(snapshotKey) : undefined;
    const needsPageRead = includeCurrentPage;
    const userMessage: ChatMessage = {
      id: makeId('message'),
      role: 'user',
      content: activeConversation.draftInput.trim(),
      createdAt: now,
      status: 'complete',
      contextItems: createContextSnapshot(draftContextItems).map((item) =>
        item.kind === 'page'
          ? {
              ...item,
              status: needsPageRead ? 'preparing' as const : 'ready' as const,
              page: { ...item.page, status: needsPageRead ? 'reading' as const : 'read' as const },
            }
          : item),
    };
    const assistantMessage: ChatMessage = {
      id: makeId('message'),
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'queued',
      stage: 'queued',
      activities: [],
    };

    updateConversation(conversationAtSend.id, (conversation) => ({
      ...conversation,
      title: conversation.isDraft && conversation.draftInput.trim()
        ? conversation.draftInput.trim().slice(0, 18)
        : conversation.title,
      subtitle: recentSubtitle(conversation),
      isDraft: false,
      updatedAt: now,
      messages: [...conversation.messages, userMessage, assistantMessage],
      draftInput: '',
      draftContextItems: retainContextAfterSend(conversation.draftContextItems),
    }));

    const pageSnapshotPromise = queuedSnapshot
      ? Promise.resolve<PagePreparationResult>({ snapshot: queuedSnapshot })
      : needsPageRead
        ? preparePageContext(conversationAtSend.id, pageAtSend)
        : Promise.resolve<PagePreparationResult>({});

    requestCoordinatorRef.current?.enqueue({
      conversationId: conversationAtSend.id,
      messageId: assistantMessage.id,
      userMessage,
      needsPageRead,
      pageSnapshotPromise,
    });
  };

  const retryMessage = (message: ChatMessage) => {
    if (!workspaceHydrated || !activeConnectionConfigured) return;
    const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
    const userMessage = [...activeConversation.messages.slice(0, messageIndex)].reverse().find((item) => item.role === 'user');
    if (!userMessage) return;
    updateMessage(activeConversation.id, message.id, {
      content: '',
      respondedAt: undefined,
      status: 'queued',
      stage: 'queued',
      errorMessage: undefined,
      activities: [],
    });
    const retryPage = contextPage(contextItemsFromMessage(userMessage))?.page;
    const cachedSnapshot = retryPage
      ? pendingPageSnapshotsRef.current.get(pageSnapshotKey(activeConversation.id, retryPage.url))
      : undefined;
    const pageSnapshotPromise = cachedSnapshot
      ? Promise.resolve<PagePreparationResult>({ snapshot: cachedSnapshot })
      : retryPage
        ? preparePageContext(activeConversation.id, retryPage)
        : Promise.resolve<PagePreparationResult>({});
    requestCoordinatorRef.current?.enqueue({
      conversationId: activeConversation.id,
      messageId: message.id,
      userMessage,
      needsPageRead: Boolean(retryPage),
      pageSnapshotPromise,
    });
  };

  const uploadAttachment = useCallback((
    conversationId: string,
    attachmentId: string,
    file: File,
    localPreviewUrl?: string,
  ) => {
    const connection = workosConnection;
    if (!connection || !isWorkosFileUploadConfigured(connection)) {
      setConnectionIssue(connection?.transport === 'internal-v2'
        ? '请先完整配置 WorkOS 内部连接凭证。'
        : '请先配置 WorkOS 公开 v1 API Token。');
      setSettingsOpen(true);
      return;
    }
    if (attachmentUploadsRef.current.has(attachmentId)) return;
    attachmentUploadsRef.current.add(attachmentId);
    const fileUploader = createWorkosFileUploader(connection);
    const previewUrl = isImageFile(file.name, file.type) ? localPreviewUrl : undefined;

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      draftContextItems: updateAttachmentContextItem(
        conversation.draftContextItems,
        attachmentId,
        (item) => ({
          ...item,
          status: 'uploading',
          uploadTransport: connection.transport,
          errorMessage: undefined,
        }),
      ),
    }));

    void fileUploader.upload(file)
      .then(({ fileReadUrl }) => {
        const useRemotePreview = () => {
          updateConversation(conversationId, (conversation) => ({
            ...conversation,
            draftContextItems: updateAttachmentContextItem(
              conversation.draftContextItems,
              attachmentId,
              (item) => ({
                ...item,
                status: 'ready',
                url: fileReadUrl,
                previewUrl: undefined,
                uploadTransport: connection.transport,
                errorMessage: undefined,
              }),
            ),
          }));
          attachmentFilesRef.current.delete(attachmentId);
          attachmentUploadsRef.current.delete(attachmentId);
          if (previewUrl) {
            window.requestAnimationFrame(() => {
              URL.revokeObjectURL(previewUrl);
              attachmentPreviewUrlsRef.current.delete(previewUrl);
            });
          }
        };

        if (!isImageFile(file.name, file.type) || !previewUrl) {
          useRemotePreview();
          return;
        }

        const remoteImage = new Image();
        remoteImage.onload = useRemotePreview;
        remoteImage.onerror = () => {
          updateConversation(conversationId, (conversation) => ({
            ...conversation,
            draftContextItems: updateAttachmentContextItem(
              conversation.draftContextItems,
              attachmentId,
              (item) => ({
                ...item,
                status: 'ready',
                url: fileReadUrl,
                uploadTransport: connection.transport,
                errorMessage: undefined,
              }),
            ),
          }));
          attachmentFilesRef.current.delete(attachmentId);
          attachmentUploadsRef.current.delete(attachmentId);
        };
        remoteImage.src = fileReadUrl;
      })
      .catch((error: unknown) => {
        attachmentUploadsRef.current.delete(attachmentId);
        const errorMessage = error instanceof Error ? error.message : '附件上传失败，请稍后重试。';
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          draftContextItems: updateAttachmentContextItem(
            conversation.draftContextItems,
            attachmentId,
            (item) => ({ ...item, status: 'failed', errorMessage }),
          ),
        }));
        setConnectionIssue(errorMessage);
      });
  }, [updateConversation, workosConnection]);

  const addAttachments = (selectedFiles: File[]) => {
    if (!selectedFiles.length) return 0;
    if (!workspaceHydrated || workosConnection === null) {
      setConnectionIssue('正在读取连接配置，请稍后再添加附件。');
      return 0;
    }
    if (!isWorkosFileUploadConfigured(workosConnection)) {
      setConnectionIssue(workosConnection.transport === 'internal-v2'
        ? '请先完整配置 WorkOS 内部连接凭证。'
        : '请先配置 WorkOS 公开 v1 API Token。');
      setSettingsOpen(true);
      return 0;
    }

    const conversationId = activeConversation.id;
    const attachmentCount = activeConversation.draftContextItems.filter(
      (item) => item.kind === 'file' || item.kind === 'image',
    ).length;
    const availableSlots = Math.max(0, MAX_DRAFT_ATTACHMENTS - attachmentCount);
    const filesToAdd = selectedFiles.slice(0, availableSlots);
    if (!filesToAdd.length) {
      setConnectionIssue(`每个问题最多添加 ${MAX_DRAFT_ATTACHMENTS} 个附件。`);
      return 0;
    }
    if (filesToAdd.length < selectedFiles.length) {
      setConnectionIssue(`每个问题最多添加 ${MAX_DRAFT_ATTACHMENTS} 个附件，已忽略多余文件。`);
    }

    const uploads = filesToAdd.map((file) => {
      const errorMessage = attachmentValidationError(file, workosConnection.transport);
      let previewUrl: string | undefined;
      if (isImageFile(file.name, file.type)) {
        try {
          previewUrl = URL.createObjectURL(file);
          attachmentPreviewUrlsRef.current.add(previewUrl);
        } catch {
          // The attachment can still upload when the browser cannot create a local preview.
        }
      }
      return {
        file,
        attachment: {
          id: makeId('attachment'),
          filename: file.name,
          sizeLabel: formatFileSize(file.size),
          status: errorMessage ? 'failed' as const : 'uploading' as const,
          mime: file.type || undefined,
          previewUrl,
          uploadTransport: workosConnection.transport,
          errorMessage: errorMessage ?? undefined,
        },
      };
    });

    uploads.forEach(({ file, attachment }) => {
      attachmentFilesRef.current.set(attachment.id, file);
    });

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      draftContextItems: [
        ...conversation.draftContextItems,
        ...uploads.map(({ attachment }) => attachmentContextItem(attachment)),
      ],
    }));

    uploads.forEach(({ file, attachment }) => {
      if (attachment.status !== 'failed') uploadAttachment(conversationId, attachment.id, file, attachment.previewUrl);
    });
    return filesToAdd.length;
  };

  const retryAttachment = (contextItemId: string) => {
    const item = draftContextItems.find((candidate) => candidate.id === contextItemId);
    if (!item || (item.kind !== 'file' && item.kind !== 'image') || item.status !== 'failed') return;
    if (!workosConnection || !isWorkosFileUploadConfigured(workosConnection)) {
      setConnectionIssue(workosConnection?.transport === 'internal-v2'
        ? '请先完整配置 WorkOS 内部连接凭证。'
        : '请先配置 WorkOS 公开 v1 API Token。');
      setSettingsOpen(true);
      return;
    }
    const file = attachmentFilesRef.current.get(item.attachment.id);
    if (!file) {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = attachmentAcceptForChannel(workosConnection.transport);
      picker.onchange = () => {
        const replacement = picker.files?.[0];
        if (!replacement) return;
        const validationIssue = attachmentValidationError(replacement, workosConnection.transport);
        if (validationIssue) {
          setConnectionIssue(validationIssue);
          return;
        }
        const oldPreview = item.attachment.previewUrl;
        let previewUrl: string | undefined;
        if (isImageFile(replacement.name, replacement.type)) {
          try {
            previewUrl = URL.createObjectURL(replacement);
            attachmentPreviewUrlsRef.current.add(previewUrl);
          } catch {
            // The upload can continue without a local preview.
          }
        }
        if (oldPreview) {
          URL.revokeObjectURL(oldPreview);
          attachmentPreviewUrlsRef.current.delete(oldPreview);
        }
        attachmentFilesRef.current.set(item.attachment.id, replacement);
        updateConversation(activeConversation.id, (conversation) => ({
          ...conversation,
          draftContextItems: updateAttachmentContextItem(
            conversation.draftContextItems,
            item.attachment.id,
            (attachment) => ({
              ...attachment,
              filename: replacement.name,
              sizeLabel: formatFileSize(replacement.size),
              mime: replacement.type || undefined,
              previewUrl,
              uploadTransport: workosConnection.transport,
              errorMessage: undefined,
            }),
          ),
        }));
        uploadAttachment(activeConversation.id, item.attachment.id, replacement, previewUrl);
      };
      picker.click();
      return;
    }
    const validationIssue = workosConnection
      ? attachmentValidationError(file, workosConnection.transport)
      : '连接配置尚未读取完成。';
    if (validationIssue) {
      setConnectionIssue(validationIssue);
      return;
    }
    uploadAttachment(activeConversation.id, item.attachment.id, file, item.attachment.previewUrl);
  };

  const saveConnection = async (settings: WorkosConnectionSettings) => {
    stopAllRequests();
    const saved = await saveWorkosConnectionSettings(settings);
    setWorkosConnection(saved);
    setConnectionIssue(null);
  };

  const testConnection = async (settings: WorkosConnectionSettings) => {
    await validateWorkosConnection(settings);
    setConnectionIssue(null);
  };

  const removeCredentials = async (kind: WorkosConnectionSettings['transport']) => {
    stopAllRequests();
    const saved = await removeWorkosCredentials(kind);
    setWorkosConnection(saved);
    setConnectionIssue(kind === 'public-v1' ? 'v1 API Token 已从本机移除。' : 'v2 登录凭证已从本机移除。');
  };

  const changeSelectionBubble = (enabled: boolean) => {
    setSelectionBubbleEnabled(enabled);
    void browser.storage.local.set({ selectionBubbleEnabled: enabled }).catch(() => {
      setConnectionIssue('无法保存划词入口设置。');
    });
  };

  const clearHistory = () => {
    if (!workspaceHydrated) return;
    stopAllRequests();
    attachmentPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    attachmentPreviewUrlsRef.current.clear();
    attachmentFilesRef.current.clear();
    attachmentUploadsRef.current.clear();
    const conversation = createConversation(currentPage);
    const tab = createOpenTab(conversation.id);
    setWorkspace({ conversations: [conversation], openTabs: [tab], activeOpenTabId: tab.id });
    setClearDialogOpen(false);
    setSettingsOpen(false);
  };

  const changeContextItemIncluded = (id: string, included: boolean) => {
    patchActiveConversation({
      draftContextItems: contextItemIncluded(draftContextItems, id, included),
    });
  };

  const branchParent = activeConversation.branch
    ? workspace.conversations.find((conversation) => conversation.id === activeConversation.branch?.parentConversationId)
    : undefined;
  const branchSourceMessage = branchParent && activeConversation.branch?.sourceMessageId
    ? branchParent.messages.find((message) => message.id === activeConversation.branch?.sourceMessageId)
    : undefined;
  const branchParentAlreadyOpen = Boolean(
    branchParent && workspace.openTabs.some((tab) => tab.conversationId === branchParent.id),
  );
  const branchOriginUnavailableReason = !branchParent
    ? '原会话记录不存在'
    : branchParent.archivedAt
      ? '原会话已归档，请先在历史中恢复'
      : !branchParentAlreadyOpen && workspace.openTabs.length >= MAX_OPEN_TABS
        ? `最多打开 ${MAX_OPEN_TABS} 个工作页，请先关闭一个`
        : undefined;
  const branchOrigin = activeConversation.branch
    ? {
        title: branchParent?.title ?? '原会话',
        timestamp: branchSourceMessage?.respondedAt ?? branchSourceMessage?.createdAt,
        available: branchOriginUnavailableReason === undefined,
        unavailableReason: branchOriginUnavailableReason,
      }
    : undefined;

  return (
    <div className="app-shell">
      <TopBar tabCount={workspace.openTabs.length} onOpenSettings={() => setSettingsOpen(true)} />
      <MessageList
        messages={activeConversation.messages}
        branchOrigin={branchOrigin}
        branchUnavailableReason={runSummary
          ? '请等待当前回答结束后再创建分支'
          : workspace.openTabs.length >= MAX_OPEN_TABS
            ? `最多打开 ${MAX_OPEN_TABS} 个工作页，请先关闭一个`
            : undefined}
        onUseStarter={(value) => patchActiveConversation({ draftInput: value })}
        onRetry={retryMessage}
        onBranch={branchFromMessage}
        onOpenBranchOrigin={() => {
          if (branchParent) selectHistory(branchParent.id);
        }}
        onAddAssistantQuote={(quote) => {
          updateConversation(activeConversation.id, (conversation) => {
            const alreadyAdded = conversation.draftContextItems.some((item) => item.kind === 'selection'
              && item.selection.sourceMessageId === quote.sourceMessageId
              && item.selection.text === quote.text);
            return alreadyAdded
              ? conversation
              : { ...conversation, draftContextItems: [...conversation.draftContextItems, selectionContextItem(quote)] };
          });
        }}
      />
      <Composer
        tabs={workspace.openTabs}
        conversations={workspace.conversations}
        activeTabId={activeOpenTab.id}
        input={activeConversation.draftInput}
        contextItems={draftContextItems}
        activeConversationIds={activeConversationIds}
        runSummary={runSummary}
        historyOpen={historyOpen}
        connectionState={!workspaceHydrated || workosConnection === null ? 'loading' : activeConnectionConfigured ? 'configured' : 'missing'}
        fileUploadEnabled={Boolean(workosConnection && isWorkosFileUploadConfigured(workosConnection))}
        fileAccept={workosConnection
          ? attachmentAcceptForChannel(workosConnection.transport)
          : attachmentAcceptForChannel('public-v1')}
        maxTabs={MAX_OPEN_TABS}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewConversation={startNewConversation}
        onToggleHistory={() => setHistoryOpen((value) => !value)}
        onInputChange={(value) => patchActiveConversation({ draftInput: value })}
        onContextIncludedChange={changeContextItemIncluded}
        onRetryAttachment={retryAttachment}
        onRemoveContextItem={(id) => {
          const removed = draftContextItems.find((item) => item.id === id);
          if (removed && (removed.kind === 'file' || removed.kind === 'image') && removed.attachment.previewUrl) {
            URL.revokeObjectURL(removed.attachment.previewUrl);
            attachmentPreviewUrlsRef.current.delete(removed.attachment.previewUrl);
          }
          if (removed && (removed.kind === 'file' || removed.kind === 'image')) {
            attachmentFilesRef.current.delete(removed.attachment.id);
          }
          patchActiveConversation({
            draftContextItems: removeContextItem(draftContextItems, id),
          });
        }}
        onFilesSelected={addAttachments}
        onAttachmentUnavailable={() => {
          if (workosConnection === null) {
            setConnectionIssue('正在读取连接配置，请稍后再添加附件。');
            return;
          }
          setConnectionIssue(workosConnection.transport === 'internal-v2'
            ? '请先完整配置 WorkOS 内部连接凭证。'
            : '请先配置 WorkOS 公开 v1 API Token。');
          setSettingsOpen(true);
        }}
        onSend={sendMessage}
        onStop={() => {
          if (runSummary) stopRequest(activeConversation.id, runSummary.activeMessageId);
        }}
      />

      <HistoryPopover
        open={historyOpen}
        conversations={workspace.conversations}
        openTabs={workspace.openTabs}
        activeId={activeConversation.id}
        maxTabs={MAX_OPEN_TABS}
        onClose={() => setHistoryOpen(false)}
        onSelect={selectHistory}
        onArchive={archiveConversation}
        onRestore={restoreConversation}
      />
      <SettingsDrawer
        open={settingsOpen}
        settings={workosConnection ?? EMPTY_WORKOS_CONNECTION_SETTINGS}
        connectionIssue={connectionIssue}
        bubbleEnabled={selectionBubbleEnabled}
        onSaveConnection={saveConnection}
        onTestConnection={testConnection}
        onRemoveCredentials={removeCredentials}
        onBubbleEnabledChange={changeSelectionBubble}
        onClose={() => setSettingsOpen(false)}
        onClearHistory={() => setClearDialogOpen(true)}
      />
      <ConfirmDialog open={clearDialogOpen} onCancel={() => setClearDialogOpen(false)} onConfirm={clearHistory} />
    </div>
  );
}
