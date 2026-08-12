import type { WorkosSseCallbacks } from './workosSse';

export const WORKOS_AGENT_ID = '409b06a1-2e2a-4d8c-af3c-ec831c0c6449';
export const WORKOS_API_ORIGIN = 'https://power-api.yingdao.com';

export type WorkosTransportKind = 'public-v1' | 'internal-v2';

export interface ExecuteRequest {
  content: string;
  attachments?: Array<{ url: string; filename: string; mime?: string }>;
}

export interface WorkosTransport {
  readonly kind: WorkosTransportKind;
  createConversation(signal?: AbortSignal): Promise<string>;
  executeStream(
    conversationUuid: string,
    request: ExecuteRequest,
    callbacks: WorkosSseCallbacks,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class WorkosApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WorkosApiError';
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function connectionError(error: unknown, fallback = '无法连接 WorkOS，请检查网络后重试。') {
  if (isAbortError(error) || error instanceof WorkosApiError) return error;
  return new WorkosApiError(fallback);
}

type WorkosEnvelope = {
  code?: unknown;
  success?: unknown;
  data?: unknown;
  message?: unknown;
  msg?: unknown;
};

function businessCode(body: WorkosEnvelope) {
  if (typeof body.code === 'number') return body.code;
  return typeof body.code === 'string' && /^\d+$/.test(body.code) ? Number(body.code) : undefined;
}

export function errorMessageForStatus(status?: number, channel: WorkosTransportKind = 'public-v1') {
  if (status === 401 || status === 403) {
    return channel === 'internal-v2'
      ? 'WorkOS v2 登录凭证无效或已过期，请在设置中更新。'
      : 'Token 无效或已过期，请在设置中更新。';
  }
  if (status === 404) return 'WorkOS 会话不存在，请新建对话后重试。';
  if (status === 429) return '请求过于频繁，请稍后再试。';
  if (status !== undefined && status >= 500) return 'WorkOS 服务暂时不可用，请稍后再试。';
  return undefined;
}

export async function parseJsonEnvelope<T>(
  response: Response,
  channel: WorkosTransportKind,
): Promise<{ code?: unknown; success?: unknown; data?: T; message?: unknown; msg?: unknown }> {
  let body: WorkosEnvelope & { data?: T };
  try {
    body = (await response.json()) as WorkosEnvelope & { data?: T };
  } catch {
    throw new WorkosApiError(
      errorMessageForStatus(response.status, channel)
        ?? `WorkOS 返回了无法识别的数据（HTTP ${response.status}）。`,
      response.status,
    );
  }

  const code = businessCode(body);
  const failed = !response.ok || body.success === false || (code !== undefined && code !== 0 && code !== 200);
  if (failed) {
    const detail = typeof body.message === 'string'
      ? body.message
      : typeof body.msg === 'string'
        ? body.msg
        : undefined;
    throw new WorkosApiError(
      errorMessageForStatus(code ?? response.status, channel)
        ?? (detail ? `WorkOS 请求失败：${detail}` : `WorkOS 请求失败（HTTP ${response.status}）。`),
      code ?? response.status,
    );
  }
  return body;
}

export async function requireEventStream(response: Response, channel: WorkosTransportKind) {
  if (!response.ok) {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) await parseJsonEnvelope(response, channel);
    throw new WorkosApiError(
      errorMessageForStatus(response.status, channel) ?? `WorkOS 流式连接失败（HTTP ${response.status}）。`,
      response.status,
    );
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    await parseJsonEnvelope(response, channel);
    throw new WorkosApiError('WorkOS 没有建立消息订阅，请稍后重试。', response.status);
  }
  if (!response.body) throw new WorkosApiError('浏览器没有收到 WorkOS 的流式响应。');
  return response.body;
}
