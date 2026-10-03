import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { collectionMessagePrompt } from '../../data/collectionActions';
import { buildAnswerContextMap, type AnswerContextSource } from '../answerContext';
import { contextAttachments, contextItemsFromMessage, contextPage, contextSelections } from '../contextItems';
import type { ChatMessage, DraftAttachment, QuoteReference, RunActivity, RunActivityStatus } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
import { isNearMessageBottom, messageDistanceFromBottom } from '../messageScroll';
import { findSearchTextMatches } from '../../search/searchTextMatches';
import {
  MIN_CONVERSATION_RAIL_TURNS,
  activeConversationTurnId,
  compactConversationTurnLabel,
} from '../conversationRail';
import { attachmentFormatLabel, getFileType, isImageFile, uploadChannelLabel } from '../fileTypes';
import { STARTER_ACTIONS } from '../starterActions';
import { parsePageOverview } from '../pageOverview';
import { messageDecisionInteractions } from '../agentDecision';
import { deriveAgentRunSummary, deriveMessageRunNote } from '../agentQueue';
import { collectionDeliveryState } from '../collectionConversation';
import { formatRunDuration } from '../runDuration';
import { canTranslateLocally, translateLocally } from '../localTranslator';
import { DoubleCtrlShortcut } from '../doubleCtrlShortcut';

import { translationContextAroundSelection, type TranslationContext } from '../translationContext';
import { FileTypeIcon } from './FileTypeIcon';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';
import { PageOverviewCard } from './PageOverviewCard';
import { YemaiMark } from './YemaiMark';
import { AnswerContextTrace } from './AnswerContextTrace';
import { AssistantArtifacts } from './AssistantArtifacts';
import { ConversationPreviewRail, type ConversationPreviewRailItem } from './ConversationPreviewRail';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ImagePreview } from './ImagePreview';
import { AgentDecisionCard, AgentDecisionReceipt } from './AgentDecisionCard';
import type { WorkosInterruptAnswers } from '../../services/workosTransport';

const AgentRunStatus = lazy(() => import('./AgentRunStatus')
  .then((module) => ({ default: module.AgentRunStatus })));
const SubagentDetailsDialog = lazy(() => import('./SubagentDetailsDialog')
  .then((module) => ({ default: module.SubagentDetailsDialog })));

interface MessageListProps {
  messages: ChatMessage[];
  pendingCollectionCount?: number;
  savedMessageIds: ReadonlySet<string>;
  navigationTarget?: {
    messageId: string;
    query: string;
    matchedTerms: string[];
    requestId: number;
  };
  branchOrigin?: {
    title: string;
    timestamp?: number;
    available: boolean;
    unavailableReason?: string;
  };
  branchUnavailableReason?: string;
  onUseStarter: (value: string) => void;
  onEditUserMessage: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  onBranch: (message: ChatMessage) => void;
  onToggleReadingCard: (
    message: ChatMessage,
    contextSources: AnswerContextSource[],
    origin?: ReadingCardFeedbackOrigin,
  ) => void;
  onCollectAssistantExcerpt: (
    message: ChatMessage,
    text: string,
    contextSources: AnswerContextSource[],
    origin?: ReadingCardFeedbackOrigin,
  ) => void;
  onOpenBranchOrigin: () => void;
  onAddAssistantQuote: (quote: QuoteReference) => void;
  onResolveDecision: (
    message: ChatMessage,
    decisionId: string,
    action: 'reply' | 'reject',
    answers?: WorkosInterruptAnswers,
  ) => void;
}

export interface ReadingCardFeedbackOrigin {
  x: number;
  y: number;
}

const MAX_ASSISTANT_QUOTE_LENGTH = 4_000;

interface AssistantSelectionAction {
  messageId: string;
  text: string;
  context: TranslationContext | null;
  left: number;
  top: number;
}

interface SelectionTranslation {
  source: string;
  context: TranslationContext | null;
  result: string;
  sentenceResult: string;
  status: 'loading' | 'ready' | 'error';
  sentenceStatus: 'idle' | 'loading' | 'ready' | 'error';
  progress: number | null;
  left: number;
  top: number;
}

function selectionInsideMessage(selection: Selection, container: HTMLElement) {
  if (!selection.rangeCount || selection.isCollapsed) return false;
  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8v4h3l3.5 2.7V5.3L6 8H3Z" />
      <path d="M12.5 7a4 4 0 0 1 0 6" />
      <path d="M14.5 4.8a7 7 0 0 1 0 10.4" />
    </svg>
  );
}

function selectedSentence(selection: Selection, selectedText: string): TranslationContext | null {
  const range = selection.getRangeAt(0);
  const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const block = parent?.closest('p, li, blockquote, pre');
  if (!block || !block.contains(range.endContainer)) return null;
  const content = block.textContent ?? '';
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  return translationContextAroundSelection(content, offset, selectedText, range.toString().length, block.matches('pre'));
}

function MessageTime({
  timestamp,
  label,
  className = '',
}: {
  timestamp: number;
  label: string;
  className?: string;
}) {
  const formatted = formatMessageTimestamp(timestamp);
  return (
    <time
      className={`message-time${className ? ` ${className}` : ''}`}
      dateTime={formatted.dateTime}
      title={formatted.fullLabel}
      aria-label={`${label}${formatted.fullLabel}`}
    >
      {formatted.label}
    </time>
  );
}

const ACTIVITY_STATUS_COPY: Record<RunActivityStatus, string> = {
  pending: '等待运行',
  running: '正在运行',
  completed: '已完成',
  failed: '运行失败',
  stopped: '已停止',
};

