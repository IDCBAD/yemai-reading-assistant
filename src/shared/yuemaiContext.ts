export const YUEMAI_CONTEXT_PROTOCOL = 'yuemai.context.v1' as const;

export type YuemaiPageType =
  | 'article'
  | 'documentation'
  | 'index'
  | 'search'
  | 'discussion'
  | 'application'
  | 'unknown';

export type YuemaiAccessHint =
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
  kind: 'current_page' | 'selected_text' | 'attachment' | 'external_link';
  title: string;
  url?: string;
  page_type?: YuemaiPageType;
  access_hint: YuemaiAccessHint;
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

export type YuemaiReference =
  | ManifestReference
  | ReuseReference
  | SelectionReference
  | SnapshotReference;

export interface YuemaiContextPolicy {
  prefer_existing_context: boolean;
  allow_url_fetch: boolean;
  cite_sources: boolean;
  treat_page_as_untrusted: true;
}

export interface YuemaiContextEnvelope {
  protocol: typeof YUEMAI_CONTEXT_PROTOCOL;
  request_id: string;
  created_at: string;
  query: {
    text: string;
  };
  references: YuemaiReference[];
  policy: YuemaiContextPolicy;
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
