import { normalizeSourceIdentityUrl } from '../content/pageManifest';
import { buildAgentContent, preparePageReference, WORKOS_AGENT_CAPABILITIES } from '../services/buildAgentContent';
import { buildBranchContext, buildTransportHandoffContext, prependBranchContext } from '../services/buildBranchContext';
import { findConversationSourceDelivery, markPageDelivered } from '../services/conversationSourceLedger';
import { decideCurrentPageDelivery, type CurrentPageDeliveryDecision } from '../services/contextDeliveryPolicy';
import {
  isActiveWorkosConnectionConfigured,
  type WorkosConnectionSettings,
} from '../services/workosConnection';
import type { PageSnapshot } from '../shared/extensionMessages';
import {
  hasWorkosRemoteTargetChanged,
  WORKOS_INTERNAL_V2_BASE_URL,
  WORKOS_USER_STOP_REASON,
  WorkosApiError,
  WorkosProgressDisconnected,
  WorkosRemoteStopAccepted,
  WorkosRemoteStopError,
} from '../services/workosTransport';
import { createBackgroundTransport as createWorkosTransport } from './createTransport';
import type { WorkspaceState, ChatMessage, Conversation, PageContext, RunActivity, RunActivityStatus, AssistantArtifact } from '../sidepanel/types';
import type { WorkosA2uiInterrupt, WorkosInterruptResolution, WorkosToolActivity } from '../services/workosSse';
import { restoreCollectionQuestionDraft } from '../sidepanel/collectionReferences';
import { collectionMessagePrompt, MAX_COLLECTION_PROMPT_CHARACTERS } from '../data/collectionActions';
import {
  contextAttachments,
  contextItemsFromMessage,
  contextPage,
  contextSelections,
  updatePageContextSnapshot,
} from '../sidepanel/contextItems';
import { contextLinks } from '../sidepanel/batchReading';
import { messageDecisionInteractions, settleAgentInteraction, upsertAgentInteraction } from '../sidepanel/agentDecision';

export interface SerializableAgentRequest {
  conversationId: string;
  messageId: string;
  userMessage: ChatMessage;
  needsPageRead: boolean;
  pagePreparation?: { snapshot?: PageSnapshot; error?: string };
  pageTarget?: { tabId?: number; expectedUrl: string };
}

export interface AgentRequestHost {
  getWorkspace(): WorkspaceState;
  updateConversation(conversationId: string, updater: (conversation: Conversation) => Conversation): void;
  discardQueued(conversationId: string): SerializableAgentRequest[];
  preparePage(request: SerializableAgentRequest, signal: AbortSignal): Promise<{ snapshot?: PageSnapshot; error?: string }>;
  connection: WorkosConnectionSettings;
}

function pageContextFromSnapshot(snapshot: PageSnapshot, status: PageContext['status'] = 'ready'): PageContext {
  const { markdown: _markdown, ...page } = snapshot;
  return { ...page, status };
}

function sentPageContext(snapshot: PageSnapshot, sentAt: number, version: number, remoteUuid: string): PageContext {
  return markPageDelivered({ ...pageContextFromSnapshot(snapshot, 'read'), version }, remoteUuid, sentAt);
}

function updateMessage(
  host: AgentRequestHost,
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
  }));
}

function upsertMessageActivity(host: AgentRequestHost, conversationId: string, messageId: string, activity: WorkosToolActivity) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message;
      const nextActivity: RunActivity = { ...activity, kind: activity.kind ?? 'tool' };
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
}

function upsertMessageArtifact(host: AgentRequestHost, conversationId: string, messageId: string, artifact: AssistantArtifact) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message;
      const existing = message.artifacts ?? [];
      const index = existing.findIndex((item) =>
        item.id === artifact.id || Boolean(item.url && artifact.url && item.url === artifact.url));
      return {
        ...message,
        artifacts: index < 0
          ? [...existing, artifact]
          : existing.map((item, itemIndex) => itemIndex === index
              ? { ...item, ...artifact, id: item.id }
              : item),
      };
    }),
  }));
}

