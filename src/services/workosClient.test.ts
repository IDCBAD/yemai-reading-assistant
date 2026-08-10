import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadWorkosFile, WorkosApiError } from './workosClient';

afterEach(() => {
  vi.unstubAllGlobals();
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
