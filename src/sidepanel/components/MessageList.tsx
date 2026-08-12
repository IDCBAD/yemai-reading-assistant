import { isValidElement, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, RunActivity, RunActivityStatus } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';
import { YemaiMark } from './YemaiMark';

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
  onRetry: (message: ChatMessage) => void;
  onBranch: (message: ChatMessage) => void;
  onOpenBranchOrigin: () => void;
}

const STARTERS = ['介绍一下你的能力', '解释我加入的引用', '给我一条学习 Agent 的路线'];

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
  onRetry,
  onBranch,
  branchUnavailableReason,
}: {
  message: ChatMessage;
  onRetry: () => void;
  onBranch: () => void;
  branchUnavailableReason?: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const runNote = getRunNote(message);
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
    <article className="message message--assistant">
      <div className="assistant-rail" aria-hidden="true">
        <span className="assistant-mark">
          <YemaiMark />
        </span>
        <span className="assistant-line" />
      </div>
      <div className="message-content">
        {message.activities && message.activities.length > 0 && <RunActivityPanel activities={message.activities} />}
        <div className="markdown-body">
          {!message.content && runNote && (
            <div className={`message-run-note message-run-note--${runNote.kind}`} role="status">
              {runNote.copy}
            </div>
          )}
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
          {message.status === 'streaming' && message.content && <span className="stream-cursor" aria-label="正在生成" />}
        </div>
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

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="message message--user">
      <div className="user-message-stack">
        {message.pageContext && (
          <div
            className={`sent-page-context sent-page-context--${message.pageContext.status}${message.pageContextIssue ? ' has-issue' : ''}`}
            title={message.pageContextIssue ?? message.pageContext.url}
          >
            <PageFavicon
              url={message.pageContext.url}
              title={message.pageContext.title}
              site={message.pageContext.site}
              size={14}
            />
            <span>
              {message.pageContextIssue
                ? '当前页仅以链接加入'
                : `${message.pageContext.title} · ${message.pageContext.site}`}
            </span>
            {message.pageContext.status === 'reading' && <i aria-label="正在准备当前页" />}
          </div>
        )}
        <div className="user-message-card">
        {message.references?.map((reference) => (
          <blockquote className="sent-reference" key={reference.id}>
            <KoboyoIcon name="quote" size={13} />
            <span>{reference.text}</span>
          </blockquote>
        ))}
        {message.attachments && message.attachments.length > 0 && (
          <div className="sent-attachments">
            {message.attachments.map((attachment) => (
              <span key={attachment.id}>
                <KoboyoIcon name="file" size={13} />
                {attachment.filename}
              </span>
            ))}
          </div>
        )}
        {message.content && <p>{message.content}</p>}
        </div>
        <MessageTime timestamp={message.createdAt} label="用户提问于" className="message-time--user" />
      </div>
    </article>
  );
}

export function MessageList({
  messages,
  branchOrigin,
  branchUnavailableReason,
  onUseStarter,
  onRetry,
  onBranch,
  onOpenBranchOrigin,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

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
            {STARTERS.map((starter) => (
              <button className="starter-button pressable" type="button" onClick={() => onUseStarter(starter)} key={starter}>
                {starter}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="messages" aria-live="polite">
      <div className="conversation-date">今天 · 当前工作页</div>
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
            onRetry={() => onRetry(message)}
            onBranch={() => onBranch(message)}
            branchUnavailableReason={branchUnavailableReason}
            key={message.id}
          />
        ) : (
          <UserMessage message={message} key={message.id} />
        ),
      )}
      <div ref={endRef} />
    </main>
  );
}
