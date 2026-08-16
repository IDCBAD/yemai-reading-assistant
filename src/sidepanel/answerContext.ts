import { contextItemsFromMessage } from './contextItems';
import type { ChatMessage, DraftAttachment, PageContext, QuoteReference } from './types';

export type AnswerContextSource =
  | {
      kind: 'page';
      id: string;
      page: PageContext;
      delivery?: ChatMessage['pageContextDelivery'];
      issue?: string;
    }
  | {
      kind: 'quote';
      id: string;
      quote: QuoteReference;
    }
  | {
      kind: 'attachment';
      id: string;
      attachment: DraftAttachment;
    }
  | {
      kind: 'memory';
      id: string;
      title: string;
      excerpt: string;
    }
  | {
      kind: 'link';
      id: string;
      title: string;
      url: string;
    };

export function getMessageContextSources(message: ChatMessage | undefined): AnswerContextSource[] {
  if (!message || message.role !== 'user') return [];

  return contextItemsFromMessage(message).map((item): AnswerContextSource => {
    if (item.kind === 'page') {
      return {
        kind: 'page',
        id: item.id,
        page: item.page,
        delivery: item.delivery ?? message.pageContextDelivery,
        issue: item.issue ?? message.pageContextIssue,
      };
    }
    if (item.kind === 'selection') return { kind: 'quote', id: item.id, quote: item.selection };
    if (item.kind === 'file' || item.kind === 'image') {
      return { kind: 'attachment', id: item.id, attachment: item.attachment };
    }
    if (item.kind === 'memory') {
      return { kind: 'memory', id: item.id, title: item.memory.title, excerpt: item.memory.excerpt };
    }
    return { kind: 'link', id: item.id, title: item.link.title, url: item.link.url };
  });
}

/**
 * Associates each assistant response with the closest user message before it.
 * The user message is the send-time snapshot, so later page changes do not
 * rewrite the provenance shown beneath an earlier answer.
 */
export function buildAnswerContextMap(messages: ChatMessage[]) {
  const contexts = new Map<string, AnswerContextSource[]>();
  let latestUserMessage: ChatMessage | undefined;

  for (const message of messages) {
    if (message.role === 'user') {
      latestUserMessage = message;
      continue;
    }
    contexts.set(message.id, getMessageContextSources(latestUserMessage));
  }

  return contexts;
}
