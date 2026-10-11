import { InternalV2Transport } from '../services/workosInternalV2';
import { PublicV1Transport } from '../services/workosClient';
import type { WorkosConnectionSettings } from '../services/workosConnection';
import type { WorkosTransport } from '../services/workosTransport';

// Chrome extension service workers prohibit dynamic import(). The sidepanel
// keeps its lazy factory; background execution uses statically bundled modules.
export function createBackgroundTransport(connection: WorkosConnectionSettings): WorkosTransport {
  return connection.transport === 'internal-v2'
    ? new InternalV2Transport(connection.internalV2, connection.agentUuid)
    : new PublicV1Transport(connection.publicApiToken, connection.agentUuid);
}
