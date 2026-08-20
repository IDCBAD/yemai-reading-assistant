import MiniSearch, { type SearchResult as MiniSearchResult } from 'minisearch';
import { contextItemsFromMessage } from '../sidepanel/contextItems';
import type { ChatMessage, ContextItem, Conversation, WorkspaceState } from '../sidepanel/types';
import {
  findSearchTextMatches,
  isStructuredSearchLiteral,
  normalizeSearchLiteral,
  segmentSearchWords,
} from './searchTextMatches';

export type WorkspaceSearchResultKind = 'conversation' | 'message';

export interface WorkspaceSearchResult {
  id: string;
  kind: WorkspaceSearchResultKind;
  conversationId: string;
  messageId?: string;
  role?: ChatMessage['role'];
  title: string;
  subtitle: string;
  snippet: string;
  updatedAt: number;
  archived: boolean;
  score: number;
  matchedTerms: string[];
  matchLabel?: string;
}

interface WorkspaceSearchDocument {
  id: string;
  kind: WorkspaceSearchResultKind;
  conversationId: string;
  messageId: string;
  role: '' | ChatMessage['role'];
  conversationTitle: string;
  subtitle: string;
  searchTitle: string;
  userContent: string;
  assistantContent: string;
  pageText: string;
  artifactText: string;
  updatedAt: number;
  archived: boolean;
}

const SEARCH_FIELDS = ['searchTitle', 'userContent', 'assistantContent', 'pageText', 'artifactText'] as const;
type SearchField = typeof SEARCH_FIELDS[number];

