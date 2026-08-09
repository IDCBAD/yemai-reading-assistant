import { WorkosSseParser, type WorkosSseCallbacks } from './workosSse';

export const WORKOS_AGENT_ID = '409b06a1-2e2a-4d8c-af3c-ec831c0c6449';
const API_ORIGIN = 'https://power-api.yingdao.com';

export interface ExecuteRequest {
  content: string;
  attachments?: Array<{ url: string; filename: string }>;
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

async function responseError(response: Response) {
  if (response.status === 401 || response.status === 403) return 'Token 无效或已过期，请在设置中更新。';
  if (response.status === 404) return 'WorkOS 会话不存在，请新建对话后重试。';
  if (response.status === 429) return '请求过于频繁，请稍后再试。';
  if (response.status >= 500) return 'WorkOS 服务暂时不可用，请稍后再试。';
  try {
    const body = (await response.json()) as { message?: unknown; msg?: unknown };
    const message = typeof body.message === 'string' ? body.message : typeof body.msg === 'string' ? body.msg : null;
    if (message) return `WorkOS 请求失败：${message}`;
  } catch {
    // Ignore bodies that are not JSON. Never include request headers or Token in errors.
  }
  return `WorkOS 请求失败（HTTP ${response.status}）。`;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export async function createWorkosConversation(token: string, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/oapi/agent/v1/agents/${WORKOS_AGENT_ID}/conversations`, {
      method: 'POST',
      headers: headers(token),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WorkosApiError('无法连接 WorkOS，请检查网络后重试。');
  }
  if (!response.ok) throw new WorkosApiError(await responseError(response), response.status);
  const body = (await response.json()) as { data?: { conversationUuid?: unknown } };
  const uuid = body.data?.conversationUuid;
  if (typeof uuid !== 'string' || !uuid) throw new WorkosApiError('WorkOS 返回了无法识别的会话数据。');
  return uuid;
}

export async function executeWorkosStream(
  token: string,
  conversationUuid: string,
  request: ExecuteRequest,
  callbacks: WorkosSseCallbacks,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/oapi/agent/v1/conversations/${encodeURIComponent(conversationUuid)}/execute/stream`, {
      method: 'POST',
      headers: {
        ...headers(token),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ content: request.content, attachments: request.attachments ?? [] }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WorkosApiError('无法连接 WorkOS，请检查网络后重试。');
  }
  if (!response.ok) throw new WorkosApiError(await responseError(response), response.status);
  if (!response.body) throw new WorkosApiError('浏览器没有收到 WorkOS 的流式响应。');

  const parser = new WorkosSseParser(callbacks);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } finally {
    reader.releaseLock();
  }
}
