import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalV2Transport } from './workosInternalV2';
import { WORKOS_USER_STOP_REASON, WorkosRemoteStopAccepted, WorkosRemoteStopError } from './workosTransport';

// Network/control-flow tests use synthetic identity encryption; the independent
// workosIdentityEncryption tests verify RSA padding and cryptographic compatibility.
vi.mock('./workosIdentityEncryption', () => ({
  encryptWorkosIdentity: (value: string) => `encrypted-${value}`,
}));

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function messageEvent(runId: string, event: unknown) {
  return sseEvent('message', { runId, data: JSON.stringify(event) });
}

function eventStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

const credentials = {
  accessToken: 'login-token',
  userUuid: 'user-1',
  organizationUuid: 'org-1',
};
const agentUuid = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function submittedResponse() {
  return new Response(JSON.stringify({ success: true, code: 200, data: { runId: 'run-current' } }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function waitingStream(onRead?: () => void) {
  return new Response(new ReadableStream<Uint8Array>({ pull() { onRead?.(); } }, { highWaterMark: 0 }), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('InternalV2Transport', () => {
  it('distinguishes a lost progress connection from a failed remote run after submission', async () => {
    const text = vi.fn();
    let reads = 0;
    const stream = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode(messageEvent('run-current', {
        type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: '已收到部分结果' } },
      })));
      else controller.error(new TypeError('Failed to fetch'));
    } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream' } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/subscribe') ? stream : submittedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'long task' }, { onText: text }))
      .rejects.toMatchObject({ name: 'WorkosProgressDisconnected', conversationUuid: 'conversation-v2', runId: 'run-current' });
    expect(text).toHaveBeenCalledWith('已收到部分结果');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/queue/submit'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/action/abort'))).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks EOF without completion as an unknown remote outcome without resubmitting or stopping', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/subscribe')
      ? eventStream([messageEvent('run-current', {
        type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: '部分回答' } },
      })]) : submittedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }))
      .rejects.toMatchObject({ name: 'WorkosProgressDisconnected', conversationUuid: 'conversation-v2', runId: 'run-current' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an unsolicited reader AbortError as disconnect rather than user cancellation', async () => {
    const stream = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      controller.error(new DOMException('Connection reset', 'AbortError'));
    } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream' } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/subscribe') ? stream : submittedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }))
      .rejects.toMatchObject({ name: 'WorkosProgressDisconnected' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['EOF', 'read error'] as const)('retains explicit remote failure before %s instead of reporting an unknown outcome', async (ending) => {
    const failure = messageEvent('run-current', { type: 'run.terminal', properties: { status: 'failed', message: '服务端明确失败' } });
    let reads = 0;
    const stream = ending === 'EOF' ? eventStream([failure]) : new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode(failure));
      else controller.error(new TypeError('Failed to fetch'));
    } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'text/event-stream' } });
    const onError = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/subscribe') ? stream : submittedResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn(), onError }))
      .rejects.toMatchObject({ name: 'WorkosApiError', message: '服务端明确失败' });
    expect(onError).toHaveBeenCalledWith('服务端明确失败');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a rejected submission distinct from loss of an accepted run progress stream', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/subscribe') ? eventStream([])
      : new Response(JSON.stringify({ code: 403, success: false }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }))
      .rejects.toMatchObject({ name: 'WorkosApiError', status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends one remote stop with current credentials and an empty body after submit', async () => {
    const controller = new AbortController();
    const reading = deferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/subscribe')) return waitingStream(() => reading.resolve());
      if (url.endsWith('/queue/submit')) {
        return submittedResponse();
      }
      expect(url).toBe('https://workos-api.yingdao.com/api/workos-agent-server/v2/conversations/conversation-v2/action/abort');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      expect(init?.signal?.aborted).toBe(false);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer login-token', 'xybot-authorization': 'login-token',
        'x-user-uuid': 'encrypted-user-1', 'x-organization-uuid': 'encrypted-org-1' });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const execution = new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal);
    const assertion = expect(execution).rejects.toBeInstanceOf(WorkosRemoteStopAccepted);
    await reading.promise;
    controller.abort(WORKOS_USER_STOP_REASON);
    await assertion;
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/action/abort'))).toHaveLength(1);
  });

  it('does not remotely stop when ordinary cleanup aborts', async () => {
    const controller = new AbortController();
    const reading = deferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/subscribe')) return waitingStream(() => reading.resolve());
      return submittedResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const execution = new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal);
    const assertion = expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    await reading.promise;
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not submit or remotely stop when stopped during subscription', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort(WORKOS_USER_STOP_REASON);
      return waitingStream();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start an already cancelled execution', async () => {
    const controller = new AbortController();
    controller.abort(WORKOS_USER_STOP_REASON);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for an in-flight submit before sending stop and for stop acknowledgement before settling', async () => {
    const controller = new AbortController();
    const submit = deferred<Response>();
    const stop = deferred<Response>();
    const submitted = deferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/subscribe')) return waitingStream();
      if (String(input).endsWith('/submit')) {
        submitted.resolve();
        expect(init?.signal?.aborted).toBe(false);
        return submit.promise;
      }
      return stop.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;
    const execution = new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal);
    const assertion = expect(execution).rejects.toBeInstanceOf(WorkosRemoteStopAccepted).then(() => { settled = true; });
    await submitted.promise;
    controller.abort(WORKOS_USER_STOP_REASON);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    submit.resolve(submittedResponse());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    stop.resolve(new Response(null, { status: 204 }));
    await assertion;
  });

  it('does not abort a conversation when the pending submit was explicitly rejected', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/subscribe')) return waitingStream();
      controller.abort(WORKOS_USER_STOP_REASON);
      return new Response(JSON.stringify({ success: false, code: 200 }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports remote failure distinctly even after local cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/subscribe')) return waitingStream();
      if (String(input).endsWith('/submit')) {
        controller.abort(WORKOS_USER_STOP_REASON);
        return submittedResponse();
      }
      return new Response(null, { status: 403 });
    }));
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal))
      .rejects.toBeInstanceOf(WorkosRemoteStopError);
  });

  it('bounds waiting for a stopped submit and marks its result uncertain even if stop succeeds', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const submitted = deferred<void>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/subscribe')) return waitingStream();
      if (String(input).endsWith('/submit')) {
        submitted.resolve();
        return new Promise<Response>(() => {});
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const execution = new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal);
    const assertion = expect(execution).rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.stringContaining('提交结果不明') });
    await submitted.promise;
    controller.abort(WORKOS_USER_STOP_REASON);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([204, 200])('accepts an empty HTTP %s stop response', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2')).resolves.toBeUndefined();
  });

  it('accepts a JSON success stop response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, code: 200 }))));
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2')).resolves.toBeUndefined();
  });

  it.each([
    [200, { success: false, code: 500, message: 'login-token private detail' }],
    [200, { success: false, code: 403, message: 'login-token private detail' }],
    [401, { message: 'login-token private detail' }],
    [500, { message: 'login-token private detail' }],
  ])('rejects HTTP %s/business failure without exposing response details', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2'))
      .rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.not.stringContaining('login-token') });
  });

  it('does not expose network errors from a stop request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('login-token private detail'); }));
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2'))
      .rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.not.stringContaining('login-token') });
  });

  it('best-effort stops after a submit network failure without claiming confirmed submission', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/subscribe')) return waitingStream();
      if (String(input).endsWith('/submit')) {
        controller.abort(WORKOS_USER_STOP_REASON);
        throw new Error('network unavailable');
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).executeStream('conversation-v2', { content: 'test' }, { onText: vi.fn() }, controller.signal))
      .rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.stringContaining('提交结果不明') });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not treat an unrecognized nonempty stop response as confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login-token private detail</html>')));
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2'))
      .rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.not.stringContaining('login-token') });
  });

  it('rejects invalid conversation paths before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new InternalV2Transport(credentials, agentUuid).abortConversation('../another/action')).rejects.toThrow('会话');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out a stop request and clears its deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(() => {})));
    const assertion = expect(new InternalV2Transport(credentials, agentUuid).abortConversation('conversation-v2'))
      .rejects.toMatchObject({ name: 'WorkosRemoteStopError', message: expect.stringContaining('超时') });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('creates a draft custom-agent conversation with encrypted identity headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://workos-api.yingdao.com/api/workos-agent-server/v2/conversations/create');
      const requestHeaders = init?.headers as Record<string, string>;
      expect(requestHeaders.Authorization).toBe('Bearer login-token');
      expect(requestHeaders['xybot-authorization']).toBe('login-token');
      expect(requestHeaders['x-user-uuid']).not.toBe('user-1');
      expect(requestHeaders['x-organization-uuid']).not.toBe('org-1');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        agentType: 'custom_agent',
        mode: 'draft',
      });
      return new Response(JSON.stringify({
        success: true,
        code: 200,
        data: { conversationUuid: 'conversation-v2' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new InternalV2Transport(credentials, agentUuid);
    await expect(transport.createConversation()).resolves.toBe('conversation-v2');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      agentUuid: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('does not describe a failed conversation creation as a missing conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: 404,
      msg: 'Not Found',
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })));

    const transport = new InternalV2Transport(credentials, agentUuid);
    await expect(transport.createConversation()).rejects.toEqual(expect.objectContaining({
      message: 'WorkOS 创建会话失败（404）。请核对 Agent UUID、登录账号权限和接口地址。',
      status: 404,
    }));
  });

  it('subscribes before submit and ignores stale completion events', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/events/messages/subscribe')) {
        expect(url).toContain('https://workos-api.yingdao.com/api/workos-agent-server/v2/conversations/');
        expect(init?.method).toBe('GET');
        expect((init?.headers as Record<string, string>)['xybot-authorization']).toBe('login-token');
        return eventStream([
          sseEvent('xybot-stream-complete', { runId: 'run-old' }),
          messageEvent('run-current', {
            type: 'message.part.updated',
            properties: { part: { id: 'answer', type: 'text', text: '' } },
          }),
          messageEvent('run-current', {
            type: 'message.part.delta',
            properties: { partID: 'answer', field: 'text', delta: '多轮流式正常' },
          }),
          sseEvent('xybot-stream-complete', { runId: 'run-current' }),
        ]);
      }
      if (url.endsWith('/queue/submit')) {
        expect(url).toContain('https://workos-api.yingdao.com/api/workos-agent-server/v2/conversations/');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          parts: [{ type: 'text', text: '继续提问' }],
        });
        return new Response(JSON.stringify({
          success: true,
          code: 200,
          data: { runId: 'run-current' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onText = vi.fn();

    const transport = new InternalV2Transport(credentials, agentUuid);
    await transport.executeStream('conversation-v2', { content: '继续提问' }, { onText });

    expect(String(fetchMock.mock.calls[0]![0])).toContain('/events/messages/subscribe');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/queue/submit');
    expect(onText).toHaveBeenLastCalledWith('多轮流式正常');
  });

  it('does not expose a failed v2 credential in its error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      code: 401,
      msg: 'login-token must stay private',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const transport = new InternalV2Transport(credentials, agentUuid);
    await expect(transport.createConversation()).rejects.toEqual(expect.objectContaining({
      message: 'WorkOS v2 登录凭证无效或已过期，请在设置中更新。',
      status: 401,
    }));
  });

  it('replies to and rejects A2UI interrupts with their distinct endpoints and bodies', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ success: true, code: 200, data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const transport = new InternalV2Transport(credentials, agentUuid);
    await transport.replyInterrupt('conversation-v2', 'int_request1', {
      补充说明: '使用科技蓝',
      选择平台: ['Windows', 'Linux'],
    });
    await transport.rejectInterrupt('conversation-v2', 'int_request2');

    expect(requests[0]?.url).toContain('/conversations/conversation-v2/interrupt/int_request1/reply');
    expect(requests[0]?.url).toContain('https://workos-api.yingdao.com/api/workos-agent-server/v2/');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      补充说明: '使用科技蓝',
      选择平台: ['Windows', 'Linux'],
    });
    expect(requests[1]?.url).toContain('/conversations/conversation-v2/interrupt/int_request2/reject');
    expect(requests[1]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({});
  });
});
