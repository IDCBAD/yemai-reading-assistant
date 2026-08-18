import { normalizeSourceIdentityUrl } from '../content/pageManifest';
import type { Conversation, PageContext } from '../sidepanel/types';
import type { ConversationSourceDelivery, PreparedPageReference } from './contextDeliveryPolicy';

function messagePages(conversation: Conversation) {
  return conversation.messages.flatMap((message) => {
    const pages = message.contextItems
      ?.filter((item) => item.kind === 'page')
      .map((item) => item.page) ?? [];
    return message.pageContext ? [...pages, message.pageContext] : pages;
  });
}

function matchesPreparedPage(page: PageContext, prepared: PreparedPageReference) {
  return page.sourceId === prepared.source.source_id
    || Boolean(prepared.source.url
      && normalizeSourceIdentityUrl(page.url) === normalizeSourceIdentityUrl(prepared.source.url));
}

/**
 * Finds the newest successful delivery of a page in the current remote conversation.
 * Message snapshots are a fallback for older or partially migrated workspace ledgers.
 */
export function findConversationSourceDelivery(
  conversation: Conversation,
  prepared: PreparedPageReference,
  remoteUuid: string,
): ConversationSourceDelivery | undefined {
  const previous = [...conversation.pages, ...messagePages(conversation)]
    .filter((page) => page.sentAt !== undefined
      && matchesPreparedPage(page, prepared)
      && (page.deliveredRemoteUuid === undefined || page.deliveredRemoteUuid === remoteUuid))
    .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))[0];

  if (!previous?.sentAt) return undefined;
  return {
    source_id: prepared.source.source_id,
    revision_id: previous.contentHash,
    delivered_at: new Date(previous.sentAt).toISOString(),
  };
}

export function markPageDelivered(
  page: PageContext,
  remoteUuid: string,
  sentAt: number,
): PageContext {
  return { ...page, sentAt, deliveredRemoteUuid: remoteUuid };
}
