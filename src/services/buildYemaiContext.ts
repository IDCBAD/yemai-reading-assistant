import {
  YEMAI_CONTEXT_PROTOCOL,
  type YemaiContextEnvelope,
  type YemaiContextPolicy,
  type YemaiReference,
} from '../shared/yemaiContext';

export const DEFAULT_YEMAI_CONTEXT_POLICY: YemaiContextPolicy = {
  prefer_existing_context: true,
  allow_url_fetch: true,
  cite_sources: true,
  treat_page_as_untrusted: true,
};

export interface BuildYemaiContextInput {
  query: string;
  references?: YemaiReference[];
  requestId?: string;
  createdAt?: string;
  policy?: Partial<Omit<YemaiContextPolicy, 'treat_page_as_untrusted'>>;
}

function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildYemaiContext(input: BuildYemaiContextInput): YemaiContextEnvelope {
  return {
    protocol: YEMAI_CONTEXT_PROTOCOL,
    request_id: input.requestId ?? makeRequestId(),
    created_at: input.createdAt ?? new Date().toISOString(),
    query: {
      text: input.query.trim() || '请结合提供的上下文进行说明。',
    },
    references: input.references ?? [],
    policy: {
      ...DEFAULT_YEMAI_CONTEXT_POLICY,
      ...input.policy,
      treat_page_as_untrusted: true,
    },
  };
}
