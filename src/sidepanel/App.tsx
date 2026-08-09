import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { buildAgentContent } from '../services/buildAgentContent';
import { buildBranchContext, prependBranchContext } from '../services/buildBranchContext';
import { loadWorkosToken, removeWorkosToken, saveWorkosToken } from '../services/tokenStorage';
import { createWorkosConversation, executeWorkosStream, WorkosApiError } from '../services/workosClient';
import type { WorkosToolActivity } from '../services/workosSse';
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
import { SourceBar } from './components/SourceBar';
import { TopBar } from './components/TopBar';
import { CURRENT_PAGE, INITIAL_WORKSPACE } from './mockData';
import type {
  ChatMessage,
  Conversation,
  OpenConversationTab,
  PageContext,
  RunActivity,
  RunActivityStatus,
  WorkspaceState,
} from './types';

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    draftQuotes: [],
    draftAttachments: [],
  };
}

function sentPageContext(snapshot: PageSnapshot, sentAt: number, version: number): PageContext {
  const { markdown: _markdown, ...page } = snapshot;
  return { ...page, status: 'read', sentAt, version };
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
  pageSnapshotPromise: Promise<PageSnapshot | undefined>;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workosToken, setWorkosToken] = useState<string | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageContext>(CURRENT_PAGE);
  const [pageIssue, setPageIssue] = useState<string | null>(null);
  const [selectionBubbleEnabled, setSelectionBubbleEnabled] = useState(true);
  const workspaceRef = useRef<WorkspaceState>(INITIAL_WORKSPACE);
  const pendingPageSnapshotsRef = useRef(new Map<string, PageSnapshot>());
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
    const pendingPage = pendingPageSnapshotsRef.current.get(activeConversation.id);
    if (pendingPage?.url === currentPage.url) return { ...currentPage, ...pendingPage, status: 'ready' as const };
    const sentPage = activeConversation.pages.find((page) => page.url === currentPage.url && page.sentAt);
    return sentPage
      ? { ...currentPage, ...sentPage, title: currentPage.title, site: currentPage.site, status: 'read' as const }
      : { ...currentPage, status: currentPage.status === 'changed' ? 'changed' as const : 'not-read' as const };
  }, [activeConversation.pages, currentPage]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

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
      setWorkspace((current) => {
        const next = {
          ...current,
          conversations: current.conversations.map((conversation) =>
            conversation.id === conversationId ? updater(conversation) : conversation),
        };
        workspaceRef.current = next;
        return next;
      });
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

  const refreshPageMetadata = useCallback(async () => {
    const request: ExtensionRequest = { type: 'page:get-active-metadata' };
    const response = await browser.runtime.sendMessage(request).catch(() => null) as PageResponse | null;
    if (response?.page) {
      setCurrentPage({ ...response.page, status: 'not-read' });
      setPageIssue(null);
    } else {
      setPageIssue(response?.error ?? '无法连接当前网页，请刷新后重试。');
    }
  }, []);

  const consumePendingQuotes = useCallback(async () => {
    const request: ExtensionRequest = { type: 'selection:consume' };
    const response = await browser.runtime.sendMessage(request).catch(() => null) as SelectionConsumeResponse | null;
    if (!response?.quotes?.length) return;
    updateConversation(activeConversation.id, (conversation) => {
      const nextQuotes = [...conversation.draftQuotes];
      response.quotes.forEach((quote) => {
        if (!nextQuotes.some((item) => item.pageUrl === quote.pageUrl && item.text === quote.text)) nextQuotes.push(quote);
      });
      return { ...conversation, draftQuotes: nextQuotes };
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
    const onActivated = () => void refreshPageMetadata();
    const onUpdated = (_tabId: number, changeInfo: { status?: string; url?: string }) => {
      if (changeInfo.status === 'complete' || changeInfo.url) void refreshPageMetadata();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    window.addEventListener('focus', onActivated);
    void refreshPageMetadata();
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      window.removeEventListener('focus', onActivated);
    };
  }, [refreshPageMetadata]);

  useEffect(() => {
    let mounted = true;
    void loadWorkosToken()
      .then((token) => {
        if (!mounted) return;
        setWorkosToken(token);
        if (!token) {
          setConnectionIssue('请先保存 WorkOS Token，再发送第一条消息。');
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setWorkosToken('');
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

  const newConversation = () => {
    if (!workspaceHydrated) return;
    const conversation = createConversation(currentPage);
    setWorkspace((current) => ({
      ...current,
      conversations: [conversation, ...current.conversations],
      openTabs: current.openTabs.map((tab) => tab.id === current.activeOpenTabId
        ? { ...tab, conversationId: conversation.id, openedAt: Date.now() }
        : tab),
    }));
    setHistoryOpen(false);
  };

  const addTab = () => {
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
    setWorkspace((current) => {
      const closingIndex = current.openTabs.findIndex((tab) => tab.id === tabId);
      if (closingIndex < 0) return current;
      if (current.openTabs.length === 1) {
        const conversation = createConversation(currentPage);
        const replacement = createOpenTab(conversation.id);
        return {
          conversations: [conversation, ...current.conversations],
          openTabs: [replacement],
          activeOpenTabId: replacement.id,
        };
      }
      const openTabs = current.openTabs.filter((tab) => tab.id !== tabId);
      const activeOpenTabId = current.activeOpenTabId === tabId
        ? openTabs[Math.min(closingIndex, openTabs.length - 1)]!.id
        : current.activeOpenTabId;
      return { ...current, openTabs, activeOpenTabId };
    });
  };

  const selectTab = (tabId: string) => {
    setWorkspace((current) => ({ ...current, activeOpenTabId: tabId }));
    setHistoryOpen(false);
  };

  const selectHistory = (conversationId: string) => {
    setWorkspace((current) => {
      const existing = current.openTabs.find((tab) => tab.conversationId === conversationId);
      if (existing) return { ...current, activeOpenTabId: existing.id };
      return {
        ...current,
        openTabs: current.openTabs.map((tab) => tab.id === current.activeOpenTabId
          ? { ...tab, conversationId, openedAt: Date.now() }
          : tab),
      };
    });
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
    if (!workspaceHydrated || runSummary) return;
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
      draftQuotes: [],
      draftAttachments: [],
      pendingBranchContext: buildBranchContext(sourceMessages),
    };
    const canOpenNewTab = workspace.openTabs.length < MAX_OPEN_TABS;
    const tab = canOpenNewTab ? createOpenTab(conversation.id) : null;
    setWorkspace((current) => ({
      conversations: [conversation, ...current.conversations],
      openTabs: tab
        ? [...current.openTabs, tab]
        : current.openTabs.map((item) => item.id === current.activeOpenTabId
          ? { ...item, conversationId: conversation.id, openedAt: Date.now() }
          : item),
      activeOpenTabId: tab?.id ?? current.activeOpenTabId,
    }));
    setHistoryOpen(false);
  };

  const refreshPageContext = async () => {
    if (displayedPage.status === 'reading') return;
    setCurrentPage((page) => ({ ...page, status: 'reading' }));
    const request: ExtensionRequest = { type: 'page:extract-active' };
    const response = await browser.runtime.sendMessage(request).catch(() => null) as PageResponse | null;
    if (!response?.page || !('markdown' in response.page)) {
      setCurrentPage((page) => ({ ...page, status: 'not-read' }));
      setPageIssue(response?.error ?? '当前页面正文读取失败。');
      return;
    }
    const snapshot = response.page as PageSnapshot;
    pendingPageSnapshotsRef.current.set(activeConversation.id, snapshot);
    setCurrentPage({ ...snapshot, status: 'ready' });
    setPageIssue(null);
  };

  const runAgentRequest = async (request: QueuedAgentRequest, signal: AbortSignal) => {
    const token = workosToken;
    if (!token) return;
    const { conversationId, messageId, userMessage, needsPageRead } = request;
    updateMessage(conversationId, messageId, {
      status: 'running',
      stage: needsPageRead ? 'reading-page' : 'waiting-first-token',
      errorMessage: undefined,
    });
    let receivedText = false;
    let terminalError: string | null = null;
    let branchContextConsumed = false;
    const pageSnapshot = await waitForAbortable(request.pageSnapshotPromise, signal);
    if (signal.aborted) return;

    if (pageSnapshot) {
      const sentAt = Date.now();
      updateConversation(conversationId, (conversation) => {
        const existing = conversation.pages.find((page) => page.url === pageSnapshot.url);
        const sentPage = sentPageContext(pageSnapshot, sentAt, (existing?.version ?? 0) + 1);
        const pages = existing
          ? conversation.pages.map((page) => page.url === sentPage.url ? sentPage : page)
          : [...conversation.pages, sentPage];
        return {
          ...conversation,
          page: sentPage,
          pages,
          subtitle: conversation.branch
            ? `分支 ${conversation.branch.ordinal} · 刚刚`
            : `${pages.length} 个页面 · 刚刚`,
        };
      });
      setCurrentPage((page) => page.url === pageSnapshot.url
        ? sentPageContext(pageSnapshot, sentAt, 1)
        : page);
    }

    const currentConversation = workspaceRef.current.conversations.find((conversation) => conversation.id === conversationId);
    const pendingBranchContext = currentConversation?.pendingBranchContext;
    const content = buildAgentContent(userMessage.content, userMessage.references ?? [], pageSnapshot);
    const consumeBranchContext = () => {
      if (!pendingBranchContext || branchContextConsumed) return;
      branchContextConsumed = true;
      updateConversation(conversationId, (conversation) => ({ ...conversation, pendingBranchContext: undefined }));
    };

    try {
      let remoteUuid = currentConversation?.remoteUuid;
      if (!remoteUuid) {
        updateMessage(conversationId, messageId, { stage: 'creating-conversation' });
        remoteUuid = await createWorkosConversation(token, signal);
        updateConversation(conversationId, (conversation) => ({ ...conversation, remoteUuid }));
      }
      updateMessage(conversationId, messageId, { stage: 'waiting-first-token' });
      await executeWorkosStream(
        token,
        remoteUuid,
        { content: prependBranchContext(pendingBranchContext, content), attachments: [] },
        {
          onText: (text) => {
            consumeBranchContext();
            receivedText = receivedText || text.length > 0;
            updateMessage(conversationId, messageId, {
              content: text,
              stage: 'streaming',
              status: 'streaming',
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
    if (!workspaceHydrated || workosToken === null) return;
    if (!workosToken) {
      setConnectionIssue('请先保存 WorkOS Token，再发送消息。');
      setSettingsOpen(true);
      return;
    }
    const hasContent = activeConversation.draftInput.trim() || activeConversation.draftQuotes.length > 0;
    if (!hasContent) return;

    const now = Date.now();
    const conversationAtSend = activeConversation;
    const pageAtSend = displayedPage;
    const queuedSnapshot = pendingPageSnapshotsRef.current.get(conversationAtSend.id);
    const pageAlreadySent = conversationAtSend.pages.some((page) => page.url === pageAtSend.url && page.sentAt);
    const needsPageRead = Boolean(queuedSnapshot) || !pageAlreadySent;
    const userMessage: ChatMessage = {
      id: makeId('message'),
      role: 'user',
      content: activeConversation.draftInput.trim(),
      createdAt: now,
      status: 'complete',
      references: activeConversation.draftQuotes,
      pageContext: { ...pageAtSend },
    };
    const assistantMessage: ChatMessage = {
      id: makeId('message'),
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'queued',
      stage: 'queued',
      activities: [],
      pageContext: { ...pageAtSend },
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
      draftQuotes: [],
    }));

    if (queuedSnapshot) pendingPageSnapshotsRef.current.delete(conversationAtSend.id);
    const pageSnapshotPromise = (async () => {
      if (queuedSnapshot) return queuedSnapshot;
      if (!needsPageRead) return undefined;
      const request: ExtensionRequest = { type: 'page:extract-active' };
      const response = await browser.runtime.sendMessage(request).catch(() => null) as PageResponse | null;
      if (response?.page && 'markdown' in response.page) return response.page as PageSnapshot;
      setPageIssue(response?.error ?? '页面正文未能读取，本次将仅发送问题与引用。');
      return undefined;
    })();

    requestCoordinatorRef.current?.enqueue({
      conversationId: conversationAtSend.id,
      messageId: assistantMessage.id,
      userMessage,
      needsPageRead,
      pageSnapshotPromise,
    });
  };

  const retryMessage = (message: ChatMessage) => {
    if (!workspaceHydrated || !workosToken) return;
    const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
    const userMessage = [...activeConversation.messages.slice(0, messageIndex)].reverse().find((item) => item.role === 'user');
    if (!userMessage) return;
    updateMessage(activeConversation.id, message.id, {
      content: '',
      status: 'queued',
      stage: 'queued',
      errorMessage: undefined,
      activities: [],
    });
    requestCoordinatorRef.current?.enqueue({
      conversationId: activeConversation.id,
      messageId: message.id,
      userMessage,
      needsPageRead: false,
      pageSnapshotPromise: Promise.resolve(undefined),
    });
  };

  const saveToken = async (value: string) => {
    const token = await saveWorkosToken(value);
    setWorkosToken(token);
    setConnectionIssue(null);
  };

  const removeToken = async () => {
    stopAllRequests();
    await removeWorkosToken();
    setWorkosToken('');
    setConnectionIssue('Token 已从本机移除。');
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
    const conversation = createConversation(currentPage);
    const tab = createOpenTab(conversation.id);
    setWorkspace({ conversations: [conversation], openTabs: [tab], activeOpenTabId: tab.id });
    setClearDialogOpen(false);
    setSettingsOpen(false);
  };

  return (
    <div className="app-shell">
      <TopBar conversationTitle={activeConversation.title} tabCount={workspace.openTabs.length} onOpenSettings={() => setSettingsOpen(true)} />
      <SourceBar page={displayedPage} pageReadEnabled issue={pageIssue} onRefresh={() => void refreshPageContext()} />
      <MessageList
        messages={activeConversation.messages}
        onUseStarter={(value) => patchActiveConversation({ draftInput: value })}
        onRetry={retryMessage}
        onBranch={branchFromMessage}
      />
      <Composer
        tabs={workspace.openTabs}
        conversations={workspace.conversations}
        activeTabId={activeOpenTab.id}
        input={activeConversation.draftInput}
        quotes={activeConversation.draftQuotes}
        attachments={activeConversation.draftAttachments}
        activeConversationIds={activeConversationIds}
        runSummary={runSummary}
        historyOpen={historyOpen}
        tokenState={!workspaceHydrated || workosToken === null ? 'loading' : workosToken ? 'configured' : 'missing'}
        fileUploadEnabled={false}
        maxTabs={MAX_OPEN_TABS}
        onSelectTab={selectTab}
        onAddTab={addTab}
        onCloseTab={closeTab}
        onNewConversation={newConversation}
        onToggleHistory={() => setHistoryOpen((value) => !value)}
        onInputChange={(value) => patchActiveConversation({ draftInput: value })}
        onRemoveQuote={(id) => patchActiveConversation({
          draftQuotes: activeConversation.draftQuotes.filter((quote) => quote.id !== id),
        })}
        onRemoveAttachment={(id) => patchActiveConversation({
          draftAttachments: activeConversation.draftAttachments.filter((attachment) => attachment.id !== id),
        })}
        onFilesSelected={() => undefined}
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
        onClose={() => setHistoryOpen(false)}
        onSelect={selectHistory}
        onArchive={archiveConversation}
        onRestore={restoreConversation}
      />
      <SettingsDrawer
        open={settingsOpen}
        savedToken={workosToken ?? ''}
        connectionIssue={connectionIssue}
        bubbleEnabled={selectionBubbleEnabled}
        onSaveToken={saveToken}
        onRemoveToken={removeToken}
        onBubbleEnabledChange={changeSelectionBubble}
        onClose={() => setSettingsOpen(false)}
        onClearHistory={() => setClearDialogOpen(true)}
      />
      <ConfirmDialog open={clearDialogOpen} onCancel={() => setClearDialogOpen(false)} onConfirm={clearHistory} />
    </div>
  );
}
