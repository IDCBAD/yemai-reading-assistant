import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageContextItem } from '../sidepanel/contextItems';
import type { Conversation, PageContext, WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot } from '../services/workspaceState';
import { createWorkspaceSearchIndex } from '../search/workspaceSearch';
import { YemaiDatabase } from './database';
import { migrateLegacyWorkspace } from './legacyWorkspaceMigration';
import { WorkspaceRepository } from './workspaceRepository';

const databases: YemaiDatabase[] = [];

function createDatabase() {
  const database = new YemaiDatabase(`workspace-stress-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

function sourcePage(conversationIndex: number, pageIndex: number): PageContext {
  return {
    title: `会话 ${conversationIndex} · 来源 ${pageIndex}`,
    site: 'example.com',
    url: `https://example.com/research/${conversationIndex}/${pageIndex}`,
    status: 'read',
    pageId: `page-${conversationIndex}-${pageIndex}`,
    sourceId: `source-${conversationIndex}-${pageIndex}`,
    contentHash: `revision-${conversationIndex}-${pageIndex}`,
    extractedAt: 1_700_000_000_000 + conversationIndex * 100 + pageIndex,
    manifest: {
      description: `用于压力测试的页面 ${pageIndex}`,
      outline: [{ level: 1, text: `章节 ${pageIndex}` }],
      relevant_links: [],
      truncated: false,
    },
  };
}

function stressConversation(index: number): Conversation {
  const pages = [0, 1, 2].map((pageIndex) => sourcePage(index, pageIndex));
  const messages = Array.from({ length: 25 }, (_, messageIndex) => {
    const assistant = messageIndex % 2 === 1;
    return {
      id: `message-${index}-${messageIndex}`,
      role: assistant ? 'assistant' as const : 'user' as const,
      content: `${assistant ? '回答' : '问题'} ${index}-${messageIndex}：${'内容'.repeat(40)}`,
      createdAt: 1_700_000_000_000 + index * 1_000 + messageIndex,
      status: 'complete' as const,
      ...(!assistant ? { contextItems: [pageContextItem(pages[messageIndex % pages.length]!)] } : {}),
      ...(assistant ? {
        artifacts: [{
          id: `artifact-${index}-${messageIndex}`,
          kind: 'markdown' as const,
          filename: `研究结果-${index}-${messageIndex}.md`,
          url: `https://example.com/artifacts/${index}/${messageIndex}.md`,
          status: 'available' as const,
        }],
      } : {}),
    };
  });
  return {
    id: `conversation-${index}`,
    remoteUuid: `remote-${index}`,
    title: `研究会话 ${index}`,
    subtitle: '3 个页面',
    updatedAt: 1_700_000_000_000 + index,
    ...(index > 0 && index % 5 === 0 ? {
      branch: {
        rootConversationId: 'conversation-0',
        parentConversationId: 'conversation-0',
        sourceMessageId: 'message-0-1',
        ordinal: index / 5,
      },
    } : {}),
    ...(index >= 10 && index % 7 === 0 ? { archivedAt: 1_700_000_100_000 + index } : {}),
    page: pages[0]!,
    pages,
    messages,
    draftInput: index % 9 === 0 ? `未发送草稿 ${index}` : '',
    draftContextItems: [pageContextItem(pages[0]!)],
  };
}

function stressWorkspace(): WorkspaceState {
  const conversations = Array.from({ length: 80 }, (_, index) => stressConversation(index));
  const openTabs = conversations.slice(0, 10).map((conversation, index) => ({
    id: `open-${index}`,
    conversationId: conversation.id,
    openedAt: 1_700_001_000_000 + index,
  }));
  return { conversations, openTabs, activeOpenTabId: 'open-4' };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('large workspace persistence', () => {
  it('migrates and reconstructs 80 conversations and 2,000 messages without loss', async () => {
    const database = createDatabase();
    const legacy = createWorkspaceSnapshot(stressWorkspace(), 1_700_002_000_000);
    const writeUi = vi.fn(async () => undefined);

    const migration = await migrateLegacyWorkspace(database, legacy, writeUi, 1_700_003_000_000);

    expect(migration).toMatchObject({ migrated: true, conversationCount: 80, messageCount: 2_000 });
    expect(await database.conversations.count()).toBe(80);
    expect(await database.messages.count()).toBe(2_000);
    expect(await database.conversationSources.count()).toBe(240);
    expect(await database.artifacts.count()).toBe(960);
    expect(writeUi).toHaveBeenCalledOnce();

    const repository = new WorkspaceRepository(database);
    const restored = await repository.load(migration.ui!, 1_700_004_000_000);
    expect(restored?.conversations).toHaveLength(80);
    expect(restored?.conversations.reduce((count, conversation) => count + conversation.messages.length, 0)).toBe(2_000);
    expect(restored?.conversations[45]?.draftInput).toBe('未发送草稿 45');
    expect(restored?.conversations[5]?.branch).toMatchObject({
      parentConversationId: 'conversation-0',
      sourceMessageId: 'message-0-1',
    });
    expect(restored?.conversations[14]?.archivedAt).toBeDefined();
  });

  it('updates one message without rewriting the other 3,279 entities', async () => {
    const database = createDatabase();
    const repository = new WorkspaceRepository(database);
    const workspace = stressWorkspace();
    await repository.save(workspace, 1_700_002_000_000);
    workspace.conversations[37]!.messages[18] = {
      ...workspace.conversations[37]!.messages[18]!,
      content: '只修改这一条消息',
    };

    const result = await repository.save(workspace, 1_700_002_000_001);

    expect(result.summary).toEqual({ changed: 1, removed: 0 });
    expect((await database.messages.get('message-37-18'))?.content).toBe('只修改这一条消息');
    expect(await database.messages.count()).toBe(2_000);
  });

  it('indexes 2,000 messages and locates an exact answer within an interactive budget', () => {
    const workspace = stressWorkspace();
    workspace.conversations[62]!.messages[17] = {
      ...workspace.conversations[62]!.messages[17]!,
      content: '唯一验收关键词：星河索引完成',
    };
    const startedAt = performance.now();
    const index = createWorkspaceSearchIndex(workspace);
    const results = index.search('星河索引');
    const elapsed = performance.now() - startedAt;

    expect(index.documentCount).toBe(2_080);
    expect(results[0]).toMatchObject({
      conversationId: 'conversation-62',
      messageId: 'message-62-17',
    });
    expect(elapsed).toBeLessThan(2_000);
  });
});
