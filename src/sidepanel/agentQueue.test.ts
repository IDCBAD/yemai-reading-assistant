import { describe, expect, it } from 'vitest';
import { WORKOS_USER_STOP_REASON } from '../services/workosTransport';
import {
  ConversationRequestCoordinator,
  deriveActiveConversationIds,
  deriveAgentRunSummary,
  deriveMessageRunNote,
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
  it('keeps a running summary during output and clears it after completion', () => {
    const message = { ...assistant('m1', 'streaming', 'streaming'), content: '第一段回答' };
    expect(deriveAgentRunSummary([message])?.label).toBe('正在回答');
    expect(deriveAgentRunSummary([{ ...message, status: 'complete' }])).toBeNull();
    expect(deriveAgentRunSummary([{ ...message, status: 'stopped' }])).toBeNull();
    expect(deriveAgentRunSummary([{ ...message, status: 'failed' }])).toBeNull();
  });
  it('keeps the assistant message observable before the first visible token', () => {
    expect(deriveMessageRunNote(assistant('m1', 'running', 'waiting-first-token'))).toEqual({
      kind: 'running',
      copy: 'Agent 正在思考…',
    });
    expect(deriveMessageRunNote(assistant('m1', 'streaming', 'streaming'))).toEqual({
      kind: 'running',
      copy: '正在组织回答…',
    });
  });

  it('hands observability over to the stream cursor after text arrives', () => {
    expect(deriveMessageRunNote({
      ...assistant('m1', 'streaming', 'streaming'),
      content: '第一段回答',
    })).toBeNull();
  });

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

  it('presents an A2UI interrupt as waiting for the user', () => {
    expect(deriveAgentRunSummary([
      assistant('m1', 'streaming', 'waiting-user-input'),
    ])).toMatchObject({
      stage: 'waiting-user-input',
      label: '等待你的选择',
      orbState: 'listening',
    });
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
  it('retains the conversation lock across cleanup until a pending manual stop settles', async () => {
    const remoteStop = deferred();
    const started: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request, signal) => {
      started.push(request.messageId);
      if (request.messageId !== 'm1') return;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await remoteStop.promise;
    });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.stop('c1', 'm1');
    coordinator.clear();
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm2' });
    expect(coordinator.stop('c1', 'stale-message')).toBe(false);
    await Promise.resolve();
    expect(started).toEqual(['m1']);
    remoteStop.resolve();
    await remoteStop.promise;
    await Promise.resolve();
    expect(started).toEqual(['m1', 'm2']);
  });

  it('does not release a replacement execution when an older cleared runner settles', async () => {
    const oldRun = deferred();
    const newRun = deferred();
    let attempts = 0;
    const started: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request) => {
      started.push(request.messageId);
      attempts += 1;
      if (attempts === 1) await oldRun.promise;
      else if (attempts === 2) await newRun.promise;
    });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'same-message' });
    coordinator.clear();
    coordinator.enqueue({ conversationId: 'c1', messageId: 'same-message' });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'next-message' });
    oldRun.resolve();
    await oldRun.promise;
    await Promise.resolve();
    expect(started).toEqual(['same-message', 'same-message']);
    newRun.resolve();
    await newRun.promise;
    await Promise.resolve();
    expect(started).toEqual(['same-message', 'same-message', 'next-message']);
  });

  it('waits for remote stop settlement before starting another request and ignores repeat stops', async () => {
    const remoteStop = deferred();
    const started: string[] = [];
    let stopCount = 0;
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request, signal) => {
      started.push(request.messageId);
      if (request.messageId !== 'm1') return;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
        expect(signal.reason).toBe(WORKOS_USER_STOP_REASON);
        stopCount += 1;
        resolve();
      }, { once: true }));
      await remoteStop.promise;
    });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm2' });
    expect(coordinator.stop('c1')).toBe(true);
    expect(coordinator.stop('c1')).toBe(false);
    await Promise.resolve();
    expect(started).toEqual(['m1']);
    expect(stopCount).toBe(1);
    remoteStop.resolve();
    await remoteStop.promise;
    await Promise.resolve();
    expect(started).toEqual(['m1', 'm2']);
  });

  it('can discard one conversation queue after an unconfirmed remote stop', async () => {
    const gate = deferred();
    const started: string[] = [];
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (request) => {
      started.push(request.messageId);
      if (request.messageId === 'm1') await gate.promise;
    });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm2' });
    coordinator.enqueue({ conversationId: 'c2', messageId: 'm3' });
    expect(coordinator.discardQueued('c1').map((request) => request.messageId)).toEqual(['m2']);
    gate.resolve();
    await gate.promise;
    await Promise.resolve();
    expect(started).toEqual(['m1', 'm3']);
  });

  it('keeps ordinary cleanup distinct from a user stop', () => {
    let reason: unknown;
    const coordinator = new ConversationRequestCoordinator<TestRequest>(async (_request, signal) => {
      signal.addEventListener('abort', () => { reason = signal.reason; }, { once: true });
      await new Promise<void>(() => undefined);
    });
    coordinator.enqueue({ conversationId: 'c1', messageId: 'm1' });
    coordinator.clear();
    expect(reason).not.toBe(WORKOS_USER_STOP_REASON);
    expect(reason).toMatchObject({ name: 'AbortError' });
  });

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
