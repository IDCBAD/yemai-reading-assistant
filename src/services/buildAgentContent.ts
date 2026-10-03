import { createStableSourceId, normalizeSourceIdentityUrl } from '../content/pageManifest';
import type { PageSnapshot } from '../shared/extensionMessages';
import type {
  AgentCapabilityProfile,
  ManifestReference,
  ReferenceSource,
  ReuseReference,
  SelectionReference,
  SnapshotReference,
  YemaiReference,
} from '../shared/yemaiContext';
import type { CollectionMaterial, LinkContextItem, PageContext, QuoteReference } from '../sidepanel/types';
import { safeReadingUrl } from '../sidepanel/batchReading';
import { buildYemaiContext } from './buildYemaiContext';
import type { CurrentPageDeliveryDecision, PreparedPageReference } from './contextDeliveryPolicy';
import { renderYemaiContextMarkdown } from './renderYemaiContext';

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
    url: normalizeSourceIdentityUrl(page.url),
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
): YemaiReference {
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
  const quoteUrl = normalizeSourceIdentityUrl(quote.pageUrl);
  const pageUrl = page?.source.url ? normalizeSourceIdentityUrl(page.source.url) : undefined;
  const isAssistantQuote = quote.origin === 'assistant';
  const sharesPageSource = Boolean(!isAssistantQuote && page && pageUrl === quoteUrl);
  return {
    mode: 'selection',
    delivery: sharesPageSource || isAssistantQuote ? 'reuse' : 'introduce',
    source: {
      source_id: isAssistantQuote
        ? `assistant-${quote.sourceMessageId ?? quote.id}`
        : sharesPageSource ? page!.source.source_id : createStableSourceId(quote.pageUrl),
      kind: 'selected_text',
      title: quote.pageTitle,
      ...(!isAssistantQuote && quote.pageUrl ? { url: quote.pageUrl } : {}),
      page_type: sharesPageSource ? page!.source.page_type : 'unknown',
      access_hint: isAssistantQuote ? 'local_document' : sharesPageSource ? page!.source.access_hint : 'unknown',
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
  collectionMaterials?: CollectionMaterial[];
  links?: LinkContextItem[];
  page?: {
    prepared: PreparedPageReference;
    decision: CurrentPageDeliveryDecision;
  };
  requestId?: string;
  createdAt?: string;
}

export function buildAgentContent(input: BuildAgentContentInput) {
  const references: YemaiReference[] = [];
  const links = input.links?.filter((item) => item.included && item.status === 'ready' && safeReadingUrl(item.link.url)) ?? [];
  const linkReferences = links.map((item) => ({ mode: 'link' as const, delivery: 'introduce' as const, source: {
    source_id: item.id, kind: 'external_link' as const, title: item.link.title,
    url: item.link.url, access_hint: 'unknown' as const, captured_at: new Date(item.createdAt).toISOString(),
  } }));
  references.push(...linkReferences);
  if (input.page && input.page.decision.mode !== 'none') {
    references.push(pageReference(input.page.prepared, input.page.decision));
  }
  input.quotes.forEach((quote) => references.push(quoteReference(quote, input.page?.prepared)));
  input.collectionMaterials?.filter((material) => material.included !== false).forEach((material) => {
    references.push({
      mode: 'collection',
      delivery: 'introduce',
      source: {
        source_id: `collection-${material.cardId}`,
        kind: 'collection',
        title: material.title,
        access_hint: 'local_document',
        captured_at: new Date(material.savedAt).toISOString(),
      },
      collection: {
        card_id: material.cardId,
        kind: material.kind,
        ...(material.question !== undefined ? { question: material.question } : {}),
        answer: material.answer,
        sources: material.sources.map((source) => ({ ...source })),
      },
    });
  });
  return renderYemaiContextMarkdown(buildYemaiContext({
    query: input.question,
    references,
    ...(linkReferences.length ? { readingTask: { strategy: 'per_source_then_synthesize' as const,
      source_ids: linkReferences.map((reference) => reference.source.source_id), parallel: 'if_supported' as const } } : {}),
    requestId: input.requestId,
    createdAt: input.createdAt,
  }));
}
