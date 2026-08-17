import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkosConnectionSettings } from './workosConnection';
import { WORKOS_CONNECTION_SETTINGS_VERSION } from './workosConnection';
import {
  createWorkosFileUploader,
  isWorkosFileUploadConfigured,
  uploadInternalWorkosFile,
} from './workosFileUpload';

const credentials = {
  accessToken: 'login-token',
  userUuid: 'user-1',
  organizationUuid: 'org-1',
};

const internalSettings: WorkosConnectionSettings = {
  schemaVersion: WORKOS_CONNECTION_SETTINGS_VERSION,
  agentUuid: '11111111-1111-4111-8111-111111111111',
  transport: 'internal-v2',
  publicApiToken: '',
  internalV2: credentials,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('internal WorkOS file upload', () => {
  it('requests a signed URL, uploads the original file with PUT, and returns readUrl', async () => {
    const signedUrl = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com/agent/module/file/page.html?Expires=1&Signature=test';
    const readUrl = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com/agent/module/file/page.html';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/agent/v1/module/file/getUploadTempUrl')) {
        const headers = init?.headers as Record<string, string>;
        expect(init?.method).toBe('POST');
        expect(headers.Authorization).toBe('Bearer login-token');
        expect(headers.Accept).toBe('*/*');
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['x-user-uuid']).not.toBe('user-1');
        expect(headers['x-organization-uuid']).not.toBe('org-1');
        expect(JSON.parse(String(init?.body))).toEqual({
          fileOriginScene: 'file_embedding',
          fileType: 'file',
          fileName: 'page.html',
          contentType: 'text/html',
          fileSize: 11,
          generateUniqueKey: true,
          preserveFileName: true,
        });
        return new Response(JSON.stringify({
          code: 200,
          success: true,
          data: { uploadUrl: signedUrl, readUrl },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(url).toBe(signedUrl);
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toEqual({ 'Content-Type': 'text/html' });
      expect(init?.body).toBeInstanceOf(File);
      expect((init?.body as File).name).toBe('page.html');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['<h1>hi</h1>'], 'page.html', { type: 'text/html' });
    await expect(uploadInternalWorkosFile(credentials, file)).resolves.toEqual({ fileReadUrl: readUrl });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an upload destination outside the trusted WorkOS storage origin', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      success: true,
      data: {
        uploadUrl: 'https://example.com/file.html?signature=test',
        readUrl: 'https://example.com/file.html',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['hello'], 'page.html', { type: 'text/html' });
    await expect(uploadInternalWorkosFile(credentials, file)).rejects.toEqual(expect.objectContaining({
      message: 'WorkOS 返回了未受信任的文件上传地址。',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an expired or rejected signed upload URL without exposing it', async () => {
    const signedUrl = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com/agent/module/file/page.html?Signature=private';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('getUploadTempUrl')) {
        return new Response(JSON.stringify({
          code: 200,
          success: true,
          data: {
            uploadUrl: signedUrl,
            readUrl: 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com/agent/module/file/page.html',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(null, { status: 403 });
    }));

    await expect(uploadInternalWorkosFile(
      credentials,
      new File(['hello'], 'page.html', { type: 'text/html' }),
    )).rejects.toEqual(expect.objectContaining({
      message: 'WorkOS 临时上传地址无效或已过期，请重新添加附件。',
      status: 403,
    }));
  });
});

describe('file uploader selection', () => {
  it('uses the active internal connection without requiring a public API token', () => {
    expect(isWorkosFileUploadConfigured(internalSettings)).toBe(true);
    expect(createWorkosFileUploader(internalSettings)).toBeDefined();
  });

  it('requires the active channel credentials', () => {
    expect(isWorkosFileUploadConfigured({
      ...internalSettings,
      internalV2: { ...credentials, accessToken: '' },
    })).toBe(false);
    expect(isWorkosFileUploadConfigured({
      ...internalSettings,
      transport: 'public-v1',
      publicApiToken: '',
    })).toBe(false);
  });
});
