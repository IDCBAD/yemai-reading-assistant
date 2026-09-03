import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase } from './database';
import {
  createYemaiBackup,
  parseYemaiBackup,
  serializeYemaiBackup,
  YemaiBackupValidationError,
  type YemaiBackupV1,
} from './localBackup';
import { importYemaiBackup } from './localBackupImport';

const databaseNames: string[] = [];

function createDatabase() {
  const name = `local-backup-import-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return new YemaiDatabase(name);
}

async function createBackup(): Promise<YemaiBackupV1> {
  const database = createDatabase();
  await database.conversations.put({
    id: 'conversation-1',
    position: 0,
    title: '可迁移会话',
    subtitle: '一个页面',
    updatedAt: 10,
    page: { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' },
    draftInput: '',
    draftContextItems: [],
  });
  await database.messages.put({
    id: 'message-1',
    conversationId: 'conversation-1',
    position: 0,
    role: 'assistant',
    content: '可迁移答案',
    createdAt: 11,
    status: 'complete',
  });
  await database.readingCards.put({
    id: 'card-1',
    sourceConversationId: 'conversation-1',
    sourceMessageId: 'message-1',
    title: '可迁移卡片',
    excerpt: '摘要',
    bodyMarkdown: '# 可迁移卡片',
    sources: [],
    artifacts: [],
    messageCreatedAt: 11,
    createdAt: 12,
    updatedAt: 12,
  });
  return createYemaiBackup(database, { appVersion: '0.5.0', exportedAt: 100 });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('local backup import', () => {
  it('accepts placeholder conversation sources whose URL is an empty string', async () => {
    const database = createDatabase();
    const placeholderPage = { title: '当前页面', site: '', url: '', status: 'not-read' as const };
    await database.conversations.put({
      id: 'conversation-placeholder',
      position: 0,
      title: '尚未绑定网页的会话',
      subtitle: '',
      updatedAt: 10,
      page: placeholderPage,
      draftInput: '',
      draftContextItems: [],
    });
    await database.conversationSources.put({
      id: 'conversation-placeholder:position-0',
      conversationId: 'conversation-placeholder',
      position: 0,
      url: '',
      page: placeholderPage,
    });
    const backup = await createYemaiBackup(database, { appVersion: '0.5.0', exportedAt: 100 });
    const parsed = parseYemaiBackup(serializeYemaiBackup(backup)).backup;
    const destination = createDatabase();

    await expect(importYemaiBackup(destination, parsed, 'merge')).resolves.toBeDefined();
    expect((await destination.conversationSources.get('conversation-placeholder:position-0'))?.url).toBe('');
  });

  it('accepts artifact-only answers and reading cards with empty Markdown bodies', async () => {
    const database = createDatabase();
    await database.conversations.put({
      id: 'conversation-artifact',
      position: 0,
      title: '纯产物回答',
      subtitle: '一个页面',
      updatedAt: 10,
      page: { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' },
      draftInput: '',
      draftContextItems: [],
    });
    await database.messages.put({
      id: 'message-artifact',
      conversationId: 'conversation-artifact',
      position: 0,
      role: 'assistant',
      content: '',
      createdAt: 11,
      status: 'complete',
    });
    await database.artifacts.put({
      key: 'message-artifact:file-1',
      id: 'file-1',
      conversationId: 'conversation-artifact',
      messageId: 'message-artifact',
      position: 0,
      kind: 'file',
      filename: 'report.pdf',
      status: 'available',
    });
    await database.readingCards.put({
      id: 'card-artifact',
      sourceConversationId: 'conversation-artifact',
      sourceMessageId: 'message-artifact',
      title: '纯产物卡片',
      excerpt: '',
      bodyMarkdown: '',
      sources: [],
      artifacts: [{ id: 'file-1', kind: 'file', filename: 'report.pdf', status: 'available' }],
      messageCreatedAt: 11,
      createdAt: 12,
      updatedAt: 12,
    });
    const backup = await createYemaiBackup(database, { appVersion: '0.5.0', exportedAt: 100 });
    const parsed = parseYemaiBackup(serializeYemaiBackup(backup)).backup;
    const destination = createDatabase();

    await expect(importYemaiBackup(destination, parsed, 'merge')).resolves.toBeDefined();
    expect((await destination.messages.get('message-artifact'))?.content).toBe('');
    expect((await destination.readingCards.get('card-artifact'))?.bodyMarkdown).toBe('');
    expect(await destination.artifacts.count()).toBe(1);
  });

  it('parses a complete v1 backup and rejects damaged, unknown, or unsafe documents', async () => {
    const backup = await createBackup();
    expect(parseYemaiBackup(serializeYemaiBackup(backup)).backup.counts.messages).toBe(1);
    expect(() => parseYemaiBackup('{broken')).toThrow(YemaiBackupValidationError);
    expect(() => parseYemaiBackup(JSON.stringify({ ...backup, formatVersion: 99 })))
      .toThrow('暂不支持格式版本 99');
    expect(() => parseYemaiBackup(JSON.stringify({
      ...backup,
      conversations: [{ ...backup.conversations[0], browserTabId: 1 }],
    }))).toThrow('包含凭据、临时文件地址或运行时字段');
    expect(() => parseYemaiBackup(JSON.stringify({
      ...backup,
      messages: [{ ...backup.messages[0], conversationId: 'missing' }],
    }))).toThrow('找不到所属会话');
    expect(() => parseYemaiBackup(JSON.stringify({
      ...backup,
      readingCards: [{ ...backup.readingCards[0], kind: 'generated-cognition' }],
    }))).toThrow('readingCards 第 1 项结构不完整');
  });

  it('merges idempotently and keeps the newer reading card', async () => {
    const backup = await createBackup();
    const destination = createDatabase();
    await destination.readingCards.put({ ...backup.readingCards[0]!, title: '本机旧标题', updatedAt: 5 });

    const first = await importYemaiBackup(destination, backup, 'merge');
    const second = await importYemaiBackup(destination, backup, 'merge');

    expect(first.changes.added).toMatchObject({ conversations: 1, messages: 1, readingCards: 0 });
    expect(first.changes.updatedReadingCards).toBe(1);
    expect(second.changes.added).toEqual({ conversations: 0, messages: 0, sources: 0, artifacts: 0, readingCards: 0 });
    expect(second.changes.updatedReadingCards).toBe(0);
    expect(await destination.conversations.count()).toBe(1);
    expect(await destination.messages.count()).toBe(1);
    expect((await destination.readingCards.get('card-1'))?.title).toBe('可迁移卡片');
  });

  it('replaces all durable entity tables in one transaction', async () => {
    const backup = await createBackup();
    const destination = createDatabase();
    await destination.conversations.put({
      id: 'old',
      position: 0,
      title: '旧会话',
      subtitle: '',
      updatedAt: 1,
      page: { title: '旧文章', site: 'old.test', url: 'https://old.test', status: 'read' },
      draftInput: '',
      draftContextItems: [],
    });

    const result = await importYemaiBackup(destination, backup, 'replace');

    expect(result.totalAfter).toEqual(backup.counts);
    expect(await destination.conversations.get('old')).toBeUndefined();
    expect(await destination.conversations.get('conversation-1')).toBeDefined();
  });

  it('rolls back the whole import when any table write fails', async () => {
    const backup = await createBackup();
    const destination = createDatabase();
    destination.readingCards.hook('creating', () => {
      throw new Error('simulated card write failure');
    });

    await expect(importYemaiBackup(destination, backup, 'merge')).rejects.toThrow('simulated card write failure');

    expect(await destination.conversations.count()).toBe(0);
    expect(await destination.messages.count()).toBe(0);
    expect(await destination.readingCards.count()).toBe(0);
  });

  it('keeps a reading card readable even when its original conversation is absent', async () => {
    const backup = await createBackup();
    const cardOnly: YemaiBackupV1 = {
      ...backup,
      counts: { conversations: 0, messages: 0, sources: 0, artifacts: 0, readingCards: 1 },
      conversations: [],
      messages: [],
      sources: [],
      artifacts: [],
    };
    const parsed = parseYemaiBackup(serializeYemaiBackup(cardOnly)).backup;
    const destination = createDatabase();

    await importYemaiBackup(destination, parsed, 'merge');

    expect((await destination.readingCards.get('card-1'))?.bodyMarkdown).toBe('# 可迁移卡片');
  });
});
