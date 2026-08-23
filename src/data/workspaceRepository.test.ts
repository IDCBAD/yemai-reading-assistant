import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../sidepanel/types';
import { YemaiDatabase } from './database';
import { WorkspaceRepository } from './workspaceRepository';

const databases: YemaiDatabase[] = [];

function createDatabase() {
  const database = new YemaiDatabase(`workspace-repository-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

function workspace(content = '第一版'): WorkspaceState {
  const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };
  return {
    conversations: [{
      id: 'conversation-1',
      title: '测试会话',
      subtitle: '1 个页面',
      updatedAt: 10,
      page,
      pages: [page],
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content,
        createdAt: 11,
        status: 'complete',
      }],
      draftInput: '',
      draftContextItems: [],
    }],
    openTabs: [{ id: 'open-1', conversationId: 'conversation-1', openedAt: 12 }],
    activeOpenTabId: 'open-1',
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('WorkspaceRepository', () => {
  it('writes normalized rows and skips unchanged records', async () => {
    const database = createDatabase();
    const repository = new WorkspaceRepository(database);

    const first = await repository.save(workspace(), 100);
    const unchanged = await repository.save(workspace(), 101);
    const changed = await repository.save(workspace('第二版'), 102);

    expect(first.summary.changed).toBe(3);
    expect(unchanged.summary).toEqual({ changed: 0, removed: 0 });
    expect(changed.summary).toEqual({ changed: 1, removed: 0 });
    expect((await database.messages.get('message-1'))?.content).toBe('第二版');
  });

  it('removes rows that disappeared from the workspace', async () => {
    const database = createDatabase();
    const repository = new WorkspaceRepository(database);
    await repository.save(workspace());
    const empty = workspace();
    empty.conversations[0]!.messages = [];

    const result = await repository.save(empty);

    expect(result.summary.removed).toBe(1);
    expect(await database.messages.count()).toBe(0);
  });

  it('does not delete records created by another repository instance', async () => {
    const database = createDatabase();
    const firstWindow = new WorkspaceRepository(database);
    const secondWindow = new WorkspaceRepository(database);
    const original = workspace();
    await firstWindow.save(original);
    await secondWindow.load({
      openTabs: original.openTabs,
      activeOpenTabId: original.activeOpenTabId,
      savedAt: 20,
    });

    const withExternalConversation = workspace();
    withExternalConversation.conversations.push({
      ...withExternalConversation.conversations[0]!,
      id: 'conversation-external',
      title: '另一个窗口创建',
      messages: [],
    });
    await firstWindow.save(withExternalConversation);
    await secondWindow.save(original);

    expect(await database.conversations.count()).toBe(2);
    expect(await database.conversations.get('conversation-external')).toBeDefined();
  });
});
