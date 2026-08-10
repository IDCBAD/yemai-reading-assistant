import { createStableSourceId, normalizeSourceUrl } from '../content/pageManifest';
import type { PageSnapshot } from '../shared/extensionMessages';
import type {
  AgentCapabilityProfile,
  ManifestReference,
  ReferenceSource,
  ReuseReference,
  SelectionReference,
  SnapshotReference,
  YuemaiReference,
} from '../shared/yuemaiContext';
import type { PageContext, QuoteReference } from '../sidepanel/types';
import { buildYuemaiContext } from './buildYuemaiContext';
import type { CurrentPageDeliveryDecision, PreparedPageReference } from './contextDeliveryPolicy';
import { renderYuemaiContextMarkdown } from './renderYuemaiContext';

export const DEFAULT_SNAPSHOT_LENGTH = 12_000;

export const WORKOS_AGENT_CAPABILITIES: AgentCapabilityProfile = {
  profile_id: 'workos-default',
  memory_scope: 'conversation',
  web_read: 'public_url',
  context_input: 'markdown_text',
  snapshot_request: 'unsupported',
  limits: {
    preferred_context_chars: 4_000,
    maximum_context_chars: DEFAULT_SNAPSHOT_LENGTH,
  },
};

function capturedAt(page: PageContext) {
  return new Date(page.extractedAt ?? Date.now()).toISOString();
}

function pageSource(page: PageContext): ReferenceSource {
  return {
    source_id: page.sourceId ?? createStableSourceId(page.url),
    kind: 'current_page',
    title: page.title,
    url: page.url,
    page_type: page.pageType ?? 'unknown',
    access_hint: page.accessHint ?? 'unknown',
    ...(page.contentHash ? { revision_id: page.contentHash } : {}),
    captured_at: capturedAt(page),
  };
}

export function preparePageReference(page: PageContext | PageSnapshot): PreparedPageReference {
  const markdown = 'markdown' in page ? page.markdown : undefined;
  const maximumSnapshotLength = WORKOS_AGENT_CAPABILITIES.limits?.maximum_context_chars ?? DEFAULT_SNAPSHOT_LENGTH;
  const snapshotTruncated = Boolean(markdown && (markdown.length > maximumSnapshotLength || page.truncated));
  const snapshotContent = markdown?.slice(0, maximumSnapshotLength);
  return {
    source: pageSource(page),
    manifest: page.manifest ?? {
      outline: [],
      relevant_links: [],
      truncated: true,
    },
    ...(snapshotContent
      ? {
          snapshot: {
            format: 'markdown',
            content: snapshotContent,
            scope: 'main_content',
            original_length: markdown?.length,
            truncated: snapshotTruncated,
          } satisfies SnapshotReference['snapshot'],
        }
      : {}),
  };
}

function pageReference(
  prepared: PreparedPageReference,
  decision: Exclude<CurrentPageDeliveryDecision, { mode: 'none' }>,
): YuemaiReference {
  if (decision.mode === 'reuse') {
    return {
      mode: 'reuse',
      delivery: 'reuse',
      source: prepared.source,
      reuse: { reason: 'same_revision_in_conversation' },
    } satisfies ReuseReference;
  }
  if (decision.mode === 'snapshot' && prepared.snapshot) {
    return {
      mode: 'snapshot',
      delivery: decision.delivery,
      source: prepared.source,
      ...(decision.previous_revision_id ? { previous_revision_id: decision.previous_revision_id } : {}),
      snapshot: prepared.snapshot,
    } satisfies SnapshotReference;
  }
  return {
    mode: 'manifest',
    delivery: decision.delivery,
    source: prepared.source,
    ...(decision.previous_revision_id ? { previous_revision_id: decision.previous_revision_id } : {}),
    manifest: prepared.manifest,
  } satisfies ManifestReference;
}

function quoteReference(quote: QuoteReference, page?: PreparedPageReference): SelectionReference {
  const quoteUrl = normalizeSourceUrl(quote.pageUrl);
  const pageUrl = page?.source.url ? normalizeSourceUrl(page.source.url) : undefined;
  const sharesPageSource = Boolean(page && pageUrl === quoteUrl);
  return {
    mode: 'selection',
    delivery: sharesPageSource ? 'reuse' : 'introduce',
    source: {
      source_id: sharesPageSource ? page!.source.source_id : createStableSourceId(quote.pageUrl),
      kind: 'selected_text',
      title: quote.pageTitle,
      url: quote.pageUrl,
      page_type: sharesPageSource ? page!.source.page_type : 'unknown',
      access_hint: sharesPageSource ? page!.source.access_hint : 'unknown',
      ...(sharesPageSource && page!.source.revision_id ? { revision_id: page!.source.revision_id } : {}),
      captured_at: new Date(quote.createdAt).toISOString(),
    },
    selection: {
      text: quote.text,
      selector: {
        type: 'text_quote',
        exact: quote.text,
      },
      truncated: false,
    },
  };
}

export interface BuildAgentContentInput {
  question: string;
  quotes: QuoteReference[];
  page?: {
    prepared: PreparedPageReference;
    decision: CurrentPageDeliveryDecision;
  };
  requestId?: string;
  createdAt?: string;
}

export function buildAgentContent(input: BuildAgentContentInput) {
  const references: YuemaiReference[] = [];
  if (input.page && input.page.decision.mode !== 'none') {
    references.push(pageReference(input.page.prepared, input.page.decision));
  }
  input.quotes.forEach((quote) => references.push(quoteReference(quote, input.page?.prepared)));
  return renderYuemaiContextMarkdown(buildYuemaiContext({
    query: input.question,
    references,
    requestId: input.requestId,
    createdAt: input.createdAt,
  }));
}
