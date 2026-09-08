import type { InternalV2Credentials, WorkosConnectionSettings } from './workosConnection';
import { PublicV1Transport } from './workosClient';
import {
  WorkosApiError,
  type ExecuteRequest,
  type WorkosInterruptAnswers,
  type WorkosTransport,
} from './workosTransport';
import type { WorkosSseCallbacks } from './workosSse';

class LazyInternalV2Transport implements WorkosTransport {
  readonly kind = 'internal-v2' as const;

  private transport: Promise<WorkosTransport> | null = null;

  constructor(
    private readonly credentials: InternalV2Credentials,
    private readonly agentUuid: string,
  ) {}

  private load() {
    this.transport ??= import('./workosInternalV2')
      .then(({ InternalV2Transport }) => new InternalV2Transport(this.credentials, this.agentUuid));
    return this.transport;
  }

  async createConversation(signal?: AbortSignal) {
    const transport = await this.load();
    return transport.createConversation(signal);
  }

  async executeStream(
    conversationUuid: string,
    request: ExecuteRequest,
    callbacks: WorkosSseCallbacks,
    signal?: AbortSignal,
  ) {
    const transport = await this.load();
    return transport.executeStream(conversationUuid, request, callbacks, signal);
  }

  async replyInterrupt(
    conversationUuid: string,
    requestId: string,
    answers: WorkosInterruptAnswers,
    signal?: AbortSignal,
  ) {
    const transport = await this.load();
    return transport.replyInterrupt?.(conversationUuid, requestId, answers, signal);
  }

  async rejectInterrupt(conversationUuid: string, requestId: string, signal?: AbortSignal) {
    const transport = await this.load();
    return transport.rejectInterrupt?.(conversationUuid, requestId, signal);
  }
}

export function createWorkosTransport(settings: WorkosConnectionSettings): WorkosTransport {
  if (settings.transport === 'internal-v2') {
    return new LazyInternalV2Transport(settings.internalV2, settings.agentUuid);
  }
  if (!settings.publicApiToken) throw new WorkosApiError('请先配置 WorkOS API Token。');
  return new PublicV1Transport(settings.publicApiToken, settings.agentUuid);
}

export async function validateWorkosConnection(settings: WorkosConnectionSettings) {
  const transport = createWorkosTransport(settings);
  await transport.createConversation();
}
