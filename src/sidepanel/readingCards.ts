import type { ReadingCardKind, ReadingCardRow, ReadingCardSource } from '../data/database';
import type { AnswerContextSource } from './answerContext';
import type { ChatMessage, Conversation, OpenConversationTab, WorkspaceState } from './types';
import { openConversationInWorkspace } from './workspaceNavigation';

const MAX_CARD_TITLE_LENGTH = 72;
const MAX_CARD_EXCERPT_LENGTH = 220;

function compactText(value: string) {
  return value
    .replace(/```[^\n]*\n?/gu, ' ')
    .replace(/[#>*_`~\[\]()|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function excerptTitle(value: string) {
  const compact = compactText(value);
  const firstSentence = compact.split(/[。！？!?；;]/u)[0]?.trim() || compact;
  return truncate(firstSentence || '收藏的回答片段', MAX_CARD_TITLE_LENGTH);
}

function stableTextFingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${value.length.toString(36)}`;
}

function cardTitle(conversation: Conversation, message: ChatMessage) {
  const heading = message.content
    .split(/\r?\n/gu)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/u)?.[1])
    .find(Boolean);
  const fallback = message.artifacts?.[0]?.filename || conversation.title || '收藏的回答';
  return truncate(compactText(heading ?? fallback), MAX_CARD_TITLE_LENGTH);
}

function contextSource(source: AnswerContextSource): ReadingCardSource | undefined {
  if (source.kind === 'page') {
    return { title: source.page.title, url: source.page.url, site: source.page.site };
  }
  if (source.kind === 'quote') {
    return { title: source.quote.pageTitle || '引用来源', url: source.quote.pageUrl };
  }
  if (source.kind === 'link') return { title: source.title, url: source.url };
  return undefined;
}

function uniqueSources(sources: ReadingCardSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url || source.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readingCardId(conversationId: string, messageId: string) {
  return `reading-card:${conversationId}:${messageId}`;
}

export function readingCardKind(card: Pick<ReadingCardRow, 'kind'>): ReadingCardKind {
  return card.kind ?? 'answer';
}

export function readingCardExcerptId(conversationId: string, messageId: string, text: string) {
  return `reading-card:excerpt:${conversationId}:${messageId}:${stableTextFingerprint(compactText(text))}`;
}

function readingCardSources(conversation: Conversation, contextSources: AnswerContextSource[]) {
  const sources = uniqueSources(contextSources
    .map(contextSource)
    .filter((source): source is ReadingCardSource => Boolean(source)));
  const fallbackSources = uniqueSources(conversation.pages.map((page) => ({
    title: page.title,
    url: page.url,
    site: page.site,
  })));
  return sources.length > 0 ? sources : fallbackSources;
}

export function createReadingCard(
  conversation: Conversation,
  message: ChatMessage,
  contextSources: AnswerContextSource[],
  createdAt = Date.now(),
): ReadingCardRow {
  const excerpt = compactText(message.content);
  return {
    id: readingCardId(conversation.id, message.id),
    kind: 'answer',
    sourceConversationId: conversation.id,
    sourceMessageId: message.id,
    title: cardTitle(conversation, message),
    excerpt: truncate(excerpt || message.artifacts?.map((artifact) => artifact.filename).join('、') || 'Agent 产物', MAX_CARD_EXCERPT_LENGTH),
    bodyMarkdown: message.content,
    sources: readingCardSources(conversation, contextSources),
    artifacts: (message.artifacts ?? []).map((artifact) => ({ ...artifact })),
    messageCreatedAt: message.respondedAt ?? message.createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createReadingCardExcerpt(
  conversation: Conversation,
  message: ChatMessage,
  selection: string,
  contextSources: AnswerContextSource[],
  createdAt = Date.now(),
): ReadingCardRow {
  const bodyMarkdown = selection.trim();
  const excerpt = compactText(bodyMarkdown);
  return {
    id: readingCardExcerptId(conversation.id, message.id, bodyMarkdown),
    kind: 'excerpt',
    sourceConversationId: conversation.id,
    sourceMessageId: message.id,
    title: excerptTitle(bodyMarkdown),
    excerpt: truncate(excerpt, MAX_CARD_EXCERPT_LENGTH),
    bodyMarkdown,
    sources: readingCardSources(conversation, contextSources),
    artifacts: [],
    messageCreatedAt: message.respondedAt ?? message.createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

export function readingCardSourceAvailable(card: ReadingCardRow, conversations: Conversation[]) {
  return conversations.some((conversation) => conversation.id === card.sourceConversationId
    && conversation.messages.some((message) => message.id === card.sourceMessageId));
}

export function openReadingCardSourceInWorkspace(
  workspace: WorkspaceState,
  card: Pick<ReadingCardRow, 'sourceConversationId' | 'sourceMessageId'>,
  maxTabs: number,
  createTab: (conversationId: string) => OpenConversationTab,
) {
  const target = workspace.conversations.find((conversation) => conversation.id === card.sourceConversationId
    && conversation.messages.some((message) => message.id === card.sourceMessageId));
  if (!target) return workspace;
  const alreadyOpen = workspace.openTabs.some((tab) => tab.conversationId === target.id);
  if (!alreadyOpen && workspace.openTabs.length >= maxTabs) return workspace;
  const restored = target.archivedAt === undefined
    ? workspace
    : {
        ...workspace,
        conversations: workspace.conversations.map((conversation) => conversation.id === target.id
          ? { ...conversation, archivedAt: undefined }
          : conversation),
      };
  return openConversationInWorkspace(restored, target.id, maxTabs, createTab);
}
