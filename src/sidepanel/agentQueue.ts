import type { AgentRunSummary, ChatMessage, Conversation, MessageStage } from './types';
import { WORKOS_USER_STOP_REASON } from '../services/workosTransport';

interface CoordinatedRequest {
  conversationId: string;
  messageId: string;
}

type RequestRunner<TRequest extends CoordinatedRequest> = (
  request: TRequest,
  signal: AbortSignal,
) => Promise<void>;

export function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Stopped', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class ConversationRequestCoordinator<TRequest extends CoordinatedRequest> {
  private readonly queues = new Map<string, TRequest[]>();
  private readonly active = new Map<string, { request: TRequest; controller: AbortController }>();

  constructor(private readonly run: RequestRunner<TRequest>) {}

  enqueue(request: TRequest) {
    const queue = this.queues.get(request.conversationId) ?? [];
    queue.push(request);
    this.queues.set(request.conversationId, queue);
    void this.drain(request.conversationId);
  }

  stop(conversationId: string, expectedMessageId?: string) {
    const execution = this.active.get(conversationId);
    if (expectedMessageId && execution?.request.messageId !== expectedMessageId) return false;
    const controller = execution?.controller;
    if (!controller || controller.signal.aborted) return false;
    controller.abort(WORKOS_USER_STOP_REASON);
    return true;
  }

  discardQueued(conversationId: string): TRequest[] {
    const requests = this.queues.get(conversationId) ?? [];
    this.queues.delete(conversationId);
    return requests;
  }

  cancel(conversationId: string) {
    // Ordinary history cleanup is local cancellation. Preserve an explicitly
    // requested remote pause already in flight until its result settles.
    this.active.get(conversationId)?.controller.abort();
  }

  clear() {
    this.active.forEach(({ controller }, conversationId) => {
      controller.abort();
      // A conversation-level remote abort must settle before reusing this queue,
      // even if settings/history are cleared while its response is pending.
      if (controller.signal.reason !== WORKOS_USER_STOP_REASON) this.active.delete(conversationId);
    });
    this.queues.clear();
  }

  private async drain(conversationId: string): Promise<void> {
    if (this.active.has(conversationId)) return;
    const queue = this.queues.get(conversationId);
    const request = queue?.shift();
    if (!request) {
      this.queues.delete(conversationId);
      return;
    }

    const controller = new AbortController();
    const execution = { request, controller };
    this.active.set(conversationId, execution);
    try {
      await this.run(request, controller.signal);
    } catch {
      // The request runner owns user-facing error reporting. The coordinator
      // only guarantees that a settled request cannot block the next one.
    } finally {
      const current = this.active.get(conversationId);
      if (current === execution) {
        this.active.delete(conversationId);
        void this.drain(conversationId);
      }
    }
  }
}

const STAGE_PRESENTATION: Record<
  Exclude<MessageStage, 'queued'>,
  Pick<AgentRunSummary, 'label' | 'orbState'>
> = {
  'reading-page': { label: '正在读取页面', orbState: 'searching' },
  'creating-conversation': { label: '正在建立会话', orbState: 'working' },
  'waiting-first-token': { label: '正在连接 Agent', orbState: 'listening' },
  'waiting-user-input': { label: '等待你的选择', orbState: 'listening' },
  streaming: { label: '正在组织回答', orbState: 'shaping' },
};

export function deriveMessageRunNote(message: ChatMessage) {
  if (message.status === 'queued') return { kind: 'queued', copy: '排队中' } as const;
  if (message.status === 'stopped' && !message.content) return { kind: 'stopped', copy: '已停止' } as const;
  if (message.status === 'failed' && !message.content) {
    return { kind: 'failed', copy: message.errorMessage ?? '运行失败' } as const;
  }
  if (message.content || (message.status !== 'running' && message.status !== 'streaming')) return null;

  const copy = message.stage === 'reading-page'
    ? '正在读取当前页面…'
    : message.stage === 'creating-conversation'
      ? '正在创建 WorkOS 会话…'
      : message.stage === 'streaming'
        ? '正在组织回答…'
        : message.stage === 'waiting-user-input'
          ? '等待你的选择…'
          : 'Agent 正在思考…';
  return { kind: 'running', copy } as const;
}

export function deriveMessageStopNotice(message: ChatMessage) {
  if (message.remoteRunUnconfirmed) return {
    kind: 'stopped',
    copy: message.errorMessage ?? '进度连接已断开，WorkOS 任务状态未确认，任务可能仍在运行。请在 WorkOS 查看进度。',
  } as const;
  switch (message.stopStatus) {
    case 'pending': return { kind: 'stopped', copy: '已停止接收，正在请求 WorkOS 暂停…' } as const;
    case 'accepted': return { kind: 'stopped', copy: '已停止接收，WorkOS 已接受暂停请求。' } as const;
    case 'local-only': return { kind: 'stopped', copy: message.errorMessage ?? '已停止接收，未向 WorkOS 发送暂停请求。' } as const;
    case 'failed': return { kind: 'failed', copy: message.errorMessage ?? '已停止接收，无法确认 WorkOS 是否暂停。' } as const;
    default: return null;
  }
}

export function deriveAgentRunSummary(messages: ChatMessage[]): AgentRunSummary | null {
  const active = messages.find((message) =>
    message.role === 'assistant' && (message.status === 'running' || message.status === 'streaming'));
  if (!active) return null;
  const status = active.status === 'streaming' ? 'streaming' : 'running';

  const stage = active.stage && active.stage !== 'queued'
    ? active.stage
    : 'waiting-first-token';

  return {
    activeMessageId: active.id,
    status,
    stage,
    ...STAGE_PRESENTATION[stage],
    ...(stage === 'streaming' && active.content ? { label: '正在回答' } : {}),
    queuedCount: messages.filter((message) =>
      message.role === 'assistant' && message.status === 'queued').length,
  };
}

export function getNextQueuedMessageId(messages: ChatMessage[]) {
  return messages.find((message) =>
    message.role === 'assistant' && message.status === 'queued')?.id ?? null;
}

export function deriveActiveConversationIds(conversations: Conversation[]) {
  return new Set(conversations
    .filter((conversation) => deriveAgentRunSummary(conversation.messages))
    .map(({ id }) => id));
}

export function reconcileTransientMessages(messages: ChatMessage[]) {
  return messages.map((message) =>
    message.role === 'assistant' && ['queued', 'running', 'streaming'].includes(message.status)
      ? { ...message, status: 'stopped' as const, stage: undefined }
      : message);
}
