export const YEMAI_CONTEXT_PROTOCOL = 'yemai.context.v1' as const;

export type YemaiPageType =
  | 'article'
  | 'documentation'
  | 'index'
  | 'search'
  | 'discussion'
  | 'application'
  | 'unknown';

export type YemaiAccessHint =
  | 'public_web'
  | 'authenticated_web'
  | 'browser_only'
  | 'local_document'
  | 'unknown';

export interface PageManifestHeading {
  level: 1 | 2 | 3;
  text: string;
}

export interface PageManifestLink {
  title: string;
  url: string;
  relation: 'chapter' | 'next' | 'previous' | 'reference' | 'unknown';
}

export interface PageManifest {
  description?: string;
  outline: PageManifestHeading[];
  leading_excerpt?: string;
  relevant_links: PageManifestLink[];
  truncated: boolean;
}

export interface ReferenceSource {
  source_id: string;
  kind: 'current_page' | 'selected_text' | 'attachment' | 'external_link' | 'collection';
  title: string;
  url?: string;
  page_type?: YemaiPageType;
  access_hint: YemaiAccessHint;
  revision_id?: string;
  captured_at: string;
}

export interface ManifestReference {
  mode: 'manifest';
  delivery: 'introduce' | 'update';
  source: ReferenceSource;
  previous_revision_id?: string;
  manifest: PageManifest;
}

export interface ReuseReference {
  mode: 'reuse';
  delivery: 'reuse';
  source: ReferenceSource;
  reuse: {
    reason: 'same_revision_in_conversation';
  };
}

export interface SelectionReference {
  mode: 'selection';
  delivery: 'introduce' | 'reuse';
  source: ReferenceSource;
  selection: {
    text: string;
    prefix?: string;
    suffix?: string;
    selector?: {
      type: 'text_quote';
      exact: string;
      prefix?: string;
      suffix?: string;
    };
    truncated: boolean;
  };
}

export interface SnapshotReference {
  mode: 'snapshot';
  delivery: 'introduce' | 'update';
  source: ReferenceSource;
  previous_revision_id?: string;
  snapshot: {
    format: 'markdown' | 'plain_text';
    content: string;
    scope: 'main_content' | 'visible_content' | 'selected_region';
    original_length?: number;
    truncated: boolean;
  };
}

export interface CollectionReference {
  mode: 'collection';
  delivery: 'introduce';
  source: ReferenceSource;
  collection: {
    card_id: string;
    kind: 'answer' | 'excerpt';
    question?: string;
    answer: string;
    sources: Array<{ title: string; url: string; site?: string }>;
  };
}

export interface LinkReference {
  mode: 'link';
  delivery: 'introduce';
  source: ReferenceSource;
}

export interface BatchReadingTask {
  strategy: 'per_source_then_synthesize';
  source_ids: string[];
  parallel: 'if_supported';
}

export type YemaiReference =
  | LinkReference
  | ManifestReference
  | ReuseReference
  | SelectionReference
  | SnapshotReference
  | CollectionReference;

export interface YemaiContextPolicy {
  prefer_existing_context: boolean;
  allow_url_fetch: boolean;
  cite_sources: boolean;
  treat_page_as_untrusted: true;
}

export interface YemaiContextEnvelope {
  protocol: typeof YEMAI_CONTEXT_PROTOCOL;
  request_id: string;
  created_at: string;
  query: {
    text: string;
  };
  references: YemaiReference[];
  reading_task?: BatchReadingTask;
  policy: YemaiContextPolicy;
}

export interface AgentCapabilityProfile {
  profile_id: string;
  memory_scope: 'none' | 'conversation' | 'persistent';
  web_read: 'none' | 'public_url' | 'browser_session';
  context_input: 'markdown_text' | 'structured_json';
  snapshot_request: 'unsupported' | 'supported';
  limits?: {
    preferred_context_chars?: number;
    maximum_context_chars?: number;
  };
}
