import { JSEncrypt } from 'jsencrypt';
import type { InternalV2Credentials } from './workosConnection';
import { WorkosSseParser, type WorkosSseCallbacks } from './workosSse';
import {
  connectionError,
  isAbortError,
  parseJsonEnvelope,
  requireEventStream,
  WORKOS_API_ORIGIN,
  WorkosApiError,
  type ExecuteRequest,
  type WorkosInterruptAnswers,
  type WorkosTransport,
} from './workosTransport';

const INTERNAL_V2_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+qviO5tdUjk00eaTkcE
9x8c7fEZ8LLaV7p9IzFHnNXxPW+ynQFrbEDaGJ6Oi7RZowY3BFyEHrsEkI7NXN/s
Xo3jccdaqZop5rQTFxMk4Y1LF7bJFKkcIIqRnRQ/y//RNMB4l15LK3ugrNCvHauC
6Q8bXIcCq/glNPnlK+ZQY4ezQnyLm2r856IHsEeZ3uZfcYRlMm12xHt9XDMZLG6o
VT/jdgS3h0L5c5S459DL9YiqQuDOQEojhjzvhAUljGVB6op0PqyUgL4VjvXPI0Jf
YWk7HCl6dDnEIiXy/R8FtG5bAdP4uKR+aea+AIxjnhCwvoEa1GG+L6T0OPdzZcKy
1QIDAQAB
-----END PUBLIC KEY-----`;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findRunId(value: unknown): string | undefined {
  if (isRecord(value)) {
    if (typeof value.runId === 'string' && value.runId) return value.runId;
    for (const child of Object.values(value)) {
      const found = findRunId(child);
      if (found) return found;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const found = findRunId(child);
      if (found) return found;
    }
  } else if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try {
      return findRunId(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function encryptIdentity(value: string) {
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(INTERNAL_V2_RSA_PUBLIC_KEY);
  const encrypted = encryptor.encrypt(value);
  if (!encrypted) throw new WorkosApiError('无法生成 WorkOS v2 身份凭证，请更新连接配置。');
  return encrypted;
}

function encodedPathIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new WorkosApiError(`${label} 无法识别，请重新发起当前问题。`);
  }
  return encodeURIComponent(normalized);
}

async function parseOptionalJsonEnvelope(response: Response) {
  const body = await response.text();
  if (!body.trim()) {
    if (!response.ok) throw new WorkosApiError(`WorkOS 请求失败（HTTP ${response.status}）。`, response.status);
    return;
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('json')) {
    if (!response.ok) throw new WorkosApiError(`WorkOS 请求失败（HTTP ${response.status}）。`, response.status);
    return;
  }
  await parseJsonEnvelope<unknown>(new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }), 'internal-v2');
}

export function internalV2Headers(
  credentials: InternalV2Credentials,
  accept = 'application/json',
) {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    'x-organization-uuid': encryptIdentity(credentials.organizationUuid),
    'x-user-uuid': encryptIdentity(credentials.userUuid),
    'Content-Type': 'application/json; charset=utf-8',
    Accept: accept,
  };
}

export class InternalV2Transport implements WorkosTransport {
  readonly kind = 'internal-v2' as const;

  constructor(
    private readonly credentials: InternalV2Credentials,
    private readonly agentUuid: string,
  ) {}

  async createConversation(signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(`${WORKOS_API_ORIGIN}/api/agent/v2/conversations/create`, {
        method: 'POST',
        headers: internalV2Headers(this.credentials),
        body: JSON.stringify({
          agentType: 'custom_agent',
          agentUuid: this.agentUuid,
          mode: 'draft',
        }),
        signal,
      });
    } catch (error) {
      throw connectionError(error);
    }

    const body = await parseJsonEnvelope<{ conversationUuid?: unknown }>(response, this.kind);
    const conversationUuid = body.data?.conversationUuid;
    if (typeof conversationUuid !== 'string' || !conversationUuid) {
      throw new WorkosApiError('WorkOS v2 返回了无法识别的会话数据。');
    }
    return conversationUuid;
  }

  async executeStream(
    conversationUuid: string,
    request: ExecuteRequest,
    callbacks: WorkosSseCallbacks,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    signal?.addEventListener('abort', onAbort, { once: true });

    const encodedUuid = encodeURIComponent(conversationUuid);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      let subscriptionResponse: Response;
      try {
        subscriptionResponse = await fetch(
          `${WORKOS_API_ORIGIN}/api/agent/v2/conversations/${encodedUuid}/events/messages/subscribe`,
          {
            method: 'GET',
            headers: {
              ...internalV2Headers(this.credentials, 'text/event-stream'),
              'Cache-Control': 'no-cache',
            },
            signal: controller.signal,
          },
        );
      } catch (error) {
        throw connectionError(error, '无法建立 WorkOS v2 消息订阅，请检查网络后重试。');
      }
      const stream = await requireEventStream(subscriptionResponse, this.kind);
      reader = stream.getReader();

      const parts: Array<Record<string, string>> = [{ type: 'text', text: request.content }];
      for (const attachment of request.attachments ?? []) {
        parts.push({
          type: 'file',
          url: attachment.url,
          filename: attachment.filename,
          ...(attachment.mime ? { mime: attachment.mime } : {}),
        });
      }

      let submitResponse: Response;
      try {
        submitResponse = await fetch(
          `${WORKOS_API_ORIGIN}/api/agent/v2/conversations/${encodedUuid}/queue/submit`,
          {
            method: 'POST',
            headers: internalV2Headers(this.credentials),
            body: JSON.stringify({ parts }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        throw connectionError(error);
      }
      const submitBody = await parseJsonEnvelope<unknown>(submitResponse, this.kind);
      const expectedRunId = findRunId(submitBody.data);
      if (!expectedRunId) throw new WorkosApiError('WorkOS v2 已接收问题，但没有返回运行标识。');

      const parser = new WorkosSseParser(callbacks, { expectedRunId });
      const decoder = new TextDecoder('utf-8');
      while (!parser.isComplete) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.finish();
      if (!parser.isComplete) {
        throw new WorkosApiError('WorkOS v2 消息订阅意外断开，请重试。');
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw connectionError(error);
    } finally {
      controller.abort();
      signal?.removeEventListener('abort', onAbort);
      reader?.releaseLock();
    }
  }

  async replyInterrupt(
    conversationUuid: string,
    requestId: string,
    answers: WorkosInterruptAnswers,
    signal?: AbortSignal,
  ) {
    await this.resolveInterrupt(conversationUuid, requestId, 'reply', answers, signal);
  }

  async rejectInterrupt(conversationUuid: string, requestId: string, signal?: AbortSignal) {
    await this.resolveInterrupt(conversationUuid, requestId, 'reject', {}, signal);
  }

  private async resolveInterrupt(
    conversationUuid: string,
    requestId: string,
    action: 'reply' | 'reject',
    body: WorkosInterruptAnswers | Record<string, never>,
    signal?: AbortSignal,
  ) {
    const encodedUuid = encodedPathIdentifier(conversationUuid, 'WorkOS 会话');
    const encodedRequestId = encodedPathIdentifier(requestId, '表单请求');
    let response: Response;
    try {
      response = await fetch(
        `${WORKOS_API_ORIGIN}/api/agent/v2/conversations/${encodedUuid}/interrupt/${encodedRequestId}/${action}`,
        {
          method: 'POST',
          headers: internalV2Headers(this.credentials),
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      throw connectionError(error, action === 'reply' ? '无法提交当前选择，请重试。' : '无法跳过当前表单，请重试。');
    }
    await parseOptionalJsonEnvelope(response);
  }
}
