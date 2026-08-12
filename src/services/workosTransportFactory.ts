import type { WorkosConnectionSettings } from './workosConnection';
import { PublicV1Transport } from './workosClient';
import { InternalV2Transport } from './workosInternalV2';
import { WorkosApiError, type WorkosTransport } from './workosTransport';

export function createWorkosTransport(settings: WorkosConnectionSettings): WorkosTransport {
  if (settings.transport === 'internal-v2') {
    return new InternalV2Transport(settings.internalV2, settings.agentUuid);
  }
  if (!settings.publicApiToken) throw new WorkosApiError('请先配置 WorkOS API Token。');
  return new PublicV1Transport(settings.publicApiToken, settings.agentUuid);
}

export async function validateWorkosConnection(settings: WorkosConnectionSettings) {
  const transport = createWorkosTransport(settings);
  await transport.createConversation();
}
