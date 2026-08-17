import { isValidElement, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildAnswerContextMap, type AnswerContextSource } from '../answerContext';
import { contextAttachments, contextItemsFromMessage, contextPage, contextSelections } from '../contextItems';
import type { ChatMessage, DraftAttachment, QuoteReference, RunActivity, RunActivityStatus } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
import { attachmentFormatLabel, getFileType, isImageFile, uploadChannelLabel } from '../fileTypes';
import { STARTER_ACTIONS } from '../starterActions';
import { parsePageOverview } from '../pageOverview';
import { FileTypeIcon } from './FileTypeIcon';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';
import { PageOverviewCard } from './PageOverviewCard';
import { YemaiMark } from './YemaiMark';
import { AnswerContextTrace } from './AnswerContextTrace';

interface MessageListProps {
  messages: ChatMessage[];
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
  onOpenBranchOrigin: () => void;
  onAddAssistantQuote: (quote: QuoteReference) => void;
}

const MAX_ASSISTANT_QUOTE_LENGTH = 4_000;

interface AssistantSelectionAction {
  messageId: string;
  text: string;
  left: number;
  top: number;
}

function selectionInsideMessage(selection: Selection, container: HTMLElement) {
  if (!selection.rangeCount || selection.isCollapsed) return false;
  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
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

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="code-block">
      <button className="code-copy pressable" type="button" onClick={copy} aria-label="复制代码">
        <KoboyoIcon name={copied ? 'solid-checkmark' : 'copy'} size={13} />
        {copied ? '已复制' : '复制'}
      </button>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
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
  const [expanded, setExpanded] = useState(false);
  const activeCount = activities.filter((activity) => activity.status === 'pending' || activity.status === 'running').length;
  const failedCount = activities.filter((activity) => activity.status === 'failed').length;
  const summary = activeCount > 0
    ? `正在运行 ${activities.length} 个工具`
    : failedCount > 0
      ? `${activities.length} 个工具中有 ${failedCount} 个失败`
      : `运行了 ${activities.length} 个工具`;

  return (
    <section className="run-activity" aria-label="Agent 运行过程">
      <button
        className="run-activity-toggle pressable"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`disclosure-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
        <KoboyoIcon name="file" size={13} />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="run-activity-list">
          {activities.map((activity) => {
            const duration = formatDuration(activity);
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
    </section>
  );
}

function getRunNote(message: ChatMessage) {
  if (message.status === 'queued') return { kind: 'queued', copy: '排队中' } as const;
  if (message.status === 'stopped' && !message.content) return { kind: 'stopped', copy: '已停止' } as const;
  if (message.status === 'failed' && !message.content) {
    return { kind: 'failed', copy: message.errorMessage ?? '运行失败' } as const;
  }
  if (message.status === 'running') {
    const copy = message.stage === 'reading-page'
      ? '正在读取当前页面…'
      : message.stage === 'creating-conversation'
        ? '正在创建 WorkOS 会话…'
        : 'Agent 正在处理…';
    return { kind: 'running', copy } as const;
  }
  return null;
}

function AssistantMessage({
  message,
  contextSources,
  onUseFollowUp,
  onRetry,
  onBranch,
  branchUnavailableReason,
}: {
  message: ChatMessage;
  contextSources: AnswerContextSource[];
  onUseFollowUp: (question: string) => void;
  onRetry: () => void;
  onBranch: () => void;
  branchUnavailableReason?: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const runNote = getRunNote(message);
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
  const actionsAvailable = Boolean(message.content) && message.status !== 'streaming';
  const footerAvailable = actionsAvailable || message.status === 'failed';

  return (
    <article className="message message--assistant" data-assistant-message-id={message.id}>
      <div className="assistant-rail" aria-hidden="true">
        <span className="assistant-mark">
          <YemaiMark />
        </span>
        <span className="assistant-line" />
      </div>
      <div className="message-content">
        {message.activities && message.activities.length > 0 && <RunActivityPanel activities={message.activities} />}
        <div
          className={`markdown-body${pageOverview ? ' markdown-body--page-overview' : ''}`}
          data-assistant-selectable="true"
        >
          {!message.content && runNote && (
            <div className={`message-run-note message-run-note--${runNote.kind}`} role="status">
              {runNote.copy}
            </div>
          )}
          {pageOverview ? (
            <PageOverviewCard overview={pageOverview} onUseFollowUp={onUseFollowUp} />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre({ children }) {
                  const child = isValidElement<{ children?: unknown }>(children) ? children : null;
                  const value = String(child?.props.children ?? '').replace(/\n$/, '');
                  return <CodeBlock>{value}</CodeBlock>;
                },
                code({ children }) {
                  return <code className="inline-code">{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
          {message.status === 'streaming' && message.content && <span className="stream-cursor" aria-label="正在生成" />}
        </div>
        {Boolean(message.content) && message.status !== 'streaming' && (
          <AnswerContextTrace sources={contextSources} />
        )}
        {footerAvailable && (
          <div className="assistant-footer" aria-label="回答操作">
            {message.status === 'failed' && (
              <button
                className="assistant-action pressable"
                type="button"
                onClick={onRetry}
                aria-label={message.content ? '重试回答' : '重新发送'}
                title={message.content ? '重试回答' : '重新发送'}
              >
                <KoboyoIcon name="cycle" size={14} />
              </button>
            )}
            {actionsAvailable && (
              <>
                <button
                  className="assistant-action pressable"
                  type="button"
                  onClick={copyMarkdown}
                  aria-label={copyState === 'copied' ? '已复制 Markdown' : copyState === 'failed' ? '复制失败' : '复制 Markdown'}
                  title={copyState === 'copied' ? '已复制 Markdown' : copyState === 'failed' ? '复制失败' : '复制 Markdown'}
                >
                  <KoboyoIcon name={copyState === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
                </button>
                <button
                  className="assistant-action pressable"
                  type="button"
                  onClick={onBranch}
                  disabled={Boolean(branchUnavailableReason)}
                  aria-label={branchUnavailableReason ? `无法创建分支：${branchUnavailableReason}` : '从这里分支'}
                  title={branchUnavailableReason ?? '从这里分支：保留此前内容，探索另一条思路'}
                >
                  <KoboyoIcon name="fork" size={14} />
                </button>
              </>
            )}
            {(message.respondedAt || message.content) && (
              <MessageTime
                timestamp={message.respondedAt ?? message.createdAt}
                label="Agent 回答于"
                className="message-time--assistant"
              />
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

  useEffect(() => {
    if (!activeImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeImage();
      }
    };
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [activeImage]);

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
      {(activeImage?.previewUrl ?? activeImage?.url) && createPortal(
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`图片预览：${activeImage.filename}`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeImage();
          }}
        >
          <button
            className="image-lightbox-close pressable"
            type="button"
            onClick={closeImage}
            onKeyDown={(event) => {
              if (event.key === 'Tab') event.preventDefault();
            }}
            aria-label="关闭图片预览"
            title="关闭"
            autoFocus
          >
            <KoboyoIcon name="cross" size={15} />
          </button>
          <img
            src={activeImage.previewUrl ?? activeImage.url}
            alt={activeImage.filename}
            decoding="async"
            onError={() => markImageFailed(activeImage)}
          />
          <span className="image-lightbox-caption">{activeImage.filename}</span>
        </div>,
        document.body,
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
      await navigator.clipboard.writeText(message.content);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };
  return (
    <article className="message message--user">
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
        </div>
        <div className="user-message-actions" aria-label="提问操作">
          <MessageTime timestamp={message.createdAt} label="用户提问于" className="message-time--user" />
          {message.content && (
            <>
              <button
                className="user-message-action pressable"
                type="button"
                onClick={copyQuestion}
                aria-label={copyState === 'copied' ? '已复制提问' : copyState === 'failed' ? '复制失败' : '复制提问'}
                title={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制提问'}
              >
                <KoboyoIcon name={copyState === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
              </button>
              <button
                className="user-message-action pressable"
                type="button"
                onClick={onEdit}
                aria-label="编辑提问到输入框"
                title="编辑提问"
              >
                <KoboyoIcon name="edit" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function MessageList({
  messages,
  branchOrigin,
  branchUnavailableReason,
  onUseStarter,
  onEditUserMessage,
  onRetry,
  onBranch,
  onOpenBranchOrigin,
  onAddAssistantQuote,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const [selectionAction, setSelectionAction] = useState<AssistantSelectionAction | null>(null);
  const answerContexts = useMemo(() => buildAnswerContextMap(messages), [messages]);

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
        setSelectionAction({
          messageId: article.dataset.assistantMessageId ?? '',
          text: text.slice(0, MAX_ASSISTANT_QUOTE_LENGTH),
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 108)),
          top: Math.max(8, rect.top - 39),
        });
      });
    };
    const clearSelectionAction = () => setSelectionAction(null);
    const clearCollapsedSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelectionAction(null);
    };
    const clearFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || root.contains(target)) return;
      if (target instanceof Element && target.closest('.assistant-selection-action')) return;
      setSelectionAction(null);
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
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
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
    );
  }

  return (
    <main className="messages" aria-live="polite" ref={messagesRef}>
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
      {messages.map((message) =>
        message.role === 'assistant' ? (
          <AssistantMessage
            message={message}
            contextSources={answerContexts.get(message.id) ?? []}
            onUseFollowUp={onUseStarter}
            onRetry={() => onRetry(message)}
            onBranch={() => onBranch(message)}
            branchUnavailableReason={branchUnavailableReason}
            key={message.id}
          />
        ) : (
          <UserMessage message={message} onEdit={() => onEditUserMessage(message)} key={message.id} />
        ),
      )}
      <div ref={endRef} />
      {selectionAction && createPortal(
        <button
          className="assistant-selection-action pressable"
          type="button"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onPointerDown={(event) => event.preventDefault()}
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
          添加到对话
        </button>,
        document.body,
      )}
    </main>
  );
}
