import { encryptWorkosIdentity } from './workosIdentityEncryption';
import type { InternalV2Credentials } from './workosConnection';
import { WorkosSseParser, type WorkosSseCallbacks } from './workosSse';
import {
  connectionError,
  errorMessageForStatus,
  isAbortError,
  parseJsonEnvelope,
  requireEventStream,
  WORKOS_INTERNAL_V2_BASE_URL,
  WORKOS_USER_STOP_REASON,
  WorkosApiError,
  WorkosProgressDisconnected,
  WorkosRemoteStopAccepted,
  WorkosRemoteStopError,
  type ExecuteRequest,
  type WorkosInterruptAnswers,
  type WorkosTransport,
} from './workosTransport';

type UnknownRecord = Record<string, unknown>;
const STOP_TIMEOUT_MS = 10_000;

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
    'xybot-authorization': credentials.accessToken,
    'x-organization-uuid': encryptWorkosIdentity(credentials.organizationUuid),
    'x-user-uuid': encryptWorkosIdentity(credentials.userUuid),
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
      response = await fetch(`${WORKOS_INTERNAL_V2_BASE_URL}/conversations/create`, {
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

    let body: Awaited<ReturnType<typeof parseJsonEnvelope<{ conversationUuid?: unknown }>>>;
    try {
      body = await parseJsonEnvelope<{ conversationUuid?: unknown }>(response, this.kind);
    } catch (error) {
      if (error instanceof WorkosApiError && error.status === 404) {
        throw new WorkosApiError(
          'WorkOS 创建会话失败（404）。请核对 Agent UUID、登录账号权限和接口地址。',
          404,
        );
      }
      throw error;
    }
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
    const submitController = new AbortController();
    const encodedUuid = encodedPathIdentifier(conversationUuid, 'WorkOS 会话');
    const submission: { status: 'not-started' | 'pending' | 'accepted' | 'rejected' | 'unknown' } = { status: 'not-started' };
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectSubmitWait: (reason: Error) => void = () => {};
    // Only races an in-flight submit after a manual stop. Keep its rejection handled
    // even when cancellation happens outside that phase.
    const submitWaitTimeout = new Promise<never>((_, reject) => { rejectSubmitWait = reject; });
    void submitWaitTimeout.catch(() => {});
    const isUserStop = () => signal?.aborted && signal.reason === WORKOS_USER_STOP_REASON;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const onAbort = () => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      if (isUserStop() && submission.status === 'pending') {
        // Do not send abort before the server has had a chance to accept submit.
        stopTimer = setTimeout(() => {
          submitController.abort();
          rejectSubmitWait(new WorkosApiError('无法确认 WorkOS 是否已接收问题。'));
        }, STOP_TIMEOUT_MS);
      } else {
        submitController.abort();
      }
    };
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      let subscriptionResponse: Response;
      try {
        subscriptionResponse = await fetch(
          `${WORKOS_INTERNAL_V2_BASE_URL}/conversations/${encodedUuid}/events/messages/subscribe`,
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
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');

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
      submission.status = 'pending';
      try {
        const submit = async () => {
          submitResponse = await fetch(
            `${WORKOS_INTERNAL_V2_BASE_URL}/conversations/${encodedUuid}/queue/submit`,
            {
              method: 'POST',
              headers: internalV2Headers(this.credentials),
              body: JSON.stringify({ parts }),
              signal: submitController.signal,
            },
          );
          const responseCopy = submitResponse.clone();
          try {
            const body = await parseJsonEnvelope<unknown>(submitResponse, this.kind);
            submission.status = 'accepted';
            return body;
          } catch (error) {
            // A definite rejection must not cancel another run in this conversation.
            let rejected = !submitResponse.ok;
            try {
              const body: unknown = await responseCopy.json();
              if (isRecord(body)) {
                const code = typeof body.code === 'number' ? body.code : Number(body.code);
                rejected ||= body.success === false || (Number.isFinite(code) && code !== 0 && code !== 200);
              }
            } catch { /* A malformed success response leaves submission uncertain. */ }
            submission.status = rejected ? 'rejected' : 'unknown';
            throw error;
          }
        };
        const submitBody = await Promise.race([submit(), submitWaitTimeout]);
        if (stopTimer !== undefined) clearTimeout(stopTimer);
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        const expectedRunId = findRunId(submitBody.data);
        if (!expectedRunId) throw new WorkosApiError('WorkOS v2 已接收问题，但没有返回运行标识。');

        let remoteError: string | undefined;
        const parser = new WorkosSseParser({
          ...callbacks,
          onError(message) {
            remoteError = message;
            callbacks.onError?.(message);
          },
        }, { expectedRunId, previousToolCallIds: request.streamContext?.previousToolCallIds });
        const decoder = new TextDecoder('utf-8');
        while (!parser.isComplete) {
          let next: ReadableStreamReadResult<Uint8Array>;
          try {
            next = await reader.read();
          } catch (error) {
            if (signal?.aborted) throw error;
            if (remoteError !== undefined) throw new WorkosApiError(remoteError);
            throw new WorkosProgressDisconnected(conversationUuid, expectedRunId);
          }
          const { done, value } = next;
          if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.finish();
        if (!parser.isComplete) {
          if (remoteError !== undefined) throw new WorkosApiError(remoteError);
          throw new WorkosProgressDisconnected(conversationUuid, expectedRunId);
        }
      } catch (error) {
        if (submission.status === 'pending') submission.status = 'unknown';
        throw connectionError(error);
      }
    } catch (error) {
      if (isUserStop()) {
        if (submission.status === 'accepted' || submission.status === 'unknown') {
          const uncertain = submission.status === 'unknown';
          await this.abortConversation(conversationUuid);
          if (uncertain) {
            throw new WorkosRemoteStopError('已发送 WorkOS 暂停请求，但问题提交结果不明，无法确认任务已暂停。');
          }
          throw new WorkosRemoteStopAccepted();
        }
        throw new DOMException('Stopped', 'AbortError');
      }
      if (isAbortError(error)) throw error;
      throw connectionError(error);
    } finally {
      controller.abort();
      submitController.abort();
      if (stopTimer !== undefined) clearTimeout(stopTimer);
      signal?.removeEventListener('abort', onAbort);
      reader?.releaseLock();
    }
  }

  async abortConversation(conversationUuid: string, signal?: AbortSignal) {
    const encodedUuid = encodedPathIdentifier(conversationUuid, 'WorkOS 会话');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    let rejectWait: (error: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => { rejectWait = reject; });
    const timer = setTimeout(() => {
      controller.abort();
      rejectWait(new WorkosRemoteStopError('WorkOS 暂停请求超时，无法确认任务已暂停。'));
    }, STOP_TIMEOUT_MS);
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await Promise.race([deadline, (async () => {
        const response = await fetch(
          `${WORKOS_INTERNAL_V2_BASE_URL}/conversations/${encodedUuid}/action/abort`,
          { method: 'POST', headers: internalV2Headers(this.credentials), signal: controller.signal },
        );
        const body = await response.text();
        if (!response.ok) {
          throw new WorkosRemoteStopError(
            errorMessageForStatus(response.status, this.kind) ?? `WorkOS 暂停请求失败（HTTP ${response.status}）。`,
            response.status,
          );
        }
        if (!body.trim()) return;
        try {
          await parseJsonEnvelope(new Response(body, { status: response.status }), this.kind);
        } catch (error) {
          const status = error instanceof WorkosApiError ? error.status : undefined;
          throw new WorkosRemoteStopError(
            errorMessageForStatus(status, this.kind) ?? 'WorkOS 未确认暂停请求，无法确认任务已暂停。',
            status,
          );
        }
      })()]);
    } catch (error) {
      if (error instanceof WorkosRemoteStopError) throw error;
      throw new WorkosRemoteStopError('无法发送 WorkOS 暂停请求，请检查网络；任务可能仍在执行。');
    } finally {
      clearTimeout(timer);
      controller.abort();
      signal?.removeEventListener('abort', onAbort);
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
        `${WORKOS_INTERNAL_V2_BASE_URL}/conversations/${encodedUuid}/interrupt/${encodedRequestId}/${action}`,
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
