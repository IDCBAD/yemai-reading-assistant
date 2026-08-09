import { describe, expect, it } from 'vitest';
import {
  ConversationRequestCoordinator,
  deriveActiveConversationIds,
  deriveAgentRunSummary,
  getNextQueuedMessageId,
  reconcileTransientMessages,
  waitForAbortable,
} from './agentQueue';
import type { ChatMessage, Conversation } from './types';

const assistant = (
  id: string,
  status: ChatMessage['status'],
  stage?: ChatMessage['stage'],
): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  createdAt: Number(id.replace(/\D/g, '')) || 0,
  status,
  stage,
});

describe('agent queue state', () => {
  it('summarises one active request and later queued requests', () => {
    expect(deriveAgentRunSummary([
      assistant('m1', 'running', 'waiting-first-token'),
      assistant('m2', 'queued', 'queued'),
      assistant('m3', 'queued', 'queued'),
    ])).toEqual({
      activeMessageId: 'm1',
      status: 'running',
      stage: 'waiting-first-token',
      label: '正在连接 Agent',
      orbState: 'listening',
      queuedCount: 2,
    });
  });

  it('returns the first queued request in message order', () => {
    expect(getNextQueuedMessageId([
      assistant('m2', 'queued', 'queued'),
      assistant('m3', 'queued', 'queued'),
    ])).toBe('m2');
  });

  it('isolates active summaries by conversation', () => {
    const conversations = [
      { id: 'c1', messages: [assistant('m1', 'streaming', 'streaming')] },
      { id: 'c2', messages: [assistant('m2', 'complete')] },
    ] as Conversation[];

    expect([...deriveActiveConversationIds(conversations)]).toEqual(['c1']);
  });

  it('settles transient restored requests instead of resurrecting them', () => {
    expect(reconcileTransientMessages([
      assistant('m1', 'running', 'waiting-first-token'),
      assistant('m2', 'queued', 'queued'),
    ]).map(({ status, stage }) => ({ status, stage }))).toEqual([
      { status: 'stopped', stage: undefined },
      { status: 'stopped', stage: undefined },
    ]);
  });

  it('keeps the next queued request stable after the active request settles', () => {
    const before = [assistant('m1', 'running'), assistant('m2', 'queued', 'queued')];
    expect(getNextQueuedMessageId(before)).toBe('m2');

    const after = before.map((message) => message.id === 'm1'
      ? { ...message, status: 'complete' as const }
      : message);

    expect(getNextQueuedMessageId(after)).toBe('m2');
  });
});

interface TestRequest {
  conversationId: string;
  messageId: string;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ConversationRequestCoordinator', () => {
  it('runs requests sequentially within one conversation', async () => {
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request) => {
      started.push(request.messageId);
      await (request.messageId === 'm1' ? first.promise : second.promise);
    });

    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm2' });

    expect(started).toEqual(['m1']);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(started).toEqual(['m1', 'm2']);

    second.resolve();
    await second.promise;
  });

  it('stops only the active request and then starts the next queued request', async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>((request, signal) => new Promise<void>((resolve, reject) => {
      started.push(request.messageId);
      signal.addEventListener('abort', () => {
        stopped.push(request.messageId);
        reject(new DOMException('Stopped', 'AbortError'));
      }, { once: true });
      if (request.messageId === 'm2') resolve();
    }));

    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm2' });
    coordinator.stop('c1');
    await Promise.resolve();
    await Promise.resolve();

    expect(stopped).toEqual(['m1']);
    expect(started).toEqual(['m1', 'm2']);
  });

  it('allows different conversations to run independently', () => {
    const started: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request) => {
      started.push(`${request.conversationId}:${request.messageId}`);
      await new Promise<void>(() => undefined);
    });

    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.enqueue({ conversationId: 'c2', messageId: 'm2' });

    expect(started).toEqual(['c1:m1', 'c2:m2']);
    coordinator.clear();
  });
});

describe('waitForAbortable', () => {
  it('rejects immediately when a queued preparation is aborted', async () => {
    const preparation = deferred();
    const controller = new AbortController();
    const waiting = waitForAbortable(preparation.promise, controller.signal);

    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    preparation.resolve();
  });
});
