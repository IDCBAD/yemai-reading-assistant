import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase } from './database';
import {
  createYemaiBackup,
  serializeYemaiBackup,
  yemaiBackupFilename,
} from './localBackup';

const databaseNames: string[] = [];

function createDatabase() {
  const name = `local-backup-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return new YemaiDatabase(name);
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('local backup', () => {
  it('exports all durable entity tables in one versioned document', async () => {
    const database = createDatabase();
    await database.conversations.put({
      id: 'conversation-1',
      position: 0,
      title: '备份测试',
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
      content: '答案',
      createdAt: 11,
      status: 'complete',
    });
    await database.conversationSources.put({
      id: 'source-1',
      conversationId: 'conversation-1',
      position: 0,
      url: 'https://example.com',
      page: { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' },
    });
    await database.artifacts.put({
      key: 'message-1:artifact-1',
      id: 'artifact-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      position: 0,
      kind: 'markdown',
      filename: 'answer.md',
      status: 'available',
    });
    await database.readingCards.put({
      id: 'card-1',
      sourceConversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      title: '收藏答案',
      excerpt: '摘要',
      bodyMarkdown: '# 收藏答案',
      sources: [],
      artifacts: [],
      messageCreatedAt: 11,
      createdAt: 12,
      updatedAt: 12,
    });

    const backup = await createYemaiBackup(database, { appVersion: '0.5.0', exportedAt: 100 });

    expect(backup).toMatchObject({
      format: 'yemai-backup',
      formatVersion: 1,
      appVersion: '0.5.0',
      exportedAt: 100,
      counts: { conversations: 1, messages: 1, sources: 1, artifacts: 1, readingCards: 1 },
    });
    expect(backup.conversations[0]?.id).toBe('conversation-1');
    expect(backup.readingCards[0]?.bodyMarkdown).toBe('# 收藏答案');
  });

  it('cannot include credentials, temporary URLs, runtime tab bindings, or meta rows', async () => {
    const database = createDatabase();
    await database.conversations.put({
      id: 'conversation-1',
      position: 0,
      remoteUuid: 'remote-conversation',
      remoteAgentUuid: 'remote-agent',
      pendingBranchContext: 'internal transport handoff',
      title: '安全边界',
      subtitle: '一个页面',
      updatedAt: 10,
      page: {
        title: '文章',
        site: 'example.com',
        url: 'https://example.com',
        status: 'read',
        browserTabId: 88,
      },
      draftInput: '',
      draftContextItems: [{
        id: 'file-1',
        kind: 'file',
        included: true,
        status: 'ready',
        createdAt: 9,
        attachment: {
          id: 'attachment-1',
          filename: 'private.png',
          sizeLabel: '2 KB',
          status: 'ready',
          url: 'blob:private-file',
          previewUrl: 'data:image/png;base64,secret-binary',
        },
      }],
    });
    await database.meta.put({
      key: 'credentials',
      value: {
        accessToken: 'secret-token',
        publicApiToken: 'AP_secret',
        userUuid: 'secret-user',
        organizationUuid: 'secret-organization',
      },
    });

    const serialized = serializeYemaiBackup(await createYemaiBackup(database, {
      appVersion: '0.5.0',
      exportedAt: 100,
    }));

    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('AP_secret');
    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('secret-organization');
    expect(serialized).not.toContain('internal transport handoff');
    expect(serialized).not.toContain('blob:private-file');
    expect(serialized).not.toContain('secret-binary');
    expect(serialized).not.toContain('browserTabId');
    expect(serialized).toContain('remote-conversation');
    expect(serialized).toContain('remote-agent');
    expect(serialized).toContain('private.png');
  });

  it('exports 80 conversations and 2,000 messages without dropping entities', async () => {
    const database = createDatabase();
    const conversations = Array.from({ length: 80 }, (_, index) => ({
      id: `conversation-${index.toString().padStart(2, '0')}`,
      position: index,
      title: `会话 ${index}`,
      subtitle: '25 条消息',
      updatedAt: index,
      page: { title: '文章', site: 'example.com', url: `https://example.com/${index}`, status: 'read' as const },
      draftInput: '',
      draftContextItems: [],
    }));
    const messages = conversations.flatMap((conversation) => Array.from({ length: 25 }, (_, position) => ({
      id: `${conversation.id}-message-${position.toString().padStart(2, '0')}`,
      conversationId: conversation.id,
      position,
      role: position % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `第 ${position} 条消息`,
      createdAt: position,
      status: 'complete' as const,
    })));
    await database.conversations.bulkPut(conversations);
    await database.messages.bulkPut(messages);

    const backup = await createYemaiBackup(database, { appVersion: '0.5.0', exportedAt: 100 });

    expect(backup.counts.conversations).toBe(80);
    expect(backup.counts.messages).toBe(2_000);
    expect(backup.messages).toHaveLength(2_000);
  });

  it('creates a filesystem-safe, recognizable filename', () => {
    expect(yemaiBackupFilename(Date.UTC(2026, 7, 24, 12, 34, 56)))
      .toBe('yemai-backup-2026-08-24T12-34-56-000Z.yemai.json');
  });
});
