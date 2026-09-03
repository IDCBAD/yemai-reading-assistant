import type {
  ArtifactRow,
  ConversationRow,
  ConversationSourceRow,
  MessageRow,
  ReadingCardRow,
  YemaiDatabase,
} from './database';

export const YEMAI_BACKUP_FORMAT = 'yemai-backup' as const;
export const YEMAI_BACKUP_FORMAT_VERSION = 1 as const;
export const MAX_YEMAI_BACKUP_BYTES = 50 * 1024 * 1024;

export interface YemaiBackupCounts {
  conversations: number;
  messages: number;
  sources: number;
  artifacts: number;
  readingCards: number;
}

export interface YemaiBackupV1 {
  format: typeof YEMAI_BACKUP_FORMAT;
  formatVersion: typeof YEMAI_BACKUP_FORMAT_VERSION;
  appVersion: string;
  exportedAt: number;
  counts: YemaiBackupCounts;
  conversations: ConversationRow[];
  messages: MessageRow[];
  sources: ConversationSourceRow[];
  artifacts: ArtifactRow[];
  readingCards: ReadingCardRow[];
}

export interface CreateYemaiBackupOptions {
  appVersion: string;
  exportedAt?: number;
}

const EXCLUDED_BACKUP_KEYS = new Set([
  'accessToken',
  'publicApiToken',
  'userUuid',
  'organizationUuid',
  'pendingBranchContext',
  'browserTabId',
  'rawEvent',
  'rawEvents',
  'reasoning',
  'toolParameters',
]);

function isTemporaryUrl(value: unknown) {
  return typeof value === 'string' && /^(?:blob|data):/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= 8_640_000_000_000_000;
}

function hasString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === 'string' && record[key] !== '';
}

function hasStringValue(record: Record<string, unknown>, key: string) {
  return typeof record[key] === 'string';
}

function hasFiniteNumber(record: Record<string, unknown>, key: string) {
  return isFiniteNumber(record[key]);
}

function isPageRecord(value: unknown) {
  if (!isRecord(value)) return false;
  return hasStringValue(value, 'title')
    && hasStringValue(value, 'site')
    && hasStringValue(value, 'url')
    && ['not-read', 'reading', 'ready', 'read', 'changed'].includes(String(value.status));
}

function containsExcludedBackupValue(value: unknown, key?: string): boolean {
  if (key && EXCLUDED_BACKUP_KEYS.has(key)) return true;
  if (key && /(?:url|uri)$/i.test(key) && isTemporaryUrl(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsExcludedBackupValue(item));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([entryKey, entryValue]) => containsExcludedBackupValue(entryValue, entryKey));
}

