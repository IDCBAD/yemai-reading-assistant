import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot } from '../services/workspaceState';
import { YemaiDatabase } from './database';
import {
  LEGACY_MIGRATION_META_KEY,
  migrateLegacyWorkspace,
} from './legacyWorkspaceMigration';

const databases: YemaiDatabase[] = [];

function createDatabase() {
  const database = new YemaiDatabase(`legacy-migration-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

function legacyWorkspace(): WorkspaceState {
  const page = { title: '旧文章', site: 'example.com', url: 'https://example.com/legacy', status: 'read' as const };
  return {
    conversations: [{
      id: 'legacy-conversation',
      title: '旧会话',
      subtitle: '1 个页面',
      updatedAt: 10,
      page,
      pages: [page],
      messages: [{
        id: 'legacy-message',
        role: 'user',
        content: '旧问题',
        createdAt: 11,
        status: 'complete',
      }],
      draftInput: '',
      draftContextItems: [],
    }],
    openTabs: [{ id: 'legacy-open', conversationId: 'legacy-conversation', openedAt: 12 }],
    activeOpenTabId: 'legacy-open',
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('legacy workspace migration', () => {
  it('migrates a normalized v6 snapshot and verifies the readback', async () => {
    const database = createDatabase();
    const writeUi = vi.fn(async () => undefined);

    const result = await migrateLegacyWorkspace(
      database,
      createWorkspaceSnapshot(legacyWorkspace(), 50),
      writeUi,
      100,
    );

    expect(result).toMatchObject({ migrated: true, conversationCount: 1, messageCount: 1 });
    expect(writeUi).toHaveBeenCalledOnce();
    expect(await database.conversations.count()).toBe(1);
    expect(await database.messages.count()).toBe(1);
    expect((await database.meta.get(LEGACY_MIGRATION_META_KEY))?.value).toMatchObject({
      status: 'complete',
      outcome: 'migrated',
    });
  });

  it('resumes after the database commit when writing UI state was interrupted', async () => {
    const database = createDatabase();
    const failedWriter = vi.fn(async () => {
      throw new Error('side panel closed');
    });
    await expect(migrateLegacyWorkspace(
      database,
      createWorkspaceSnapshot(legacyWorkspace(), 50),
      failedWriter,
      100,
    )).rejects.toThrow('side panel closed');
    expect((await database.meta.get(LEGACY_MIGRATION_META_KEY))?.value).toMatchObject({ status: 'data-written' });

    const resumedWriter = vi.fn(async () => undefined);
    const resumed = await migrateLegacyWorkspace(database, undefined, resumedWriter, 200);

    expect(resumed.migrated).toBe(true);
    expect(resumedWriter).toHaveBeenCalledOnce();
    expect(await database.conversations.count()).toBe(1);
    expect(await database.messages.count()).toBe(1);
    expect((await database.meta.get(LEGACY_MIGRATION_META_KEY))?.value).toMatchObject({ status: 'complete' });
  });

  it('marks an empty installation complete without creating history rows', async () => {
    const database = createDatabase();
    const writeUi = vi.fn(async () => undefined);

    const result = await migrateLegacyWorkspace(database, undefined, writeUi, 100);

    expect(result).toEqual({ migrated: false, conversationCount: 0, messageCount: 0 });
    expect(writeUi).not.toHaveBeenCalled();
    expect(await database.conversations.count()).toBe(0);
  });
});