function formatDuration(activity: RunActivity) {
  if (!activity.startedAt || !activity.completedAt) return null;
  const duration = Math.max(0, activity.completedAt - activity.startedAt);
  if (duration < 1000) return `${Math.round(duration)} ms`;
  return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)} 秒`;
}

function ActivityStatusIcon({ status }: { status: RunActivityStatus }) {
  if (status === 'running') return <span className="activity-spinner" aria-hidden="true" />;
  if (status === 'pending') return <span className="activity-pending-dot" aria-hidden="true" />;
  if (status === 'completed') return <KoboyoIcon name="solid-checkmark" size={12} />;
  if (status === 'failed') return <KoboyoIcon name="cross" size={12} />;
  return <KoboyoIcon name="stop-generating-square" size={12} />;
}

function RunActivityPanel({ activities }: { activities: RunActivity[] }) {
  const [expansionChoice, setExpansionChoice] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visibleActivities = activities.filter((activity) => activity.title.trim().toLowerCase() !== 'question');
  const children = visibleActivities.filter((activity) => activity.kind === 'subagent');
  const expanded = expansionChoice ?? children.length > 0;
  const selectedIndex = children.findIndex((activity) => activity.id === selectedId);
  const selected = children[selectedIndex];
  if (visibleActivities.length === 0) return null;
  const activeCount = visibleActivities.filter((activity) => activity.status === 'pending' || activity.status === 'running').length;
  const failedCount = visibleActivities.filter((activity) => activity.status === 'failed').length;
  const objectLabel = children.length === visibleActivities.length ? '子任务' : '工具';
  const summary = activeCount > 0
    ? `正在运行 ${visibleActivities.length} 个${objectLabel}`
    : failedCount > 0
      ? `${visibleActivities.length} 个${objectLabel}中有 ${failedCount} 个失败`
      : `运行了 ${visibleActivities.length} 个${objectLabel}`;

  return (
    <section className="run-activity" aria-label="Agent 运行过程">
      <button
        className="run-activity-toggle pressable"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpansionChoice(!expanded)}
      >
        <span className={`disclosure-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
        <KoboyoIcon name={children.length ? 'bot' : 'file'} size={13} />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="run-activity-list">
          {visibleActivities.map((activity) => {
            const duration = formatDuration(activity);
            if (activity.kind === 'subagent') return (
              <button type="button" key={activity.id} className={`subagent-card is-${activity.status}`}
                aria-label={`查看子任务：${activity.title}`} aria-haspopup="dialog" onClick={() => setSelectedId(activity.id)}>
                <span className="subagent-card-icon"><KoboyoIcon name="bot" size={17} /></span>
                <span className="subagent-card-text"><strong>{activity.title}</strong>
                  <small>{activity.subagent?.agentType ?? '子智能体'} · {ACTIVITY_STATUS_COPY[activity.status]}{duration ? ` · ${duration}` : ''}</small>
                </span>
                <span className="activity-status-icon"><ActivityStatusIcon status={activity.status} /></span>
                <span aria-hidden="true" className="subagent-card-chevron">›</span>
              </button>
            );
            return (
              <div className={`run-activity-item is-${activity.status}`} key={activity.id}>
                <span className="activity-status-icon" aria-label={ACTIVITY_STATUS_COPY[activity.status]}>
                  <ActivityStatusIcon status={activity.status} />
                </span>
                <span className="activity-title">{activity.title}</span>
                {duration && <span className="activity-duration">{duration}</span>}
              </div>
            );
          })}
        </div>
      )}
      {selected && <Suspense fallback={null}><SubagentDetailsDialog activity={selected} index={selectedIndex} count={children.length}
        onPrevious={() => setSelectedId(children[selectedIndex - 1]?.id ?? selectedId)}
        onNext={() => setSelectedId(children[selectedIndex + 1]?.id ?? selectedId)} onClose={() => setSelectedId(null)} />
      </Suspense>}
    </section>
  );
}

