import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot } from './workspaceState';

const localStorageState = vi.hoisted(() => new Map<string, unknown>());
const localStorageWrites = vi.hoisted(() => [] as Record<string, unknown>[]);
const localStorageFailure = vi.hoisted(() => ({ nextWrite: false }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        QUOTA_BYTES: 10 * 1024 * 1024,
        async get(keys: string | string[] | null) {
          const selected = keys === null
            ? [...localStorageState.keys()]
            : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(selected
            .filter((key) => localStorageState.has(key))
            .map((key) => [key, localStorageState.get(key)]));
        },
        async set(values: Record<string, unknown>) {
          if (localStorageFailure.nextWrite) {
            localStorageFailure.nextWrite = false;
            throw new Error('local storage unavailable');
          }
          localStorageWrites.push(values);
          Object.entries(values).forEach(([key, value]) => localStorageState.set(key, value));
        },
        async getBytesInUse() {
          return JSON.stringify(Object.fromEntries(localStorageState)).length;
        },
      },
    },
  },
}));

function workspace(content = '迁移前消息'): WorkspaceState {
  const page = { title: '迁移页面', site: 'example.com', url: 'https://example.com/migrate', status: 'read' as const };
  return {
    conversations: [{
      id: 'conversation-1',
      title: '迁移会话',
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

let loadWorkspaceState: typeof import('./workspaceStorage').loadWorkspaceState;
let saveWorkspaceState: typeof import('./workspaceStorage').saveWorkspaceState;
let database: typeof import('../data/database').yemaiDatabase;

beforeAll(async () => {
  ({ yemaiDatabase: database } = await import('../data/database'));
  await database.delete();
  await database.open();
  ({ loadWorkspaceState, saveWorkspaceState } = await import('./workspaceStorage'));
});

afterAll(async () => {
  await database.delete();
});

describe('workspace storage integration', () => {
  it('migrates the legacy blob, preserves it for rollback, and persists later deltas to IndexedDB', async () => {
    localStorageState.set('workspaceState', createWorkspaceSnapshot(workspace(), 50));

    const migrated = await loadWorkspaceState();

    expect(migrated?.conversations[0]?.messages[0]?.content).toBe('迁移前消息');
    expect(localStorageState.has('workspaceState')).toBe(true);
    expect(localStorageState.get('workspaceUiState')).toMatchObject({ activeOpenTabId: 'open-1' });

    const updated = workspace('迁移后消息');
    localStorageWrites.length = 0;
    await saveWorkspaceState(updated);
    const restored = await loadWorkspaceState();

    expect(restored?.conversations[0]?.messages[0]?.content).toBe('迁移后消息');
    expect(await database.messages.count()).toBe(1);
    expect(localStorageWrites).toHaveLength(0);

    localStorageState.delete('workspaceUiState');
    await loadWorkspaceState();
    expect(localStorageState.get('workspaceUiState')).toMatchObject({ activeOpenTabId: 'open-1' });
  });

  it('keeps a failed save queued so the next call can finish the UI-state write', async () => {
    const updated = workspace('数据库已经更新');
    updated.openTabs[0] = { ...updated.openTabs[0]!, openedAt: 99 };
    localStorageFailure.nextWrite = true;

    await expect(saveWorkspaceState(updated)).rejects.toThrow('local storage unavailable');
    await saveWorkspaceState(updated);

    expect(localStorageState.get('workspaceUiState')).toMatchObject({
      openTabs: [{ id: 'open-1', openedAt: 99 }],
    });
    expect((await database.messages.get('message-1'))?.content).toBe('数据库已经更新');
  });
});
