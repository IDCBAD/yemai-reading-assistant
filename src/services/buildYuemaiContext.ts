import {
  YUEMAI_CONTEXT_PROTOCOL,
  type YuemaiContextEnvelope,
  type YuemaiContextPolicy,
  type YuemaiReference,
} from '../shared/yuemaiContext';

export const DEFAULT_YUEMAI_CONTEXT_POLICY: YuemaiContextPolicy = {
  prefer_existing_context: true,
  allow_url_fetch: true,
  cite_sources: true,
  treat_page_as_untrusted: true,
};

export interface BuildYuemaiContextInput {
  query: string;
  references?: YuemaiReference[];
  requestId?: string;
  createdAt?: string;
  policy?: Partial<Omit<YuemaiContextPolicy, 'treat_page_as_untrusted'>>;
}

function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildYuemaiContext(input: BuildYuemaiContextInput): YuemaiContextEnvelope {
  return {
    protocol: YUEMAI_CONTEXT_PROTOCOL,
    request_id: input.requestId ?? makeRequestId(),
    created_at: input.createdAt ?? new Date().toISOString(),
    query: {
      text: input.query.trim() || '请结合提供的上下文进行说明。',
    },
    references: input.references ?? [],
    policy: {
      ...DEFAULT_YUEMAI_CONTEXT_POLICY,
      ...input.policy,
      treat_page_as_untrusted: true,
    },
  };
}