function normalizeSearchText(value: string) {
  return normalizeSearchLiteral(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

/** MiniSearch's whitespace tokenizer is replaced with locale-aware word segmentation. */
export function tokenizeWorkspaceSearch(value: string) {
  return segmentSearchWords(value);
}

function contextSearchText(items: ContextItem[]) {
  const pageText: string[] = [];
  const artifactText: string[] = [];
  items.forEach((item) => {
    if (item.kind === 'page') pageText.push(item.page.title, item.page.site, item.page.url);
    if (item.kind === 'selection') pageText.push(item.selection.pageTitle, item.selection.pageUrl, item.selection.text);
    if (item.kind === 'file' || item.kind === 'image') artifactText.push(item.attachment.filename);
    if (item.kind === 'memory') pageText.push(item.memory.title, item.memory.excerpt);
    if (item.kind === 'link') pageText.push(item.link.title, item.link.site ?? '', item.link.url);
  });
  return {
    pageText: unique(pageText).join(' '),
    artifactText: unique(artifactText).join(' '),
  };
}

function messageDocument(conversation: Conversation, message: ChatMessage): WorkspaceSearchDocument {
  const context = contextSearchText(contextItemsFromMessage(message));
  const artifactText = unique([
    context.artifactText,
    ...(message.artifacts ?? []).map((artifact) => artifact.filename),
  ]).join(' ');
  return {
    id: `message:${conversation.id}:${message.id}`,
    kind: 'message',
    conversationId: conversation.id,
    messageId: message.id,
    role: message.role,
    conversationTitle: conversation.title,
    subtitle: message.role === 'user' ? '你的提问' : '页脉回答',
    searchTitle: '',
    userContent: message.role === 'user' ? message.content : '',
    assistantContent: message.role === 'assistant' ? message.content : '',
    pageText: context.pageText,
    artifactText,
    updatedAt: message.respondedAt ?? message.createdAt,
    archived: conversation.archivedAt !== undefined,
  };
}

function conversationDocument(conversation: Conversation): WorkspaceSearchDocument {
  const pageText = unique(conversation.pages.flatMap((page) => [page.title, page.site, page.url])).join(' ');
  return {
    id: `conversation:${conversation.id}`,
    kind: 'conversation',
    conversationId: conversation.id,
    messageId: '',
    role: '',
    conversationTitle: conversation.title,
    subtitle: conversation.subtitle,
    searchTitle: conversation.title,
    userContent: '',
    assistantContent: '',
    pageText,
    artifactText: '',
    updatedAt: conversation.updatedAt,
    archived: conversation.archivedAt !== undefined,
  };
}

export function buildWorkspaceSearchDocuments(workspace: WorkspaceState): WorkspaceSearchDocument[] {
  return workspace.conversations.flatMap((conversation) => [
    conversationDocument(conversation),
    ...conversation.messages.map((message) => messageDocument(conversation, message)),
  ]);
}

function plainSnippet(value: string) {
  return value
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/```[^\n]*\n?/gu, ' '))
    .replace(/[#>*_`~\[\]()|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function searchFieldValue(document: WorkspaceSearchDocument, field: SearchField) {
  return document[field];
}

function searchableValues(document: WorkspaceSearchDocument) {
  return SEARCH_FIELDS.map((field) => searchFieldValue(document, field)).filter(Boolean);
}

function requiresExactStructuredMatch(query: string) {
  return isStructuredSearchLiteral(query);
}

function hasExactStructuredMatch(document: WorkspaceSearchDocument, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  return searchableValues(document).some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

function matchedFields(hit: MiniSearchResult, document: WorkspaceSearchDocument) {
  const fields = unique(Object.values(hit.match).flat())
    .filter((field): field is SearchField => SEARCH_FIELDS.includes(field as SearchField));
  const priority = document.kind === 'message'
    ? ['userContent', 'assistantContent', 'pageText', 'artifactText', 'searchTitle'] satisfies SearchField[]
    : ['searchTitle', 'pageText', 'artifactText', 'userContent', 'assistantContent'] satisfies SearchField[];
  return priority.filter((field) => fields.includes(field));
}

const MATCH_LABELS: Record<SearchField, string> = {
  searchTitle: '会话标题',
  userContent: '你的提问',
  assistantContent: '页脉回答',
  pageText: '网页或引用',
  artifactText: '附件或产物',
};

function createSnippet(document: WorkspaceSearchDocument, query: string, hit: MiniSearchResult) {
  const fields = matchedFields(hit, document);
  const candidateFields = fields.length > 0 ? fields : [...SEARCH_FIELDS];
  const matchedTerms = unique(hit.terms).sort((left, right) => right.length - left.length);
  const ranked = candidateFields.map((field, priority) => {
    const value = plainSnippet(searchFieldValue(document, field));
    const normalized = normalizeSearchText(value);
    const valueTerms = new Set(segmentSearchWords(normalized));
    const termCoverage = matchedTerms.filter((term) => valueTerms.has(normalizeSearchText(term))).length;
    const firstMatch = findSearchTextMatches(value, query, matchedTerms, 1)[0];
    return {
      field,
      value,
      priority,
      firstMatch,
      score: termCoverage + (firstMatch ? 1 : 0),
    };
  }).filter((candidate) => candidate.value);
  const selected = ranked.sort((left, right) => right.score - left.score || left.priority - right.priority)[0];
  const candidate = selected?.value ?? '';
  const matchIndex = selected?.firstMatch?.start;
  if (candidate.length <= 108 && (matchIndex === undefined || matchIndex <= 28)) {
    return { snippet: candidate, matchLabel: selected ? MATCH_LABELS[selected.field] : undefined };
  }
  const start = Math.max(0, (matchIndex ?? 0) - 28);
  const end = Math.min(candidate.length, start + 108);
  return {
    snippet: `${start > 0 ? '…' : ''}${candidate.slice(start, end).trim()}${end < candidate.length ? '…' : ''}`,
    matchLabel: selected ? MATCH_LABELS[selected.field] : undefined,
  };
}

function toWorkspaceResult(
  hit: MiniSearchResult,
  document: WorkspaceSearchDocument,
  query: string,
): WorkspaceSearchResult {
  const snippet = createSnippet(document, query, hit);
  return {
    id: document.id,
    kind: document.kind,
    conversationId: document.conversationId,
    ...(document.messageId ? { messageId: document.messageId } : {}),
    ...(document.role ? { role: document.role } : {}),
    title: document.conversationTitle,
    subtitle: document.subtitle,
    snippet: snippet.snippet,
    updatedAt: document.updatedAt,
    archived: document.archived,
    score: hit.score,
    matchedTerms: unique(hit.terms),
    matchLabel: snippet.matchLabel,
  };
}

export interface WorkspaceSearchIndex {
  search: (query: string, limit?: number) => WorkspaceSearchResult[];
  recent: (limit?: number) => WorkspaceSearchResult[];
  documentCount: number;
}

export function createWorkspaceSearchIndex(workspace: WorkspaceState): WorkspaceSearchIndex {
  const documents = buildWorkspaceSearchDocuments(workspace);
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const search = new MiniSearch<WorkspaceSearchDocument>({
    idField: 'id',
    fields: [...SEARCH_FIELDS],
    storeFields: [],
    tokenize: tokenizeWorkspaceSearch,
    processTerm: (term) => normalizeSearchText(term),
    searchOptions: {
      boost: {
        searchTitle: 5,
        userContent: 3.5,
        assistantContent: 2.7,
        pageText: 1.8,
        artifactText: 1.5,
      },
      prefix: true,
      fuzzy: (term) => /^[a-z]+$/u.test(term) && term.length >= 5 ? 0.18 : false,
      combineWith: 'AND',
    },
  });
  search.addAll(documents);

  return {
    documentCount: documents.length,
    search(query, limit = 30) {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) return [];
      const exactStructured = requiresExactStructuredMatch(normalizedQuery);
      return search.search(normalizedQuery)
        .flatMap((hit) => {
          const document = documentsById.get(String(hit.id));
          if (!document || (exactStructured && !hasExactStructuredMatch(document, normalizedQuery))) return [];
          return [toWorkspaceResult(hit, document, query)];
        })
        .slice(0, limit);
    },
    recent(limit = 8) {
      return documents
        .filter((document) => document.kind === 'conversation')
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, limit)
        .map((document) => ({
          id: document.id,
          kind: document.kind,
          conversationId: document.conversationId,
          title: document.conversationTitle,
          subtitle: document.subtitle,
          snippet: plainSnippet(document.pageText),
          updatedAt: document.updatedAt,
          archived: document.archived,
          score: 0,
          matchedTerms: [],
        }));
    },
  };
}
