import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkosConversation,
  executeWorkosStream,
  uploadWorkosFile,
  WorkosApiError,
} from './workosClient';

function eventStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public v1 transport primitives', () => {
  it('keeps the official conversation creation contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/oapi/agent/v1/agents/');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer AP_token' });
      return new Response(JSON.stringify({ data: { conversationUuid: 'conversation-v1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(createWorkosConversation('AP_token')).resolves.toBe('conversation-v1');
  });

  it('keeps reading text from the official execute stream', async () => {
    const inner = {
      type: 'message.part.updated',
      properties: { part: { id: 'answer', type: 'text', text: 'v1 answer' } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => eventStream([
      `data: ${JSON.stringify({ data: JSON.stringify(inner) })}\n\n`,
      `event: xybot-stream-complete\ndata: ${JSON.stringify({})}\n\n`,
    ])));
    const onText = vi.fn();

    await executeWorkosStream('AP_token', 'conversation-v1', { content: 'question' }, { onText });
    expect(onText).toHaveBeenLastCalledWith('v1 answer');
  });
});

describe('uploadWorkosFile', () => {
  it('uploads multipart data without overriding the browser boundary', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ Authorization: 'Bearer token-1' });
      expect(init?.body).toBeInstanceOf(FormData);
      const body = init?.body as FormData;
      expect((body.get('file') as File).name).toBe('notes.md');
      return new Response(JSON.stringify({ data: { fileReadUrl: 'https://files.example/notes.md' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    await expect(uploadWorkosFile('token-1', file)).resolves.toEqual({
      fileReadUrl: 'https://files.example/notes.md',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://power-api.yingdao.com/oapi/power/v1/file/upload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a successful response without a readable file URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });
    await expect(uploadWorkosFile('token-1', file)).rejects.toEqual(
      expect.objectContaining<Partial<WorkosApiError>>({
        name: 'WorkosApiError',
        message: '附件上传成功，但服务没有返回可读取的文件地址。',
      }),
    );
  });
});
