import { WorkosSseParser, type WorkosSseCallbacks } from './workosSse';
import {
  errorMessageForStatus,
  DEFAULT_WORKOS_AGENT_UUID,
  WORKOS_API_ORIGIN,
  WorkosApiError,
  type ExecuteRequest,
  type WorkosTransport,
} from './workosTransport';

export { DEFAULT_WORKOS_AGENT_UUID, WorkosApiError } from './workosTransport';
export type { ExecuteRequest } from './workosTransport';

async function responseError(response: Response) {
  const statusMessage = errorMessageForStatus(response.status, 'public-v1');
  if (statusMessage) return statusMessage;
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

export async function createWorkosConversation(
  token: string,
  signal?: AbortSignal,
  agentUuid = DEFAULT_WORKOS_AGENT_UUID,
) {
  let response: Response;
  try {
    response = await fetch(`${WORKOS_API_ORIGIN}/oapi/agent/v1/agents/${encodeURIComponent(agentUuid)}/conversations`, {
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

export async function uploadWorkosFile(token: string, file: File, signal?: AbortSignal) {
  const body = new FormData();
  body.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`${WORKOS_API_ORIGIN}/oapi/power/v1/file/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WorkosApiError('附件上传失败，请检查网络后重试。');
  }

  if (!response.ok) throw new WorkosApiError(await responseError(response), response.status);
  let responseBody: { data?: { fileReadUrl?: unknown } };
  try {
    responseBody = (await response.json()) as { data?: { fileReadUrl?: unknown } };
  } catch {
    throw new WorkosApiError('附件上传成功，但服务返回了无法识别的数据。');
  }
  const fileReadUrl = responseBody.data?.fileReadUrl;
  if (typeof fileReadUrl !== 'string' || !fileReadUrl) {
    throw new WorkosApiError('附件上传成功，但服务没有返回可读取的文件地址。');
  }
  return { fileReadUrl };
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
    response = await fetch(`${WORKOS_API_ORIGIN}/oapi/agent/v1/conversations/${encodeURIComponent(conversationUuid)}/execute/stream`, {
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

export class PublicV1Transport implements WorkosTransport {
  readonly kind = 'public-v1' as const;

  constructor(
    private readonly token: string,
    private readonly agentUuid = DEFAULT_WORKOS_AGENT_UUID,
  ) {}

  createConversation(signal?: AbortSignal) {
    return createWorkosConversation(this.token, signal, this.agentUuid);
  }

  executeStream(
    conversationUuid: string,
    request: ExecuteRequest,
    callbacks: WorkosSseCallbacks,
    signal?: AbortSignal,
  ) {
    return executeWorkosStream(this.token, conversationUuid, request, callbacks, signal);
  }
}
