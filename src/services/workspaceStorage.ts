import { browser } from 'wxt/browser';
import type { WorkspaceState } from '../sidepanel/types';
import { yemaiDatabase, type WorkspaceUiState } from '../data/database';
import { migrateLegacyWorkspace, LEGACY_UI_BACKUP_META_KEY } from '../data/legacyWorkspaceMigration';
import { WorkspaceRepository } from '../data/workspaceRepository';
import { estimateReadingCardBytes } from './readingCardStorage';
import {
  DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
  type LocalStorageUsage,
} from './storageUsage';

const WORKSPACE_STORAGE_KEY = 'workspaceState';
const WORKSPACE_UI_STORAGE_KEY = 'workspaceUiState';
const WORKSPACE_MIGRATION_STORAGE_KEY = 'workspaceMigrationState';
const repository = new WorkspaceRepository(yemaiDatabase);
let persistedUiSignature: string | undefined;

function workspaceUiSignature(ui: WorkspaceUiState) {
  return JSON.stringify({ openTabs: ui.openTabs, activeOpenTabId: ui.activeOpenTabId });
}

function isWorkspaceUiState(value: unknown): value is WorkspaceUiState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WorkspaceUiState>;
  return Array.isArray(candidate.openTabs)
    && candidate.openTabs.every((tab) => typeof tab === 'object'
      && tab !== null
      && typeof tab.id === 'string'
      && typeof tab.conversationId === 'string'
      && typeof tab.openedAt === 'number')
    && typeof candidate.activeOpenTabId === 'string'
    && typeof candidate.savedAt === 'number';
}

async function writeWorkspaceUiState(ui: WorkspaceUiState) {
  const signature = workspaceUiSignature(ui);
  if (persistedUiSignature === signature) return;
  await browser.storage.local.set({
    [WORKSPACE_UI_STORAGE_KEY]: ui,
    [WORKSPACE_MIGRATION_STORAGE_KEY]: {
      databaseVersion: yemaiDatabase.verno,
      completedAt: Date.now(),
    },
  });
  persistedUiSignature = signature;
}

async function fallbackWorkspaceUiState(): Promise<WorkspaceUiState | undefined> {
  const backup = (await yemaiDatabase.meta.get(LEGACY_UI_BACKUP_META_KEY))?.value;
  if (isWorkspaceUiState(backup)) return backup;
  const firstConversation = await yemaiDatabase.conversations.orderBy('position').first();
  if (!firstConversation) return undefined;
  const openedAt = Date.now();
  const tab = {
    id: `open-${firstConversation.id}`,
    conversationId: firstConversation.id,
    openedAt,
  };
  return { openTabs: [tab], activeOpenTabId: tab.id, savedAt: openedAt };
}

async function repairWorkspaceUiState(ui: WorkspaceUiState | undefined) {
  const conversations = await yemaiDatabase.conversations.orderBy('position').toArray();
  if (!conversations.length) return undefined;
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const seenConversationIds = new Set<string>();
  const openTabs = (ui?.openTabs ?? []).filter((tab) => {
    if (!conversationIds.has(tab.conversationId) || seenConversationIds.has(tab.conversationId)) return false;
    seenConversationIds.add(tab.conversationId);
    return true;
  });
  if (!openTabs.length) {
    const first = conversations.find((conversation) => conversation.archivedAt === undefined) ?? conversations[0]!;
    openTabs.push({
      id: `open-${first.id}`,
      conversationId: first.id,
      openedAt: Date.now(),
    });
  }
  const activeOpenTabId = openTabs.some((tab) => tab.id === ui?.activeOpenTabId)
    ? ui!.activeOpenTabId
    : openTabs[0]!.id;
  return {
    openTabs,
    activeOpenTabId,
    savedAt: ui?.savedAt ?? Date.now(),
  } satisfies WorkspaceUiState;
}

export async function loadWorkspaceState() {
  const stored = await browser.storage.local.get([WORKSPACE_STORAGE_KEY, WORKSPACE_UI_STORAGE_KEY]);
  persistedUiSignature = isWorkspaceUiState(stored[WORKSPACE_UI_STORAGE_KEY])
    ? workspaceUiSignature(stored[WORKSPACE_UI_STORAGE_KEY])
    : undefined;
  const migration = await migrateLegacyWorkspace(
    yemaiDatabase,
    stored[WORKSPACE_STORAGE_KEY],
    writeWorkspaceUiState,
  );
  const candidateUi = isWorkspaceUiState(stored[WORKSPACE_UI_STORAGE_KEY])
    ? stored[WORKSPACE_UI_STORAGE_KEY]
    : migration.ui ?? await fallbackWorkspaceUiState();
  const ui = await repairWorkspaceUiState(candidateUi);
  if (!ui) return null;
  if (!isWorkspaceUiState(stored[WORKSPACE_UI_STORAGE_KEY])
    || JSON.stringify(stored[WORKSPACE_UI_STORAGE_KEY]) !== JSON.stringify(ui)) {
    await writeWorkspaceUiState(ui);
  }
  const workspace = await repository.load(ui);
  if (!workspace) throw new Error('IndexedDB 中存在历史记录，但无法恢复有效工作区。');
  return workspace;
}

let pendingWorkspace: WorkspaceState | undefined;
let activeSave: Promise<void> | undefined;

async function flushPendingWorkspace() {
  while (pendingWorkspace) {
    const next = pendingWorkspace;
    pendingWorkspace = undefined;
    try {
      const { ui } = await repository.save(next);
      await writeWorkspaceUiState(ui);
    } catch (error) {
      pendingWorkspace ??= next;
      throw error;
    }
  }
}

export function saveWorkspaceState(workspace: WorkspaceState) {
  pendingWorkspace = workspace;
  if (!activeSave) {
    activeSave = flushPendingWorkspace().finally(() => {
      activeSave = undefined;
    });
  }
  return activeSave;
}

export async function loadLocalStorageUsage(): Promise<LocalStorageUsage> {
  const storageEstimate = typeof navigator !== 'undefined'
    ? navigator.storage?.estimate?.().catch(() => undefined)
    : Promise.resolve(undefined);
  const [workspaceBytes, readingCardBytes, localBytes, legacyBackupBytes, estimate] = await Promise.all([
    repository.estimateBytes(),
    estimateReadingCardBytes(),
    browser.storage.local.getBytesInUse(null),
    browser.storage.local.getBytesInUse(WORKSPACE_STORAGE_KEY),
    storageEstimate,
  ]);
  const settingsBytes = Math.max(0, localBytes - legacyBackupBytes);
  const historyBytes = workspaceBytes + readingCardBytes;
  const totalBytes = historyBytes + localBytes;
  return {
    historyBytes,
    settingsBytes,
    legacyBackupBytes,
    totalBytes,
    quotaBytes: estimate?.quota ?? browser.storage.local.QUOTA_BYTES ?? DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
    quotaEstimated: estimate?.quota !== undefined,
  };
}