function sanitizeBackupValue(value: unknown, key?: string): unknown {
  if (key && EXCLUDED_BACKUP_KEYS.has(key)) return undefined;
  if (key && /(?:url|uri)$/i.test(key) && isTemporaryUrl(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeBackupValue(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== 'object' || value === null) return value;
  const sanitized: Record<string, unknown> = {};
  Object.entries(value).forEach(([entryKey, entryValue]) => {
    const next = sanitizeBackupValue(entryValue, entryKey);
    if (next !== undefined) sanitized[entryKey] = next;
  });
  return sanitized;
}

function sanitizedRows<Row>(rows: Row[]) {
  return rows.map((row) => sanitizeBackupValue(row) as Row);
}

function sortRows<Row>(rows: Row[], keyOf: (row: Row) => string) {
  return [...rows].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export async function createYemaiBackup(
  database: YemaiDatabase,
  options: CreateYemaiBackupOptions,
): Promise<YemaiBackupV1> {
  const [conversations, messages, sources, artifacts, readingCards] = await database.transaction(
    'r',
    [
      database.conversations,
      database.messages,
      database.conversationSources,
      database.artifacts,
      database.readingCards,
    ],
    async () => Promise.all([
      database.conversations.toArray(),
      database.messages.toArray(),
      database.conversationSources.toArray(),
      database.artifacts.toArray(),
      database.readingCards.toArray(),
    ]),
  );

  const stableConversations = sanitizedRows(sortRows(conversations, (row) => row.id));
  const stableMessages = sanitizedRows(sortRows(messages, (row) => row.id));
  const stableSources = sanitizedRows(sortRows(sources, (row) => row.id));
  const stableArtifacts = sanitizedRows(sortRows(artifacts, (row) => row.key));
  const stableReadingCards = sanitizedRows(sortRows(readingCards, (row) => row.id));
  return {
    format: YEMAI_BACKUP_FORMAT,
    formatVersion: YEMAI_BACKUP_FORMAT_VERSION,
    appVersion: options.appVersion,
    exportedAt: options.exportedAt ?? Date.now(),
    counts: {
      conversations: stableConversations.length,
      messages: stableMessages.length,
      sources: stableSources.length,
      artifacts: stableArtifacts.length,
      readingCards: stableReadingCards.length,
    },
    conversations: stableConversations,
    messages: stableMessages,
    sources: stableSources,
    artifacts: stableArtifacts,
    readingCards: stableReadingCards,
  };
}

export function serializeYemaiBackup(backup: YemaiBackupV1) {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function yemaiBackupFilename(exportedAt: number) {
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return `yemai-backup-${timestamp}.yemai.json`;
}

export class YemaiBackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YemaiBackupValidationError';
  }
}

function requireEntityRows(
  value: Record<string, unknown>,
  key: keyof Pick<YemaiBackupV1, 'conversations' | 'messages' | 'sources' | 'artifacts' | 'readingCards'>,
  requiredKeys: string[],
) {
  const rows = value[key];
  if (!Array.isArray(rows)) throw new YemaiBackupValidationError(`备份缺少 ${key} 列表。`);
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      throw new YemaiBackupValidationError(`${key} 第 ${index + 1} 项不是有效的数据对象。`);
    }
    const invalidKey = requiredKeys.find((requiredKey) => !hasString(row, requiredKey));
    if (invalidKey) {
      throw new YemaiBackupValidationError(`${key} 第 ${index + 1} 项缺少有效字段 ${invalidKey}。`);
    }
    const identityKey = key === 'artifacts' ? 'key' : 'id';
    const identity = row[identityKey] as string;
    if (ids.has(identity)) throw new YemaiBackupValidationError(`${key} 中存在重复 ID：${identity}。`);
    ids.add(identity);
  });
  return rows as Record<string, unknown>[];
}

export interface ParsedYemaiBackup {
  backup: YemaiBackupV1;
  bytes: number;
}

