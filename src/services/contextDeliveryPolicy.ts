import type {
  AgentCapabilityProfile,
  PageManifest,
  ReferenceSource,
  SnapshotReference,
} from '../shared/yemaiContext';

export interface ConversationSourceDelivery {
  source_id: string;
  revision_id?: string;
  delivered_at?: string;
}

export interface PreparedPageReference {
  source: ReferenceSource;
  manifest: PageManifest;
  snapshot?: SnapshotReference['snapshot'];
}

export type CurrentPageDeliveryDecision =
  | { mode: 'none'; reason: 'excluded' | 'unavailable' }
  | { mode: 'reuse'; reason: 'same_revision_in_conversation' }
  | {
      mode: 'manifest' | 'snapshot';
      delivery: 'introduce' | 'update';
      previous_revision_id?: string;
      reason: 'new_source' | 'updated_source' | 'agent_requires_snapshot' | 'snapshot_unavailable';
    };

export interface CurrentPageDeliveryInput {
  included: boolean;
  prepared?: PreparedPageReference;
  previous?: ConversationSourceDelivery;
  agent: AgentCapabilityProfile;
}

export interface CurrentPageRequestDepthInput {
  explicitReferenceCount: number;
  presentation?: 'page-overview';
}

/**
 * Exact selections already carry the material required by the current turn.
 * Keep the visible page card linked, but do not silently escalate that turn
 * into a full-page delivery. Explicit page-overview requests always stay deep.
 */
export function shouldDeliverFullCurrentPage(input: CurrentPageRequestDepthInput) {
  return input.presentation === 'page-overview' || input.explicitReferenceCount === 0;
}

function requiresBrowserSnapshot(source: ReferenceSource, agent: AgentCapabilityProfile) {
  if (agent.web_read === 'browser_session') return false;
  if (agent.web_read === 'none') return true;
  return source.access_hint === 'authenticated_web'
    || source.access_hint === 'browser_only'
    || source.access_hint === 'local_document';
}

export function decideCurrentPageDelivery(input: CurrentPageDeliveryInput): CurrentPageDeliveryDecision {
  if (!input.included) return { mode: 'none', reason: 'excluded' };
  if (!input.prepared?.source.url) return { mode: 'none', reason: 'unavailable' };

  const { source, snapshot } = input.prepared;
  const previous = input.previous?.source_id === source.source_id ? input.previous : undefined;
  const canReuse = input.agent.memory_scope !== 'none'
    && Boolean(previous?.delivered_at)
    && Boolean(source.revision_id)
    && previous?.revision_id === source.revision_id;

  if (canReuse) return { mode: 'reuse', reason: 'same_revision_in_conversation' };

  const delivery = previous?.delivered_at && input.agent.memory_scope !== 'none' ? 'update' : 'introduce';
  const previousRevision = delivery === 'update' ? previous?.revision_id : undefined;
  const snapshotRequired = requiresBrowserSnapshot(source, input.agent);

  if (snapshotRequired && snapshot?.content) {
    return {
      mode: 'snapshot',
      delivery,
      ...(previousRevision ? { previous_revision_id: previousRevision } : {}),
      reason: 'agent_requires_snapshot',
    };
  }

  return {
    mode: 'manifest',
    delivery,
    ...(previousRevision ? { previous_revision_id: previousRevision } : {}),
    reason: snapshotRequired ? 'snapshot_unavailable' : delivery === 'update' ? 'updated_source' : 'new_source',
  };
}
