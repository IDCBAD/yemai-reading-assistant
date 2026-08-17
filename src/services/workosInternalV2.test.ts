import { afterEach, describe, expect, it, vi } from 'vitest';
import { InternalV2Transport } from './workosInternalV2';

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
  vi.unstubAllGlobals();
});

describe('InternalV2Transport', () => {
  it('creates a draft custom-agent conversation with encrypted identity headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestHeaders = init?.headers as Record<string, string>;
      expect(requestHeaders.Authorization).toBe('Bearer login-token');
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

  it('subscribes before submit and ignores stale completion events', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/events/messages/subscribe')) {
        expect(init?.method).toBe('GET');
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
});
