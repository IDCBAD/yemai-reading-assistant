import type { WorkspaceUiState, YemaiDatabase } from './database';
import { WorkspaceRepository } from './workspaceRepository';
import { workspaceToRows } from './workspaceRows';
import { normalizeWorkspaceSnapshot } from '../services/workspaceState';

export const LEGACY_MIGRATION_META_KEY = 'migration:workspaceState:v6';
export const LEGACY_UI_BACKUP_META_KEY = 'migration:workspaceState:v6:ui';

interface LegacyMigrationState {
  status: 'data-written' | 'complete';
  outcome: 'migrated' | 'no-legacy-data';
  conversationCount: number;
  messageCount: number;
  completedAt?: number;
}

function isMigrationState(value: unknown): value is LegacyMigrationState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LegacyMigrationState>;
  return (candidate.status === 'data-written' || candidate.status === 'complete')
    && (candidate.outcome === 'migrated' || candidate.outcome === 'no-legacy-data')
    && typeof candidate.conversationCount === 'number'
    && typeof candidate.messageCount === 'number';
}

function isWorkspaceUiState(value: unknown): value is WorkspaceUiState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WorkspaceUiState>;
  return Array.isArray(candidate.openTabs)
    && typeof candidate.activeOpenTabId === 'string'
    && typeof candidate.savedAt === 'number';
}

export interface LegacyMigrationResult {
  migrated: boolean;
  ui?: WorkspaceUiState;
  conversationCount: number;
  messageCount: number;
}

export async function migrateLegacyWorkspace(
  database: YemaiDatabase,
  legacyValue: unknown,
  writeUiState: (ui: WorkspaceUiState) => Promise<void>,
  now = Date.now(),
): Promise<LegacyMigrationResult> {
  const existingState = (await database.meta.get(LEGACY_MIGRATION_META_KEY))?.value;
  if (isMigrationState(existingState) && existingState.status === 'complete') {
    return {
      migrated: existingState.outcome === 'migrated',
      conversationCount: existingState.conversationCount,
      messageCount: existingState.messageCount,
    };
  }

  if (isMigrationState(existingState) && existingState.status === 'data-written') {
    const ui = (await database.meta.get(LEGACY_UI_BACKUP_META_KEY))?.value;
    if (!isWorkspaceUiState(ui)) throw new Error('迁移恢复状态缺少工作页信息。');
    await writeUiState(ui);
    await database.meta.put({
      key: LEGACY_MIGRATION_META_KEY,
      value: { ...existingState, status: 'complete', completedAt: now } satisfies LegacyMigrationState,
    });
    return {
      migrated: existingState.outcome === 'migrated',
      ui,
      conversationCount: existingState.conversationCount,
      messageCount: existingState.messageCount,
    };
  }

  const normalized = normalizeWorkspaceSnapshot(legacyValue, now);
  if (!normalized) {
    const state: LegacyMigrationState = {
      status: 'complete',
      outcome: 'no-legacy-data',
      conversationCount: 0,
      messageCount: 0,
      completedAt: now,
    };
    await database.meta.put({ key: LEGACY_MIGRATION_META_KEY, value: state });
    return { migrated: false, conversationCount: 0, messageCount: 0 };
  }

  const rows = workspaceToRows(normalized, normalized.savedAt);
  const repository = new WorkspaceRepository(database);
  const state: LegacyMigrationState = {
    status: 'data-written',
    outcome: 'migrated',
    conversationCount: rows.conversations.length,
    messageCount: rows.messages.length,
  };
  await database.transaction(
    'rw',
    [
      database.conversations,
      database.messages,
      database.conversationSources,
      database.artifacts,
      database.meta,
    ],
    async () => {
      await repository.replace(rows);
      await database.meta.bulkPut([
        { key: LEGACY_UI_BACKUP_META_KEY, value: rows.ui },
        { key: LEGACY_MIGRATION_META_KEY, value: state },
      ]);
    },
  );

  const readback = await repository.load(rows.ui, now);
  const readbackMessageCount = readback?.conversations.reduce((count, conversation) => count + conversation.messages.length, 0) ?? 0;
  if (!readback
    || readback.conversations.length !== state.conversationCount
    || readbackMessageCount !== state.messageCount) {
    throw new Error('IndexedDB 迁移回读校验失败。');
  }

  await writeUiState(rows.ui);
  await database.meta.put({
    key: LEGACY_MIGRATION_META_KEY,
    value: { ...state, status: 'complete', completedAt: now } satisfies LegacyMigrationState,
  });
  return {
    migrated: true,
    ui: rows.ui,
    conversationCount: state.conversationCount,
    messageCount: state.messageCount,
  };
}