function upsertMessageDecision(host: AgentRequestHost, conversationId: string, messageId: string, interrupt: WorkosA2uiInterrupt) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message;
      return {
        ...message,
        status: 'streaming',
        stage: 'waiting-user-input',
        respondedAt: message.respondedAt ?? Date.now(),
        interactions: upsertAgentInteraction(messageDecisionInteractions(message), interrupt),
        decision: undefined,
      };
    }),
  }));
}

function settleMessageDecision(host: AgentRequestHost, conversationId: string, messageId: string, resolution: WorkosInterruptResolution) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message;
      const interactions = messageDecisionInteractions(message);
      if (!interactions.some((item) => item.id === resolution.requestId && item.sessionId === resolution.sessionId)) return message;
      return {
        ...message,
        status: 'streaming',
        stage: 'streaming',
        interactions: settleAgentInteraction(interactions, resolution),
        decision: undefined,
      };
    }),
  }));
}

function settleMessageActivities(host: AgentRequestHost, conversationId: string, messageId: string, status: RunActivityStatus) {
  host.updateConversation(conversationId, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => message.id === messageId ? {
      ...message,
      activities: message.activities?.map((activity) =>
        activity.status === 'pending' || activity.status === 'running'
          ? { ...activity, status, completedAt: Date.now() }
          : activity),
    } : message),
  }));
}

function hasRunTarget(host: AgentRequestHost, request: SerializableAgentRequest) {
  const conversation = host.getWorkspace().conversations.find((item) => item.id === request.conversationId);
  return Boolean(conversation?.messages.some((item) => item.id === request.messageId));
}

