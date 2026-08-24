import { browser } from 'wxt/browser';
import { yemaiDatabase } from '../data/database';
import {
  createYemaiBackup,
  MAX_YEMAI_BACKUP_BYTES,
  parseYemaiBackup,
  serializeYemaiBackup,
  yemaiBackupFilename,
  type YemaiBackupCounts,
} from '../data/localBackup';
import {
  importYemaiBackup,
  type LocalBackupImportMode,
  type LocalBackupImportResult,
} from '../data/localBackupImport';

const LAST_LOCAL_BACKUP_EXPORT_AT_KEY = 'lastLocalBackupExportAt';

export interface LocalBackupStatus {
  counts: YemaiBackupCounts;
  lastExportedAt?: number;
}

export interface LocalBackupExportReceipt extends LocalBackupStatus {
  exportedAt: number;
  filename: string;
  bytes: number;
}

export interface LocalBackupPreview {
  filename: string;
  bytes: number;
  appVersion: string;
  exportedAt: number;
  counts: YemaiBackupCounts;
}

export interface LocalBackupImportReceipt extends LocalBackupImportResult {
  filename: string;
  importedAt: number;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function loadBackupCounts(): Promise<YemaiBackupCounts> {
  const [conversations, messages, sources, artifacts, readingCards] = await yemaiDatabase.transaction(
    'r',
    [
      yemaiDatabase.conversations,
      yemaiDatabase.messages,
      yemaiDatabase.conversationSources,
      yemaiDatabase.artifacts,
      yemaiDatabase.readingCards,
    ],
    async () => Promise.all([
      yemaiDatabase.conversations.count(),
      yemaiDatabase.messages.count(),
      yemaiDatabase.conversationSources.count(),
      yemaiDatabase.artifacts.count(),
      yemaiDatabase.readingCards.count(),
    ]),
  );
  return { conversations, messages, sources, artifacts, readingCards };
}

export async function loadLocalBackupStatus(): Promise<LocalBackupStatus> {
  const [counts, stored] = await Promise.all([
    loadBackupCounts(),
    browser.storage.local.get(LAST_LOCAL_BACKUP_EXPORT_AT_KEY),
  ]);
  const lastExportedAt = stored[LAST_LOCAL_BACKUP_EXPORT_AT_KEY];
  return {
    counts,
    ...(isValidTimestamp(lastExportedAt) ? { lastExportedAt } : {}),
  };
}

export async function exportLocalBackup(): Promise<LocalBackupExportReceipt> {
  const exportedAt = Date.now();
  const backup = await createYemaiBackup(yemaiDatabase, {
    appVersion: browser.runtime.getManifest().version,
    exportedAt,
  });
  const serialized = serializeYemaiBackup(backup);
  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
  const filename = yemaiBackupFilename(exportedAt);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  await browser.storage.local.set({ [LAST_LOCAL_BACKUP_EXPORT_AT_KEY]: exportedAt });
  return {
    counts: backup.counts,
    lastExportedAt: exportedAt,
    exportedAt,
    filename,
    bytes: blob.size,
  };
}

async function readBackupFile(file: File) {
  if (file.size > MAX_YEMAI_BACKUP_BYTES) {
    throw new Error('备份文件超过 50 MB，已在写入前拒绝。');
  }
  return parseYemaiBackup(await file.text());
}

export async function inspectLocalBackup(file: File): Promise<LocalBackupPreview> {
  const { backup, bytes } = await readBackupFile(file);
  return {
    filename: file.name,
    bytes,
    appVersion: backup.appVersion,
    exportedAt: backup.exportedAt,
    counts: backup.counts,
  };
}

export async function importLocalBackup(
  file: File,
  mode: LocalBackupImportMode,
): Promise<LocalBackupImportReceipt> {
  const { backup } = await readBackupFile(file);
  const result = await importYemaiBackup(yemaiDatabase, backup, mode);
  return {
    ...result,
    filename: file.name,
    importedAt: Date.now(),
  };
}

export type { LocalBackupImportMode };