export function parseYemaiBackup(serialized: string): ParsedYemaiBackup {
  const bytes = new Blob([serialized]).size;
  if (bytes > MAX_YEMAI_BACKUP_BYTES) {
    throw new YemaiBackupValidationError('备份文件超过 50 MB，已在写入前拒绝。');
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new YemaiBackupValidationError('无法解析备份文件，请确认文件没有损坏。');
  }
  if (!isRecord(value) || value.format !== YEMAI_BACKUP_FORMAT) {
    throw new YemaiBackupValidationError('这不是页脉备份文件。');
  }
  if (value.formatVersion !== YEMAI_BACKUP_FORMAT_VERSION) {
    throw new YemaiBackupValidationError(`暂不支持格式版本 ${String(value.formatVersion)}。`);
  }
  if (!hasString(value, 'appVersion') || !isValidTimestamp(value.exportedAt) || !isRecord(value.counts)) {
    throw new YemaiBackupValidationError('备份元数据不完整。');
  }
  if (containsExcludedBackupValue(value)) {
    throw new YemaiBackupValidationError('备份包含凭据、临时文件地址或运行时字段，已在写入前拒绝。');
  }
  const conversations = requireEntityRows(value, 'conversations', ['id', 'title']);
  const messages = requireEntityRows(value, 'messages', ['id', 'conversationId', 'role']);
  const sources = requireEntityRows(value, 'sources', ['id', 'conversationId']);
  const artifacts = requireEntityRows(value, 'artifacts', ['key', 'id', 'conversationId', 'messageId', 'filename']);
  const readingCards = requireEntityRows(value, 'readingCards', ['id', 'sourceConversationId', 'sourceMessageId', 'title']);
  conversations.forEach((row, index) => {
    if (!hasFiniteNumber(row, 'position')
      || !hasFiniteNumber(row, 'updatedAt')
      || !hasStringValue(row, 'subtitle')
      || !hasStringValue(row, 'draftInput')
      || !Array.isArray(row.draftContextItems)
      || !isPageRecord(row.page)) {
      throw new YemaiBackupValidationError(`conversations 第 ${index + 1} 项结构不完整。`);
    }
  });
  messages.forEach((row, index) => {
    if (!hasFiniteNumber(row, 'position')
      || !hasFiniteNumber(row, 'createdAt')
      || !hasStringValue(row, 'content')
      || (row.role !== 'user' && row.role !== 'assistant')
      || !['queued', 'running', 'streaming', 'complete', 'stopped', 'failed'].includes(String(row.status))) {
      throw new YemaiBackupValidationError(`messages 第 ${index + 1} 项结构不完整。`);
    }
  });
  sources.forEach((row, index) => {
    if (!hasFiniteNumber(row, 'position')
      || !hasStringValue(row, 'url')
      || !isPageRecord(row.page)) {
      throw new YemaiBackupValidationError(`sources 第 ${index + 1} 项结构不完整。`);
    }
  });
  artifacts.forEach((row, index) => {
    if (!hasFiniteNumber(row, 'position')
      || !['image', 'html', 'markdown', 'document', 'archive', 'file'].includes(String(row.kind))
      || !['available', 'failed', 'expired'].includes(String(row.status))) {
      throw new YemaiBackupValidationError(`artifacts 第 ${index + 1} 项结构不完整。`);
    }
  });
  readingCards.forEach((row, index) => {
    if (!hasStringValue(row, 'bodyMarkdown')
      || !hasStringValue(row, 'excerpt')
      || (row.kind !== undefined && row.kind !== 'answer' && row.kind !== 'excerpt')
      || !Array.isArray(row.sources)
      || !Array.isArray(row.artifacts)
      || row.sources.some((source) => !isRecord(source)
        || !hasStringValue(source, 'title')
        || !hasStringValue(source, 'url'))
      || row.artifacts.some((artifact) => !isRecord(artifact)
        || !hasString(artifact, 'id')
        || !hasStringValue(artifact, 'filename')
        || !['image', 'html', 'markdown', 'document', 'archive', 'file'].includes(String(artifact.kind))
        || !['available', 'failed', 'expired'].includes(String(artifact.status)))
      || !isValidTimestamp(row.messageCreatedAt)
      || !isValidTimestamp(row.createdAt)
      || !isValidTimestamp(row.updatedAt)) {
      throw new YemaiBackupValidationError(`readingCards 第 ${index + 1} 项结构不完整。`);
    }
  });
  const countEntries: Array<[keyof YemaiBackupCounts, number]> = [
    ['conversations', conversations.length],
    ['messages', messages.length],
    ['sources', sources.length],
    ['artifacts', artifacts.length],
    ['readingCards', readingCards.length],
  ];
  countEntries.forEach(([key, length]) => {
    if (!hasFiniteNumber(value.counts as Record<string, unknown>, key)
      || (value.counts as Record<string, unknown>)[key] !== length) {
      throw new YemaiBackupValidationError(`备份中的 ${key} 数量校验失败。`);
    }
  });
  const conversationIds = new Set(conversations.map((row) => row.id as string));
  const messageIds = new Set(messages.map((row) => row.id as string));
  messages.forEach((row) => {
    if (!conversationIds.has(row.conversationId as string)) {
      throw new YemaiBackupValidationError(`消息 ${String(row.id)} 找不到所属会话。`);
    }
  });
  sources.forEach((row) => {
    if (!conversationIds.has(row.conversationId as string)) {
      throw new YemaiBackupValidationError(`来源 ${String(row.id)} 找不到所属会话。`);
    }
  });
  artifacts.forEach((row) => {
    if (!conversationIds.has(row.conversationId as string) || !messageIds.has(row.messageId as string)) {
      throw new YemaiBackupValidationError(`产物 ${String(row.id)} 找不到所属会话或消息。`);
    }
  });
  return { backup: value as unknown as YemaiBackupV1, bytes };
}