export async function runAgentRequest(
  request: SerializableAgentRequest,
  signal: AbortSignal,
  host: AgentRequestHost,
) {
  const connection = host.connection;
  if (!isActiveWorkosConnectionConfigured(connection) || !hasRunTarget(host, request)) return;
  const transport = createWorkosTransport(connection);
  const { conversationId, messageId, userMessage, needsPageRead } = request;
  updateMessage(host, conversationId, messageId, {
    status: 'running',
    stopStatus: undefined,
    stage: needsPageRead ? 'reading-page' : 'waiting-first-token',
    errorMessage: undefined,
    runStartedAt: Date.now(),
    runFinishedAt: undefined,
  });

  let receivedText = false;
  let receivedArtifact = false;
  let receivedInterrupt = false;
  let terminalError: string | null = null;
  let branchContextConsumed = false;
  let pendingBranchContext: string | undefined;
  try {
    const preparation = request.pagePreparation
      ?? (needsPageRead ? await host.preparePage(request, signal) : undefined);
    if (signal.aborted) return;
    if (!hasRunTarget(host, request)) return;
    const pageSnapshot = preparation?.snapshot;
    const currentConversation = host.getWorkspace().conversations.find((conversation) => conversation.id === conversationId);
    if (!currentConversation) return;
    pendingBranchContext = currentConversation.pendingBranchContext;
    const connectionTargetChanged = hasWorkosRemoteTargetChanged(
      currentConversation.remoteUuid,
      currentConversation.remoteTransport,
      currentConversation.remoteAgentUuid,
      transport.kind,
      connection.agentUuid,
      currentConversation.remoteApiBase,
    );
    const earlierMessages = currentConversation.messages.filter(
      (message) => message.id !== userMessage.id && message.id !== messageId,
    );
    const transportHandoffContext = connectionTargetChanged && earlierMessages.length
      ? buildTransportHandoffContext(earlierMessages)
      : undefined;
    const continuationContext = pendingBranchContext ?? transportHandoffContext;
    const messageContextItems = contextItemsFromMessage(userMessage);
    const messagePageItem = contextPage(messageContextItems);
    const messagePage = messagePageItem?.page;
    const messageSelections = contextSelections(messageContextItems);
    const messageAttachments = contextAttachments(messageContextItems);
    const preparedPage = messagePage ? preparePageReference(pageSnapshot ?? messagePage) : undefined;
    const previousDelivery = currentConversation.remoteUuid && !connectionTargetChanged && preparedPage
      ? findConversationSourceDelivery(currentConversation, preparedPage, currentConversation.remoteUuid)
      : undefined;
    const pageDecision: CurrentPageDeliveryDecision = decideCurrentPageDelivery({
      included: Boolean(messagePage) && needsPageRead,
      prepared: preparedPage,
      previous: previousDelivery,
      agent: WORKOS_AGENT_CAPABILITIES,
    });
    const pageContextMode = pageDecision.mode === 'none' ? undefined : pageDecision.mode;
    const pageContextDelivery = pageDecision.mode === 'none'
      ? undefined
      : pageDecision.mode === 'reuse' ? 'reuse' as const : pageDecision.delivery;

    if (pageSnapshot) {
      updateMessage(host, conversationId, userMessage.id, {
        contextItems: updatePageContextSnapshot(messageContextItems, pageContextFromSnapshot(pageSnapshot, 'ready'), undefined, pageContextDelivery),
        pageContextMode,
        pageContextDelivery,
        pageContextIssue: undefined,
      });
    } else if (needsPageRead && messagePage) {
      const issue = preparation?.error ?? '当前页仅以链接加入，正文未能读取。';
      updateMessage(host, conversationId, userMessage.id, {
        contextItems: updatePageContextSnapshot(messageContextItems, { ...messagePage, status: 'not-read' }, issue, pageContextDelivery),
        pageContextMode,
        pageContextDelivery,
        pageContextIssue: issue,
      });
    }

    const content = userMessage.collectionMaterials && userMessage.collectionMode !== 'question'
      ? collectionMessagePrompt(userMessage)
      : buildAgentContent({
          question: userMessage.content,
          quotes: messageSelections,
          links: contextLinks(messageContextItems),
          collectionMaterials: userMessage.collectionMaterials,
          ...(preparedPage ? { page: { prepared: preparedPage, decision: pageDecision } } : {}),
        });
    const requestContent = prependBranchContext(continuationContext, content);
    if ((userMessage.collectionMaterials?.length || contextLinks(messageContextItems).length)
      && requestContent.length > MAX_COLLECTION_PROMPT_CHARACTERS) {
      const issue = `问题与引用材料合计超过 ${MAX_COLLECTION_PROMPT_CHARACTERS} 字，本次未发送。材料已放回输入区，请排除部分内容后重新提问。`;
      host.updateConversation(conversationId, (conversation) => ({
        ...conversation,
        ...restoreCollectionQuestionDraft(conversation, userMessage),
      }));
      updateMessage(host, conversationId, messageId, {
        status: 'failed', stage: undefined, collectionSend: undefined, errorMessage: issue, runFinishedAt: Date.now(),
      });
      settleMessageActivities(host, conversationId, messageId, 'failed');
      return;
    }
    const consumeBranchContext = () => {
      if (!pendingBranchContext || branchContextConsumed) return;
      branchContextConsumed = true;
      host.updateConversation(conversationId, (conversation) => ({ ...conversation, pendingBranchContext: undefined }));
    };

    let remoteUuid = connectionTargetChanged ? undefined : currentConversation.remoteUuid;
    if (!remoteUuid) {
      updateMessage(host, conversationId, messageId, { stage: 'creating-conversation' });
      remoteUuid = await transport.createConversation(signal);
      if (signal.aborted || !hasRunTarget(host, request)) return;
      host.updateConversation(conversationId, (conversation) => ({
        ...conversation,
        remoteUuid,
        remoteTransport: transport.kind,
        remoteAgentUuid: connection.agentUuid,
        remoteApiBase: transport.kind === 'internal-v2' ? WORKOS_INTERNAL_V2_BASE_URL : undefined,
      }));
    }
    updateMessage(host, conversationId, messageId, { stage: 'waiting-first-token' });
    await transport.executeStream(remoteUuid, {
      content: requestContent,
      ...(transport.kind === 'internal-v2' && currentConversation.remoteUuid && !connectionTargetChanged ? {
        streamContext: { previousToolCallIds: [...new Set(currentConversation.messages
          .slice(0, currentConversation.messages.findIndex((message) => message.id === messageId))
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => (message.activities ?? []).map((activity) => activity.id)))] },
      } : {}),
      attachments: messageAttachments.filter((attachment) => attachment.status === 'ready' && attachment.url)
        .map((attachment) => ({ url: attachment.url!, filename: attachment.filename, ...(attachment.mime ? { mime: attachment.mime } : {}) })),
    }, {
      onText: (text) => {
        if (signal.aborted || !hasRunTarget(host, request)) return;
        consumeBranchContext();
        const respondedAt = !receivedText && !receivedArtifact && text.length > 0 ? Date.now() : undefined;
        receivedText ||= text.length > 0;
        updateMessage(host, conversationId, messageId, {
          content: text, stage: 'streaming', status: 'streaming', ...(respondedAt ? { respondedAt } : {}),
        });
      },
      onArtifact: (artifact) => {
        if (signal.aborted || !hasRunTarget(host, request)) return;
        consumeBranchContext();
        const respondedAt = !receivedText && !receivedArtifact ? Date.now() : undefined;
        receivedArtifact = true;
        upsertMessageArtifact(host, conversationId, messageId, artifact);
        updateMessage(host, conversationId, messageId, { stage: 'streaming', status: 'streaming', ...(respondedAt ? { respondedAt } : {}) });
      },
      onActivity: (activity) => {
        if (signal.aborted || !hasRunTarget(host, request)) return;
        consumeBranchContext();
        upsertMessageActivity(host, conversationId, messageId, activity);
      },
      onInterrupt: (interrupt) => {
        if (signal.aborted || !hasRunTarget(host, request)) return;
        consumeBranchContext();
        receivedInterrupt = true;
        upsertMessageDecision(host, conversationId, messageId, interrupt);
      },
      onInterruptResolution: (resolution) => {
        if (!signal.aborted && hasRunTarget(host, request)) settleMessageDecision(host, conversationId, messageId, resolution);
      },
      onError: (message) => { if (!signal.aborted) terminalError = message; },
    }, signal);
    if (signal.aborted || !hasRunTarget(host, request)) return;
    consumeBranchContext();
    if (terminalError) throw new WorkosApiError(terminalError);
    if (!receivedText && !receivedArtifact && !receivedInterrupt) throw new WorkosApiError('Agent 已结束运行，但没有返回可显示的内容。');

    if (preparedPage && pageDecision.mode !== 'none' && messagePage) {
      const deliveredAt = Date.now();
      host.updateConversation(conversationId, (conversation) => {
        const existing = conversation.pages
          .filter((page) => (page.sourceId && page.sourceId === preparedPage.source.source_id)
            || Boolean(preparedPage.source.url && normalizeSourceIdentityUrl(page.url) === normalizeSourceIdentityUrl(preparedPage.source.url)))
          .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))[0];
        const basePage = pageSnapshot
          ? sentPageContext(pageSnapshot, deliveredAt, pageDecision.mode === 'reuse' ? existing?.version ?? 1 : (existing?.version ?? 0) + 1, remoteUuid!)
          : markPageDelivered({
              ...messagePage,
              sourceId: preparedPage.source.source_id,
              manifest: preparedPage.manifest,
              status: 'read' as const,
              version: pageDecision.mode === 'reuse' ? existing?.version ?? 1 : (existing?.version ?? 0) + 1,
            }, remoteUuid!, deliveredAt);
        const deliveredPage = { ...basePage, sourceId: preparedPage.source.source_id, manifest: preparedPage.manifest };
        const pages = existing
          ? conversation.pages.map((page) => page === existing
              ? pageDecision.mode === 'reuse'
                ? { ...page, sourceId: deliveredPage.sourceId, manifest: deliveredPage.manifest, deliveredRemoteUuid: remoteUuid }
                : deliveredPage
              : page)
          : [...conversation.pages, deliveredPage];
        return {
          ...conversation,
          page: deliveredPage,
          pages,
          subtitle: conversation.branch ? `分支 ${conversation.branch.ordinal} · 刚刚` : `${pages.length} 个页面 · 刚刚`,
        };
      });
      updateMessage(host, conversationId, userMessage.id, {
        contextItems: updatePageContextSnapshot(messageContextItems,
          { ...(pageSnapshot ? pageContextFromSnapshot(pageSnapshot, 'read') : messagePage), sentAt: deliveredAt, deliveredRemoteUuid: remoteUuid },
          pageSnapshot ? undefined : preparation?.error, pageContextDelivery),
        pageContextMode,
        pageContextDelivery,
        pageContextIssue: pageSnapshot ? undefined : preparation?.error,
      });
    }
    updateMessage(host, conversationId, messageId, { status: 'complete', stage: undefined, errorMessage: undefined, runFinishedAt: Date.now() });
    settleMessageActivities(host, conversationId, messageId, 'completed');
  } catch (error) {
    if (error instanceof WorkosProgressDisconnected && !signal.aborted) {
      const pending = host.discardQueued(conversationId);
      updateMessage(host, conversationId, messageId, {
        status: 'stopped', stage: undefined, remoteRunUnconfirmed: {
          conversationUuid: error.conversationUuid, runId: error.runId, transport: 'internal-v2',
          agentUuid: host.connection.agentUuid, apiBase: WORKOS_INTERNAL_V2_BASE_URL, disconnectedAt: Date.now(),
        },
        errorMessage: '进度连接已断开，WorkOS 任务状态未确认，任务可能仍在运行。请在 WorkOS 查看进度；已收到的内容可能不完整。本会话暂不继续发送，新问题可另开对话。',
        runFinishedAt: Date.now(),
      });
      host.updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === messageId ? {
        ...m, activities: m.activities?.map((a) => ['pending', 'running'].includes(a.status)
          ? { ...a, status: 'stopped', progressUnconfirmed: true, completedAt: undefined } : a),
      } : m) }));
      pending.forEach((queued) => updateMessage(host, conversationId, queued.messageId, {
        status: 'stopped', stage: undefined, stopStatus: 'local-only',
        errorMessage: '上一项 WorkOS 任务状态未确认，此排队问题未发送。', runFinishedAt: Date.now(),
      }));
      return;
    }
    if (error instanceof WorkosRemoteStopAccepted) {
      updateMessage(host, conversationId, messageId, { stopStatus: 'accepted', errorMessage: undefined });
      return;
    }
    if (error instanceof WorkosRemoteStopError) {
      const pending = host.discardQueued(conversationId);
      const detail = `已停止接收，无法确认 WorkOS 是否暂停。${error.message}${pending.length ? ' 后续排队问题未发送，请确认 WorkOS 状态后再提问。' : ''}`;
      updateMessage(host, conversationId, messageId, { stopStatus: 'failed', errorMessage: detail });
      pending.forEach((queued) => updateMessage(host, conversationId, queued.messageId, {
        status: 'stopped', stage: undefined, stopStatus: 'local-only',
        errorMessage: 'WorkOS 暂停未确认，此排队问题未发送。', runFinishedAt: Date.now(),
      }));
      return;
    }
    if (error instanceof DOMException && error.name === 'AbortError' || signal.aborted) {
      if (signal.reason === WORKOS_USER_STOP_REASON && transport.kind === 'internal-v2') {
        updateMessage(host, conversationId, messageId, {
          stopStatus: 'local-only', errorMessage: '已停止准备，当前问题尚未提交给 WorkOS。',
        });
      }
      return;
    }
    const message = error instanceof Error ? error.message : 'Agent 请求失败，请稍后重试。';
    updateMessage(host, conversationId, messageId, {
      status: 'failed', stage: undefined, errorMessage: message, runFinishedAt: Date.now(),
    });
    settleMessageActivities(host, conversationId, messageId, 'failed');
  }
}
