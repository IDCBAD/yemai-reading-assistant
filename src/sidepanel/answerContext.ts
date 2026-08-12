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
    };

export function getMessageContextSources(message: ChatMessage | undefined): AnswerContextSource[] {
  if (!message || message.role !== 'user') return [];

  const sources: AnswerContextSource[] = [];
  if (message.pageContext) {
    sources.push({
      kind: 'page',
      id: `page:${message.id}`,
      page: message.pageContext,
      delivery: message.pageContextDelivery,
      issue: message.pageContextIssue,
    });
  }
  for (const quote of message.references ?? []) {
    sources.push({ kind: 'quote', id: `quote:${quote.id}`, quote });
  }
  for (const attachment of message.attachments ?? []) {
    sources.push({ kind: 'attachment', id: `attachment:${attachment.id}`, attachment });
  }
  return sources;
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