function AssistantMessage({
  message,
  contextSources,
  onUseFollowUp,
  onRetry,
  onBranch,
  saved,
  onToggleReadingCard,
  onResolveDecision,
  branchUnavailableReason,
}: {
  message: ChatMessage;
  contextSources: AnswerContextSource[];
  onUseFollowUp: (question: string) => void;
  onRetry: () => void;
  onBranch: () => void;
  saved: boolean;
  onToggleReadingCard: (origin?: ReadingCardFeedbackOrigin) => void;
  onResolveDecision: (
    decisionId: string,
    action: 'reply' | 'reject',
    answers?: WorkosInterruptAnswers,
  ) => void;
  branchUnavailableReason?: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [bookmarkConfirmed, setBookmarkConfirmed] = useState(false);
  const bookmarkConfirmationTimerRef = useRef<number | null>(null);
  const runNote = deriveMessageRunNote(message);
  const runSummary = useMemo(() => deriveAgentRunSummary([message]), [message]);
  const runDuration = formatRunDuration(message.runStartedAt, message.runFinishedAt);
  const pageOverview = useMemo(() => (
    message.presentation === 'page-overview'
    && message.status !== 'streaming'
    && message.content
      ? parsePageOverview(message.content)
      : null
  ), [message.content, message.presentation, message.status]);
  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };
  const hasArtifacts = Boolean(message.artifacts?.length);
  const interactions = messageDecisionInteractions(message);
  const resolvedInteractions = interactions.filter((interaction) =>
    interaction.status === 'replied' || interaction.status === 'rejected');
  const activeInteraction = [...interactions].reverse().find((interaction) =>
    interaction.status !== 'replied' && interaction.status !== 'rejected');
  const uncertainCollectionSend = Boolean(message.collectionSend && collectionDeliveryState(message) === 'uncertain');
  const interruptedCollectionReply = Boolean(message.collectionSend
    && collectionDeliveryState(message) === 'received'
    && (message.status === 'failed' || message.status === 'stopped'));
  const actionsAvailable = Boolean(message.content || hasArtifacts) && message.status !== 'streaming' && !uncertainCollectionSend;
  const footerAvailable = actionsAvailable || (message.status === 'failed' && !uncertainCollectionSend) || Boolean(runDuration);

  useEffect(() => () => {
    if (bookmarkConfirmationTimerRef.current !== null) {
      window.clearTimeout(bookmarkConfirmationTimerRef.current);
    }
  }, []);

  const toggleReadingCard = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const origin = event.detail === 0
      ? undefined
      : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    if (!saved) {
      if (bookmarkConfirmationTimerRef.current !== null) {
        window.clearTimeout(bookmarkConfirmationTimerRef.current);
      }
      setBookmarkConfirmed(true);
      bookmarkConfirmationTimerRef.current = window.setTimeout(() => {
        setBookmarkConfirmed(false);
        bookmarkConfirmationTimerRef.current = null;
      }, 220);
    } else {
      setBookmarkConfirmed(false);
    }
    onToggleReadingCard(origin);
  };

  return (
    <article className="message message--assistant" data-message-id={message.id} data-assistant-message-id={message.id}>
      <div className="assistant-rail" aria-hidden="true">
        <span className="assistant-mark">
          <YemaiMark />
        </span>
        <span className="assistant-line" />
      </div>
      <div className="message-content">
        {message.activities && message.activities.length > 0 && <RunActivityPanel activities={message.activities} />}
        {resolvedInteractions.length > 0 && (
          <div className="agent-decision-history" aria-label="决策记录">
            {resolvedInteractions.map((interaction) => (
              <AgentDecisionReceipt decision={interaction} key={interaction.id} />
            ))}
          </div>
        )}
        {activeInteraction && (
          <AgentDecisionCard
            key={activeInteraction.id}
            decision={activeInteraction}
            active={message.status === 'running' || message.status === 'streaming'}
            onReply={(answers) => onResolveDecision(activeInteraction.id, 'reply', answers)}
            onReject={() => onResolveDecision(activeInteraction.id, 'reject')}
          />
        )}
        <div
          className={`markdown-body${pageOverview ? ' markdown-body--page-overview' : ''}`}
          data-assistant-selectable="true"
        >
          <Suspense fallback={runSummary ? <div className="agent-run-status" role="status">{runSummary.label}</div> : null}>
            <AgentRunStatus summary={runSummary} startedAt={message.runStartedAt} />
          </Suspense>
          {!message.content && interactions.length === 0 && runNote && runNote.kind !== 'running' && !uncertainCollectionSend && (
            <div className={`message-run-note message-run-note--${runNote.kind}`} role="status">
              {runNote.copy}
            </div>
          )}
          {uncertainCollectionSend && (
            <div className="message-run-note message-run-note--failed" role="status">
              尚未收到 WorkOS 的回答，无法确认这次提问是否提交成功。请先在 WorkOS 中检查；页脉已保留会话和原选择，不会自动重发。
            </div>
          )}
          {interruptedCollectionReply && (
            <div className="message-run-note message-run-note--stopped" role="status">
              {message.status === 'stopped'
                ? '已停止生成，以下是已收到的内容。'
                : '回答已收到，但生成未正常结束；内容可能不完整。'}
            </div>
          )}
          {pageOverview ? (
            <PageOverviewCard overview={pageOverview} onUseFollowUp={onUseFollowUp} />
          ) : (
            <AssistantMarkdown content={message.content} streaming={message.status === 'streaming'} />
          )}
          {message.status === 'streaming' && message.stage !== 'waiting-user-input' && message.content && (
            <span className="stream-cursor" aria-label="正在生成" />
          )}
        </div>
        {hasArtifacts && <AssistantArtifacts artifacts={message.artifacts!} />}
        {Boolean(message.content || hasArtifacts) && message.status !== 'streaming' && (
          <AnswerContextTrace sources={contextSources} />
        )}
        {footerAvailable && (
          <div className="assistant-footer" aria-label="回答操作">
            {message.status === 'failed' && !message.collectionSend && (
              <IconTooltipButton
                className="assistant-action pressable"
                type="button"
                onClick={onRetry}
                aria-label={message.content ? '重试回答' : '重新发送'}
                tooltip={message.content ? '重新生成' : '重新发送'}
              >
                <KoboyoIcon name="cycle" size={14} />
              </IconTooltipButton>
            )}
            {actionsAvailable && (
              <>
                <IconTooltipButton
                  className={`assistant-action assistant-bookmark-action pressable${saved ? ' is-saved' : ''}${bookmarkConfirmed ? ' did-save' : ''}`}
                  type="button"
                  onClick={toggleReadingCard}
                  aria-label={saved ? '取消收藏回答' : '收藏完整回答'}
                  aria-pressed={saved}
                  tooltip={saved ? '已收藏，点击取消' : '收藏回答'}
                >
                  <svg className="assistant-bookmark-glyph" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      className="assistant-bookmark-glyph__fill"
                      d="M6 3.25h8A1.75 1.75 0 0 1 15.75 5v11.72a.75.75 0 0 1-1.14.64L10 14.58l-4.61 2.78a.75.75 0 0 1-1.14-.64V5A1.75 1.75 0 0 1 6 3.25Z"
                    />
                    <path
                      d="M6 3.25h8A1.75 1.75 0 0 1 15.75 5v11.72a.75.75 0 0 1-1.14.64L10 14.58l-4.61 2.78a.75.75 0 0 1-1.14-.64V5A1.75 1.75 0 0 1 6 3.25Z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinejoin="round"
                      strokeWidth="1.6"
                    />
                  </svg>
                </IconTooltipButton>
                {message.content && (
                  <IconTooltipButton
                    className="assistant-action pressable"
                    type="button"
                    onClick={copyMarkdown}
                    aria-label={copyState === 'copied' ? '已复制 Markdown' : copyState === 'failed' ? '复制失败' : '复制 Markdown'}
                    tooltip={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制回答'}
                  >
                    <KoboyoIcon name={copyState === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
                  </IconTooltipButton>
                )}
                <IconTooltipButton
                  className="assistant-action pressable"
                  type="button"
                  onClick={onBranch}
                  disabled={Boolean(branchUnavailableReason)}
                  aria-label={branchUnavailableReason ? `无法创建分支：${branchUnavailableReason}` : '从这里分支'}
                  tooltip={branchUnavailableReason ?? '从这里分支'}
                >
                  <KoboyoIcon name="fork" size={14} />
                </IconTooltipButton>
              </>
            )}
            {(message.respondedAt || message.content) && (
              <MessageTime
                timestamp={message.respondedAt ?? message.createdAt}
                label="Agent 回答于"
                className="message-time--assistant"
              />
            )}
            {runDuration && (
              <span className="message-time message-run-duration" aria-label={`本轮${message.status === 'complete' ? '用时' : '已运行'} ${runDuration}`}>
                {message.status === 'complete' ? '用时' : '已运行'} {runDuration}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

interface HoveredAttachment {
  attachment: DraftAttachment;
  anchor: DOMRect;
  placement: 'above' | 'below';
}

function imagePreviewStyle(preview: HoveredAttachment): CSSProperties & { '--image-preview-max-height': string } {
  const gutter = 12;
  const gap = 8;
  const width = Math.min(380, window.innerWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(preview.anchor.left, window.innerWidth - width - gutter));
  const availableHeight = preview.placement === 'below'
    ? window.innerHeight - preview.anchor.bottom - gap - gutter
    : preview.anchor.top - gap - gutter;
  const imageMaxHeight = Math.max(80, Math.min(availableHeight - 18, window.innerHeight * 0.7, 540));
  return {
    width,
    left,
    maxHeight: Math.max(98, availableHeight),
    '--image-preview-max-height': `${imageMaxHeight}px`,
    ...(preview.placement === 'below'
      ? { top: preview.anchor.bottom + gap }
      : { bottom: window.innerHeight - preview.anchor.top + gap }),
  };
}

function fileDetailStyle(preview: HoveredAttachment): CSSProperties {
  const gutter = 12;
  const gap = 8;
  const width = Math.min(310, window.innerWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(preview.anchor.left, window.innerWidth - width - gutter));
  return {
    width,
    left,
    ...(preview.placement === 'below'
      ? { top: preview.anchor.bottom + gap }
      : { bottom: window.innerHeight - preview.anchor.top + gap }),
  };
}

function SentAttachments({ attachments }: { attachments: DraftAttachment[] }) {
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [hoveredImage, setHoveredImage] = useState<HoveredAttachment | null>(null);
  const [hoveredFile, setHoveredFile] = useState<HoveredAttachment | null>(null);
  const [activeImage, setActiveImage] = useState<DraftAttachment | null>(null);
  const showPreviewTimerRef = useRef<number | null>(null);
  const hidePreviewTimerRef = useRef<number | null>(null);
  const suppressFocusPreviewRef = useRef(false);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const imageAttachments = attachments.filter((attachment) =>
    isImageFile(attachment.filename, attachment.mime)
    && Boolean(attachment.previewUrl ?? attachment.url)
    && !failedImageIds.has(attachment.id));
  const fileAttachments = attachments.filter((attachment) => !imageAttachments.includes(attachment));

  const clearPreviewTimers = () => {
    if (showPreviewTimerRef.current !== null) window.clearTimeout(showPreviewTimerRef.current);
    if (hidePreviewTimerRef.current !== null) window.clearTimeout(hidePreviewTimerRef.current);
    showPreviewTimerRef.current = null;
    hidePreviewTimerRef.current = null;
  };

  const closeHoverPreview = () => {
    if (showPreviewTimerRef.current !== null) window.clearTimeout(showPreviewTimerRef.current);
    showPreviewTimerRef.current = null;
    hidePreviewTimerRef.current = window.setTimeout(() => {
      setHoveredImage(null);
      setHoveredFile(null);
      hidePreviewTimerRef.current = null;
    }, 120);
  };

  const keepHoverPreviewOpen = () => {
    if (hidePreviewTimerRef.current !== null) window.clearTimeout(hidePreviewTimerRef.current);
    hidePreviewTimerRef.current = null;
  };

  const openHoverPreview = (
    attachment: DraftAttachment,
    trigger: HTMLButtonElement,
    kind: 'image' | 'file',
    immediate = false,
  ) => {
    clearPreviewTimers();
    const anchor = trigger.getBoundingClientRect();
    const availableBelow = window.innerHeight - anchor.bottom;
    const availableAbove = anchor.top;
    const placement = availableBelow >= Math.min(360, window.innerHeight * 0.58) || availableBelow >= availableAbove
      ? 'below' as const
      : 'above' as const;
    const show = () => {
      const preview = { attachment, anchor, placement };
      if (kind === 'image') {
        setHoveredFile(null);
        setHoveredImage(preview);
      } else {
        setHoveredImage(null);
        setHoveredFile(preview);
      }
      showPreviewTimerRef.current = null;
    };
    if (immediate || hoveredImage || hoveredFile) show();
    else showPreviewTimerRef.current = window.setTimeout(show, 220);
  };

  const closeImage = () => {
    setActiveImage(null);
    window.requestAnimationFrame(() => {
      suppressFocusPreviewRef.current = true;
      activeTriggerRef.current?.focus();
      window.requestAnimationFrame(() => {
        suppressFocusPreviewRef.current = false;
      });
    });
  };

  const openImage = (attachment: DraftAttachment, trigger: HTMLButtonElement) => {
    clearPreviewTimers();
    setHoveredImage(null);
    setHoveredFile(null);
    activeTriggerRef.current = trigger;
    setActiveImage(attachment);
  };

  useEffect(() => () => clearPreviewTimers(), []);

  useEffect(() => {
    if (!hoveredImage && !hoveredFile) return;
    const closeForViewportChange = () => {
      clearPreviewTimers();
      setHoveredImage(null);
      setHoveredFile(null);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeForViewportChange();
    };
    window.addEventListener('resize', closeForViewportChange);
    window.addEventListener('scroll', closeForViewportChange, true);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('resize', closeForViewportChange);
      window.removeEventListener('scroll', closeForViewportChange, true);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [hoveredFile, hoveredImage]);

  const markImageFailed = (attachment: DraftAttachment) => {
    setFailedImageIds((current) => new Set(current).add(attachment.id));
    if (hoveredImage?.attachment.id === attachment.id) setHoveredImage(null);
    if (activeImage?.id === attachment.id) closeImage();
  };

  return (
    <>
      {imageAttachments.length > 0 && (
        <span className="sent-inline-attachments">
          {imageAttachments.map((attachment) => (
            <button
              className="sent-attachment-token sent-attachment-token--image pressable"
              type="button"
              key={attachment.id}
              aria-label={`图片附件：${attachment.filename}，悬浮预览，点击查看大图`}
              onMouseEnter={(event) => openHoverPreview(attachment, event.currentTarget, 'image')}
              onMouseLeave={closeHoverPreview}
              onFocus={(event) => {
                if (!suppressFocusPreviewRef.current) openHoverPreview(attachment, event.currentTarget, 'image', true);
              }}
              onBlur={closeHoverPreview}
              onClick={(event) => {
                openImage(attachment, event.currentTarget);
              }}
            >
              <img
                src={attachment.previewUrl ?? attachment.url}
                alt={attachment.filename}
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => markImageFailed(attachment)}
              />
              <span>{attachment.filename}</span>
            </button>
          ))}
        </span>
      )}
      {fileAttachments.length > 0 && (
        <span className="sent-inline-attachments">
          {fileAttachments.map((attachment) => (
            <button
              className="sent-attachment-token sent-attachment-token--file"
              type="button"
              key={attachment.id}
              aria-label={`文件附件：${attachment.filename}，悬浮查看详情`}
              onMouseEnter={(event) => openHoverPreview(attachment, event.currentTarget, 'file')}
              onMouseLeave={closeHoverPreview}
              onFocus={(event) => openHoverPreview(attachment, event.currentTarget, 'file', true)}
              onBlur={closeHoverPreview}
            >
              <FileTypeIcon filename={attachment.filename} mime={attachment.mime} variant="token" />
              <span>{attachment.filename}</span>
            </button>
          ))}
        </span>
      )}
      {hoveredImage && createPortal(
        <div
          className={`image-hover-preview is-${hoveredImage.placement}`}
          style={imagePreviewStyle(hoveredImage)}
          aria-hidden="true"
          onMouseEnter={keepHoverPreviewOpen}
          onMouseLeave={closeHoverPreview}
        >
          <img
            src={hoveredImage.attachment.previewUrl ?? hoveredImage.attachment.url}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => markImageFailed(hoveredImage.attachment)}
          />
        </div>,
        document.body,
      )}
      {hoveredFile && createPortal(
        <div
          className={`file-hover-detail is-${hoveredFile.placement}`}
          style={fileDetailStyle(hoveredFile)}
          role="tooltip"
          onMouseEnter={keepHoverPreviewOpen}
          onMouseLeave={closeHoverPreview}
        >
          <FileTypeIcon
            filename={hoveredFile.attachment.filename}
            mime={hoveredFile.attachment.mime}
            variant="draft"
          />
          <span>
            <strong>{hoveredFile.attachment.filename}</strong>
            <small>
              {getFileType(hoveredFile.attachment.filename, hoveredFile.attachment.mime).description}
              {' · '}{attachmentFormatLabel(hoveredFile.attachment.filename, hoveredFile.attachment.mime)}
              {' · '}{hoveredFile.attachment.sizeLabel}
            </small>
            <em>已通过{uploadChannelLabel(hoveredFile.attachment.uploadTransport)}上传</em>
          </span>
        </div>,
        document.body,
      )}
      {activeImage && (activeImage.previewUrl ?? activeImage.url) && (
        <ImagePreview
          src={(activeImage.previewUrl ?? activeImage.url)!}
          filename={activeImage.filename}
          downloadUrl={activeImage.url ?? activeImage.previewUrl}
          onClose={closeImage}
        />
      )}
    </>
  );
}

function UserMessage({ message, onEdit }: { message: ChatMessage; onEdit: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const messageContextItems = contextItemsFromMessage(message);
  const pageItem = contextPage(messageContextItems);
  const references = contextSelections(messageContextItems);
  const attachments = contextAttachments(messageContextItems);
  const copyQuestion = async () => {
    try {
      await navigator.clipboard.writeText(collectionMessagePrompt(message));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };
  return (
    <article className="message message--user" data-message-id={message.id} data-user-message-id={message.id}>
      <div className="user-message-stack">
        {pageItem && (
          <div
            className={`sent-page-context sent-page-context--${pageItem.page.status}${pageItem.issue ? ' has-issue' : ''}`}
            title={pageItem.issue ?? pageItem.page.url}
          >
            <PageFavicon
              url={pageItem.page.url}
              title={pageItem.page.title}
              site={pageItem.page.site}
              size={14}
            />
            <span>
              {pageItem.issue
                ? '当前页仅以链接加入'
                : `${pageItem.page.title} · ${pageItem.page.site}`}
            </span>
            {pageItem.status === 'preparing' && <i aria-label="正在准备当前页" />}
          </div>
        )}
        <div className="user-message-card">
        {references.map((reference) => (
          <blockquote className="sent-reference" key={reference.id}>
            <KoboyoIcon name="quote" size={13} />
            <span>{reference.text}</span>
          </blockquote>
        ))}
        {attachments.length > 0 && (
          <SentAttachments attachments={attachments} />
        )}
        {attachments.length > 0 && message.content && ' '}
        {message.content && <span className="user-message-text">{message.content}</span>}
        {message.collectionMaterials && (
          <details className="collection-message-materials">
            <summary>{message.collectionMode === 'question' ? `附带 ${message.collectionMaterials.length} 条收藏问答资料` : `已发送 ${message.collectionMaterials.length} 条收藏问答和整理要求`}</summary>
            <pre>{collectionMessagePrompt(message)}</pre>
          </details>
        )}
        </div>
        <div className="user-message-actions" aria-label="提问操作">
          <MessageTime timestamp={message.createdAt} label="用户提问于" className="message-time--user" />
          {message.content && (
            <>
              <IconTooltipButton
                className="user-message-action pressable"
                type="button"
                onClick={copyQuestion}
                aria-label={copyState === 'copied' ? '已复制提问' : copyState === 'failed' ? '复制失败' : '复制提问'}
                tooltip={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制提问'}
              >
                <KoboyoIcon name={copyState === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
              </IconTooltipButton>
              {!message.collectionMaterials && <IconTooltipButton
                className="user-message-action pressable"
                type="button"
                onClick={onEdit}
                aria-label="编辑提问到输入框"
                tooltip="编辑提问"
              >
                <KoboyoIcon name="edit" size={14} />
              </IconTooltipButton>}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function MessageList({
  messages,
  pendingCollectionCount,
  savedMessageIds,
  navigationTarget,
  branchOrigin,
  branchUnavailableReason,
  onUseStarter,
  onEditUserMessage,
  onRetry,
  onBranch,
  onToggleReadingCard,
  onCollectAssistantExcerpt,
  onOpenBranchOrigin,
  onAddAssistantQuote,
  onResolveDecision,
}: MessageListProps) {
  const messagesRef = useRef<HTMLElement>(null);
  const scrollToLatestRef = useRef<HTMLButtonElement>(null);
  const stickToBottomRef = useRef(true);
  const manuallyDetachedRef = useRef(false);
  const returningToBottomRef = useRef(false);
  const returnTimerRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const previousMessageCountRef = useRef(messages.length);
  const conversationRailItemsRef = useRef<ConversationPreviewRailItem[]>([]);
  const [selectionAction, setSelectionAction] = useState<AssistantSelectionAction | null>(null);
  const [selectionTranslation, setSelectionTranslation] = useState<SelectionTranslation | null>(null);
  const [translationCopyState, setTranslationCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const translationPanelRef = useRef<HTMLDivElement>(null);
  const translationRequestRef = useRef(0);
  const doubleCtrlShortcutRef = useRef(new DoubleCtrlShortcut());
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showConversationRail, setShowConversationRail] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState('');
  const [navigationAnnouncement, setNavigationAnnouncement] = useState('');
  const answerContexts = useMemo(() => buildAnswerContextMap(messages), [messages]);
  const conversationRailItems = useMemo<ConversationPreviewRailItem[]>(() => {
    let turnIndex = 0;
    return messages.flatMap((message) => {
      if (message.role !== 'user') return [];
      turnIndex += 1;
      const contextItems = contextItemsFromMessage(message);
      const attachment = contextAttachments(contextItems)[0];
      const selection = contextSelections(contextItems)[0];
      const page = contextPage(contextItems);
      const fallback = attachment
        ? `附件：${attachment.filename}`
        : selection
          ? `引用：${selection.text}`
          : page
            ? `关于 ${page.page.title}`
            : `第 ${turnIndex} 轮提问`;
      return [{
        id: message.id,
        label: compactConversationTurnLabel(message.content, fallback),
        createdAt: message.createdAt,
      }];
    });
  }, [messages]);
  conversationRailItemsRef.current = conversationRailItems;
  // Local rail/scroll/selection updates must not render every conversation message again.
  const renderedMessages = useMemo(() => messages.map((message) =>
    message.role === 'assistant' ? (
      <AssistantMessage
        message={message}
        contextSources={answerContexts.get(message.id) ?? []}
        onUseFollowUp={onUseStarter}
        onRetry={() => onRetry(message)}
        onBranch={() => onBranch(message)}
        saved={savedMessageIds.has(message.id)}
        onToggleReadingCard={(origin) => onToggleReadingCard(
          message,
          answerContexts.get(message.id) ?? [],
          origin,
        )}
        onResolveDecision={(decisionId, action, answers) =>
          onResolveDecision(message, decisionId, action, answers)}
        branchUnavailableReason={branchUnavailableReason}
        key={message.id}
      />
    ) : (
      <UserMessage message={message} onEdit={() => onEditUserMessage(message)} key={message.id} />
    ),
  ), [
    messages, answerContexts, savedMessageIds, onUseStarter, onRetry, onBranch,
    onToggleReadingCard, onResolveDecision, branchUnavailableReason, onEditUserMessage,
  ]);
  const hasMessages = messages.length > 0;
  const responseStreaming = messages.some((message) => message.status === 'streaming' || message.status === 'running');

  const updateConversationRail = useCallback(() => {
    const root = messagesRef.current;
    const items = conversationRailItemsRef.current;
    if (!root || items.length < MIN_CONVERSATION_RAIL_TURNS) {
      setShowConversationRail(false);
      return;
    }
    const scrollable = root.scrollHeight > root.clientHeight + 48;
    setShowConversationRail(scrollable);
    if (!scrollable) return;
    const rootRect = root.getBoundingClientRect();
    const readingLine = rootRect.top + Math.min(120, root.clientHeight * 0.24);
    const anchors = Array.from(root.querySelectorAll<HTMLElement>('[data-user-message-id]')).map((element) => ({
      id: element.dataset.userMessageId ?? '',
      top: element.getBoundingClientRect().top,
    })).filter((anchor) => anchor.id);
    const nextActiveId = activeConversationTurnId(anchors, readingLine);
    if (nextActiveId) setActiveTurnId((current) => current === nextActiveId ? current : nextActiveId);
  }, []);

  useEffect(() => {
    const root = messagesRef.current;
    if (!root) return;

    const clearReturnTimer = () => {
      if (returnTimerRef.current !== null) window.clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    };
    const detachFromLatest = () => {
      if (root.scrollTop <= 0 || root.scrollHeight <= root.clientHeight) return;
      clearReturnTimer();
      returningToBottomRef.current = false;
      stickToBottomRef.current = false;
      manuallyDetachedRef.current = true;
      setShowScrollToBottom(true);
    };
    const onScroll = () => {
      const distance = messageDistanceFromBottom(root);
      const atBottom = isNearMessageBottom(root);
      if (returningToBottomRef.current) {
        if (atBottom) {
          clearReturnTimer();
          returningToBottomRef.current = false;
          stickToBottomRef.current = true;
          setShowScrollToBottom(false);
        }
        return;
      }
      if (manuallyDetachedRef.current && distance > 1) {
        stickToBottomRef.current = false;
        setShowScrollToBottom(true);
        return;
      }
      if (distance <= 1) manuallyDetachedRef.current = false;
      stickToBottomRef.current = atBottom;
      setShowScrollToBottom(!atBottom);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) detachFromLatest();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY !== null && currentY !== undefined && currentY > startY + 4) detachFromLatest();
    };
    const onTouchEnd = () => {
      touchStartYRef.current = null;
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('wheel', onWheel, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      clearReturnTimer();
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
    };
  }, [hasMessages]);

  useEffect(() => {
    const root = messagesRef.current;
    if (!root) return;
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateConversationRail();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(root);
    root.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      root.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [hasMessages, updateConversationRail]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateConversationRail);
    return () => window.cancelAnimationFrame(frame);
  }, [messages, updateConversationRail]);

  useEffect(() => {
    const root = messagesRef.current;
    if (!root) return;

    const updateSelection = () => {
      window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          setSelectionAction(null);
          return;
        }
        const anchorElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? selection.anchorNode as Element
          : selection.anchorNode?.parentElement;
        const selectable = anchorElement?.closest<HTMLElement>('[data-assistant-selectable="true"]');
        const article = selectable?.closest<HTMLElement>('[data-assistant-message-id]');
        if (!selectable || !article || !selectionInsideMessage(selection, selectable)) {
          setSelectionAction(null);
          return;
        }
        const text = selection.toString().replace(/\s+/gu, ' ').trim();
        if (!text) {
          setSelectionAction(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const toolbarWidth = canTranslateLocally(text) ? 260 : 184;
        const toolbarHeight = 44;
        const toolbarTop = rect.top >= toolbarHeight + 16
          ? rect.top - toolbarHeight - 8
          : rect.bottom + 8;
        setSelectionAction({
          messageId: article.dataset.assistantMessageId ?? '',
          text: text.slice(0, MAX_ASSISTANT_QUOTE_LENGTH),
          context: canTranslateLocally(text) ? selectedSentence(selection, text) : null,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - toolbarWidth - 8)),
          top: Math.max(8, Math.min(toolbarTop, window.innerHeight - toolbarHeight - 8)),
        });
      });
    };
    const clearSelectionAction = () => {
      setSelectionAction(null);
      setSelectionTranslation(null);
    };
    const clearCollapsedSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelectionAction(null);
    };
    const clearFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || root.contains(target)) return;
      if (target instanceof Element && target.closest('.assistant-selection-action, .assistant-selection-translation')) return;
      setSelectionAction(null);
      setSelectionTranslation(null);
    };
    root.addEventListener('pointerup', updateSelection);
    root.addEventListener('keyup', updateSelection);
    root.addEventListener('scroll', clearSelectionAction, { passive: true });
    document.addEventListener('selectionchange', clearCollapsedSelection);
    document.addEventListener('pointerdown', clearFromOutside);
    window.addEventListener('resize', clearSelectionAction);
    return () => {
      root.removeEventListener('pointerup', updateSelection);
      root.removeEventListener('keyup', updateSelection);
      root.removeEventListener('scroll', clearSelectionAction);
      document.removeEventListener('selectionchange', clearCollapsedSelection);
      document.removeEventListener('pointerdown', clearFromOutside);
      window.removeEventListener('resize', clearSelectionAction);
    };
  }, [messages]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionTranslation(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useLayoutEffect(() => {
    const panel = translationPanelRef.current;
    if (!panel || !selectionTranslation) return;
    const { width, height } = panel.getBoundingClientRect();
    const below = selectionTranslation.top + 52;
    const above = selectionTranslation.top - height - 8;
    const top = below + height <= window.innerHeight - 12
      ? below
      : above >= 12
        ? above
        : Math.max(12, Math.min(below, window.innerHeight - height - 12));
    panel.style.left = `${Math.max(12, Math.min(selectionTranslation.left, window.innerWidth - width - 12))}px`;
    panel.style.top = `${top}px`;
  }, [selectionTranslation]);

  const translateSelection = () => {
    if (!selectionAction) return;
    const { text, context, left, top } = selectionAction;
    const requestId = ++translationRequestRef.current;
    setTranslationCopyState('idle');
    setSelectionTranslation({
      source: text,
      context,
      result: '',
      sentenceResult: '',
      status: 'loading',
      sentenceStatus: context ? 'loading' : 'idle',
      progress: null,
      left,
      top,
    });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    // translateLocally creates the translator immediately, while the click still has user activation.
    const result = translateLocally(text, (progress) => {
      if (requestId === translationRequestRef.current) {
        setSelectionTranslation((current) => current && { ...current, progress });
      }
    });
    void result.then(async (translated) => {
      if (requestId !== translationRequestRef.current) return;
      setSelectionTranslation((current) => current && {
        ...current,
        result: translated,
        status: 'ready',
        progress: null,
      });
      if (!context) return;
      try {
        const translatedSentence = await translateLocally(context.text);
        if (requestId === translationRequestRef.current) {
          setSelectionTranslation((current) => current && {
            ...current,
            sentenceResult: translatedSentence,
            sentenceStatus: 'ready',
          });
        }
      } catch {
        if (requestId === translationRequestRef.current) {
          setSelectionTranslation((current) => current && { ...current, sentenceStatus: 'error' });
        }
      }
    }).catch(() => {
      if (requestId === translationRequestRef.current) {
        setSelectionTranslation((current) => current && { ...current, status: 'error', progress: null });
      }
    });
  };

  useEffect(() => {
    const selectionKey = (target: EventTarget | null) => {
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return null;
      if (!selectionAction || !canTranslateLocally(selectionAction.text)) return null;
      return `${selectionAction.messageId}:${selectionAction.text}`;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (doubleCtrlShortcutRef.current.keyDown(event, selectionKey(event.target))) {
        event.preventDefault();
        translateSelection();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      doubleCtrlShortcutRef.current.keyUp(event, selectionKey(event.target));
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    const resetOnBlur = () => doubleCtrlShortcutRef.current.reset();
    window.addEventListener('blur', resetOnBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', resetOnBlur);
    };
  }, [selectionAction]);

  const readTranslationSource = () => {
    if (!selectionTranslation || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectionTranslation.source);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const copyTranslation = async () => {
    if (!selectionTranslation?.result) return;
    const requestId = translationRequestRef.current;
    try {
      await navigator.clipboard.writeText(selectionTranslation.result);
      if (requestId === translationRequestRef.current) setTranslationCopyState('copied');
    } catch {
      if (requestId === translationRequestRef.current) setTranslationCopyState('failed');
    }
  };

  const translationIsTerm = Boolean(selectionTranslation
    && selectionTranslation.source.length <= 36
    && selectionTranslation.source.split(/\s+/u).length <= 4
    && !/[.!?。！？]/u.test(selectionTranslation.source));

  useLayoutEffect(() => {
    const root = messagesRef.current;
    if (!root || !navigationTarget) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((element) => element.dataset.messageId === navigationTarget.messageId);
    if (!target) return;
    const highlightName = 'yemai-search-match';
    const highlightRegistry = (CSS as unknown as {
      highlights?: { set: (name: string, highlight: unknown) => void; delete: (name: string) => boolean };
    }).highlights;
    const HighlightConstructor = (globalThis as unknown as {
      Highlight?: new (...ranges: Range[]) => unknown;
    }).Highlight;
    highlightRegistry?.delete(highlightName);
    const searchable = target.querySelector<HTMLElement>('.markdown-body, .user-message-card') ?? target;
    const walker = document.createTreeWalker(searchable, NodeFilter.SHOW_TEXT);
    const ranges: Range[] = [];
    let current = walker.nextNode();
    while (current && ranges.length < 60) {
      const value = current.textContent ?? '';
      const remaining = 60 - ranges.length;
      findSearchTextMatches(value, navigationTarget.query, navigationTarget.matchedTerms, remaining)
        .forEach((match) => {
          const range = document.createRange();
          range.setStart(current!, match.start);
          range.setEnd(current!, match.end);
          ranges.push(range);
        });
      current = walker.nextNode();
    }
    if (highlightRegistry && HighlightConstructor && ranges.length > 0) {
      highlightRegistry.set(highlightName, new HighlightConstructor(...ranges));
    }
    const rootRect = root.getBoundingClientRect();
    const matchRect = ranges[0]?.getBoundingClientRect();
    const anchorRect = matchRect && (matchRect.width > 0 || matchRect.height > 0)
      ? matchRect
      : target.getBoundingClientRect();
    const targetTop = root.scrollTop + anchorRect.top - rootRect.top - Math.min(84, root.clientHeight * 0.18);
    stickToBottomRef.current = false;
    manuallyDetachedRef.current = true;
    returningToBottomRef.current = false;
    setShowScrollToBottom(true);
    root.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    target.classList.add('is-search-target');
    setNavigationAnnouncement(navigationTarget.query
      ? `已定位到包含“${navigationTarget.query}”的消息`
      : '已定位到搜索结果');
    const timer = window.setTimeout(() => {
      target.classList.remove('is-search-target');
      highlightRegistry?.delete(highlightName);
      setNavigationAnnouncement('');
    }, 2800);
    return () => {
      window.clearTimeout(timer);
      target.classList.remove('is-search-target');
      highlightRegistry?.delete(highlightName);
    };
  }, [navigationTarget]);

  useLayoutEffect(() => {
    const root = messagesRef.current;
    if (!root) return;
    const messageAppended = messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;
    if (messageAppended) {
      stickToBottomRef.current = true;
      manuallyDetachedRef.current = false;
      returningToBottomRef.current = false;
    }
    if (!stickToBottomRef.current) return;
    root.scrollTop = root.scrollHeight;
    setShowScrollToBottom(false);
  }, [messages]);

  const scrollToLatest = () => {
    const root = messagesRef.current;
    if (!root) return;
    if (returnTimerRef.current !== null) window.clearTimeout(returnTimerRef.current);
    if (document.activeElement === scrollToLatestRef.current) {
      root.focus({ preventScroll: true });
    }
    stickToBottomRef.current = true;
    manuallyDetachedRef.current = false;
    returningToBottomRef.current = true;
    setShowScrollToBottom(false);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo({ top: root.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    returnTimerRef.current = window.setTimeout(() => {
      returningToBottomRef.current = false;
      const atBottom = isNearMessageBottom(root);
      stickToBottomRef.current = atBottom;
      setShowScrollToBottom(!atBottom);
      returnTimerRef.current = null;
    }, reduceMotion ? 0 : 420);
  };

  const scrollToConversationTurn = (messageId: string, behavior: ScrollBehavior) => {
    const root = messagesRef.current;
    if (!root) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-user-message-id]'))
      .find((element) => element.dataset.userMessageId === messageId);
    if (!target) return;
    const rootRect = root.getBoundingClientRect();
    const targetTop = root.scrollTop + target.getBoundingClientRect().top - rootRect.top - 18;
    stickToBottomRef.current = false;
    manuallyDetachedRef.current = true;
    returningToBottomRef.current = false;
    setShowScrollToBottom(true);
    root.scrollTo({ top: Math.max(0, targetTop), behavior });
  };

  if (messages.length === 0) {
    if (pendingCollectionCount) {
      return (
        <div className="message-stage">
          <main className="messages messages--empty">
            <div className="empty-state">
              <span className="empty-orbit" aria-hidden="true"><span>{String(pendingCollectionCount).padStart(2, '0')}</span></span>
              <h2>已带入 {pendingCollectionCount} 条收藏问答</h2>
              <p>在下方提出这次想问的问题。材料会随问题一起发送，现在尚未发送给 WorkOS。</p>
            </div>
          </main>
        </div>
      );
    }
    return (
      <div className="message-stage">
        <main className="messages messages--empty">
          <div className="empty-state">
            <span className="empty-orbit" aria-hidden="true"><span>01</span></span>
            <span className="empty-kicker">读过的，终会连起来。</span>
            <h2>从当前页面开始</h2>
            <p>每个工作页只承载一条会话；新对话从空白开始，分支从已有回答继续。</p>
            <div className="starter-list">
              {STARTER_ACTIONS.map((starter) => (
                <button className="starter-button pressable" type="button" onClick={() => onUseStarter(starter.prompt)} key={starter.id}>
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="message-stage">
      <span className="visually-hidden" role="status" aria-live="polite">{navigationAnnouncement}</span>
      <main className="messages" aria-live="polite" ref={messagesRef} tabIndex={-1}>
      {branchOrigin && (
        <button
          className="branch-origin"
          type="button"
          onClick={onOpenBranchOrigin}
          disabled={!branchOrigin.available}
          title={branchOrigin.available ? '查看原会话' : branchOrigin.unavailableReason}
        >
          <KoboyoIcon name="fork" size={13} />
          <span>
            从「{branchOrigin.title}」
            {branchOrigin.timestamp && (
              <time dateTime={new Date(branchOrigin.timestamp).toISOString()}>
                {formatMessageTimestamp(branchOrigin.timestamp).label}
              </time>
            )}
            的回答分支
          </span>
          <strong>{branchOrigin.available ? '查看原会话' : '暂不可打开'}</strong>
        </button>
      )}
      {renderedMessages}
      {selectionAction && createPortal(
        <div
          className="assistant-selection-action"
          role="toolbar"
          aria-label="处理选中的回答片段"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            className="assistant-selection-action__button pressable"
            type="button"
            onClick={(event) => {
              const message = messages.find((item) => item.id === selectionAction.messageId);
              if (!message) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              onCollectAssistantExcerpt(
                message,
                selectionAction.text,
                answerContexts.get(message.id) ?? [],
                { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
              );
              window.getSelection()?.removeAllRanges();
              setSelectionAction(null);
            }}
          >
            <KoboyoIcon name="bookmark" size={12} />
            收藏片段
          </button>
          <button
            className="assistant-selection-action__button pressable"
            type="button"
            onClick={() => {
              if (!messages.some((message) => message.id === selectionAction.messageId)) return;
              onAddAssistantQuote({
                id: `quote-assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                text: selectionAction.text,
                pageTitle: '页脉回答',
                pageUrl: '',
                createdAt: Date.now(),
                origin: 'assistant',
                sourceMessageId: selectionAction.messageId,
              });
              window.getSelection()?.removeAllRanges();
              setSelectionAction(null);
            }}
          >
            <KoboyoIcon name="quote" size={12} />
            引用追问
          </button>
          {canTranslateLocally(selectionAction.text) && (
            <button
              className="assistant-selection-action__button pressable"
              type="button"
              onClick={translateSelection}
              title="双击 Ctrl 也可翻译"
            >
              翻译
            </button>
          )}
        </div>,
        document.body,
      )}
      {selectionTranslation && createPortal(
        <div
          ref={translationPanelRef}
          className="assistant-selection-translation"
          role="region"
          aria-label="本地翻译"
          data-kind={translationIsTerm ? 'term' : 'text'}
          style={{ left: selectionTranslation.left, top: selectionTranslation.top }}
        >
          <div className="assistant-selection-translation__heading">
            <span className="assistant-selection-translation__eyebrow">本地翻译 <span>英 → 中</span></span>
            <button className="assistant-selection-translation__icon-button" type="button" aria-label="关闭翻译" onClick={() => setSelectionTranslation(null)}>
              <KoboyoIcon name="cross" size={14} />
            </button>
          </div>
          <div className={translationIsTerm ? 'assistant-selection-translation__headword' : 'assistant-selection-translation__passage'}>
            {!translationIsTerm && <span className="assistant-selection-translation__label">原文</span>}
            <div className="assistant-selection-translation__source-row">
              {translationIsTerm
                ? <strong className="assistant-selection-translation__source" lang="en">{selectionTranslation.source}</strong>
                : <p className="assistant-selection-translation__source" lang="en">{selectionTranslation.source}</p>}
              {typeof SpeechSynthesisUtterance !== 'undefined' && 'speechSynthesis' in window && (
                <button className="assistant-selection-translation__icon-button" type="button" onClick={readTranslationSource} aria-label="朗读选中的英文" title="朗读英文">
                  <SpeakerIcon />
                </button>
              )}
            </div>
          </div>
          {selectionTranslation.status === 'loading' && (
            <p className="assistant-selection-translation__status" role="status">{selectionTranslation.progress === null
              ? '正在翻译…首次使用可能需要下载语言包'
              : `正在下载语言包 ${selectionTranslation.progress}%`}</p>
          )}
          {selectionTranslation.status === 'error' && (
            <p className="assistant-selection-translation__status" role="status">本地翻译暂不可用。请检查 Chrome 版本和语言包下载状态。</p>
          )}
          {selectionTranslation.status === 'ready' && (
            <div className="assistant-selection-translation__result-row" aria-live="polite">
              <div>
                <span className="assistant-selection-translation__label">{translationIsTerm ? '词语译文' : '中文译文'}</span>
                <p className="assistant-selection-translation__result">{selectionTranslation.result}</p>
              </div>
              <button
                className="assistant-selection-translation__icon-button"
                type="button"
                onClick={() => void copyTranslation()}
                aria-label={translationCopyState === 'copied' ? '已复制译文' : translationCopyState === 'failed' ? '复制失败，请重试' : '复制译文'}
                title={translationCopyState === 'copied' ? '已复制' : translationCopyState === 'failed' ? '复制失败' : '复制译文'}
              >
                <KoboyoIcon name={translationCopyState === 'copied' ? 'solid-checkmark' : 'copy'} size={15} />
              </button>
            </div>
          )}
          {selectionTranslation.context && selectionTranslation.status !== 'error' && (
            <div className="assistant-selection-translation__context">
              <span className="assistant-selection-translation__label">所在句</span>
              <p lang="en">
                {selectionTranslation.context.text.slice(0, selectionTranslation.context.highlightStart)}
                {selectionTranslation.context.highlightEnd > selectionTranslation.context.highlightStart && (
                  <mark>{selectionTranslation.context.text.slice(
                    selectionTranslation.context.highlightStart,
                    selectionTranslation.context.highlightEnd,
                  )}</mark>
                )}
                {selectionTranslation.context.text.slice(selectionTranslation.context.highlightEnd)}
              </p>
              {selectionTranslation.sentenceStatus === 'ready' && <p className="assistant-selection-translation__context-result" lang="zh">{selectionTranslation.sentenceResult}</p>}
              {selectionTranslation.sentenceStatus === 'loading' && <p className="assistant-selection-translation__context-status" role="status">正在翻译整句…</p>}
              {selectionTranslation.sentenceStatus === 'error' && <p className="assistant-selection-translation__context-status" role="status">整句暂时无法翻译</p>}
            </div>
          )}
        </div>,
        document.body,
      )}
      </main>
      {showConversationRail && (
        <ConversationPreviewRail
          items={conversationRailItems}
          activeId={conversationRailItems.some((item) => item.id === activeTurnId)
            ? activeTurnId
            : conversationRailItems[0]?.id ?? ''}
          onSelect={scrollToConversationTurn}
        />
      )}
      <button
        ref={scrollToLatestRef}
        className="scroll-to-latest pressable"
        type="button"
        data-visible={showScrollToBottom ? '' : undefined}
        data-streaming={responseStreaming ? '' : undefined}
        aria-label="回到最新内容"
        inert={!showScrollToBottom}
        tabIndex={showScrollToBottom ? 0 : -1}
        onClick={scrollToLatest}
      >
        <span className="scroll-to-latest-arrow" aria-hidden="true" />
      </button>
    </div>
  );
}
