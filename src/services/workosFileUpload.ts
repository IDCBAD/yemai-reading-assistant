import type { InternalV2Credentials, WorkosConnectionSettings } from './workosConnection';
import {
  validateInternalV2Credentials,
  validatePublicApiToken,
} from './workosConnection';
import { uploadWorkosFile } from './workosClient';
import {
  connectionError,
  parseJsonEnvelope,
  WORKOS_API_ORIGIN,
  WorkosApiError,
} from './workosTransport';

const WORKOS_FILE_STORAGE_ORIGIN = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com';

export interface WorkosFileUploadResult {
  fileReadUrl: string;
}

export interface WorkosFileUploader {
  upload(file: File, signal?: AbortSignal): Promise<WorkosFileUploadResult>;
}

type UploadTempData = {
  uploadUrl?: unknown;
  readUrl?: unknown;
};

function fileExtension(filename: string) {
  return filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
}

function contentTypeForFile(file: File) {
  if (file.type.trim()) return file.type.trim().toLowerCase();
  const types: Record<string, string> = {
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    htm: 'text/html',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return types[fileExtension(file.name)] ?? 'application/octet-stream';
}

function validatedWorkosStorageUrl(value: unknown, field: '上传' | '读取') {
  if (typeof value !== 'string' || !value) {
    throw new WorkosApiError(`WorkOS 没有返回可用的文件${field}地址。`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkosApiError(`WorkOS 返回了无法识别的文件${field}地址。`);
  }
  if (url.origin !== WORKOS_FILE_STORAGE_ORIGIN) {
    throw new WorkosApiError(`WorkOS 返回了未受信任的文件${field}地址。`);
  }
  return url.toString();
}

export async function uploadInternalWorkosFile(
  credentials: InternalV2Credentials,
  file: File,
  signal?: AbortSignal,
): Promise<WorkosFileUploadResult> {
  const { internalV2Headers } = await import('./workosInternalV2');
  const contentType = contentTypeForFile(file);
  let tempResponse: Response;
  try {
    tempResponse = await fetch(`${WORKOS_API_ORIGIN}/api/agent/v1/module/file/getUploadTempUrl`, {
      method: 'POST',
      headers: {
        ...internalV2Headers(credentials, '*/*'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileOriginScene: 'file_embedding',
        fileType: 'file',
        fileName: file.name,
        contentType,
        fileSize: file.size,
        generateUniqueKey: true,
        preserveFileName: true,
      }),
      signal,
    });
  } catch (error) {
    throw connectionError(error, '无法申请 WorkOS 文件上传地址，请检查网络后重试。');
  }

  const tempBody = await parseJsonEnvelope<UploadTempData>(tempResponse, 'internal-v2');
  const uploadUrl = validatedWorkosStorageUrl(tempBody.data?.uploadUrl, '上传');
  const readUrl = validatedWorkosStorageUrl(tempBody.data?.readUrl, '读取');

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
      signal,
    });
  } catch (error) {
    throw connectionError(error, '无法上传附件到 WorkOS 文件存储，请检查网络后重试。');
  }
  if (!uploadResponse.ok) {
    throw new WorkosApiError(
      uploadResponse.status === 401 || uploadResponse.status === 403
        ? 'WorkOS 临时上传地址无效或已过期，请重新添加附件。'
        : `WorkOS 文件存储上传失败（HTTP ${uploadResponse.status}）。`,
      uploadResponse.status,
    );
  }

  return { fileReadUrl: readUrl };
}

class PublicV1FileUploader implements WorkosFileUploader {
  constructor(private readonly token: string) {}

  upload(file: File, signal?: AbortSignal) {
    return uploadWorkosFile(this.token, file, signal);
  }
}

class InternalWebFileUploader implements WorkosFileUploader {
  constructor(private readonly credentials: InternalV2Credentials) {}

  upload(file: File, signal?: AbortSignal) {
    return uploadInternalWorkosFile(this.credentials, file, signal);
  }
}

export function isWorkosFileUploadConfigured(settings: WorkosConnectionSettings) {
  return settings.transport === 'internal-v2'
    ? validateInternalV2Credentials(settings.internalV2) === null
    : validatePublicApiToken(settings.publicApiToken) === null;
}

export function createWorkosFileUploader(settings: WorkosConnectionSettings): WorkosFileUploader {
  if (settings.transport === 'internal-v2') {
    const error = validateInternalV2Credentials(settings.internalV2);
    if (error) throw new WorkosApiError(error);
    return new InternalWebFileUploader(settings.internalV2);
  }
  const error = validatePublicApiToken(settings.publicApiToken);
  if (error) throw new WorkosApiError(error);
  return new PublicV1FileUploader(settings.publicApiToken);
}
