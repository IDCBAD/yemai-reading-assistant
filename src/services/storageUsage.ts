export const DEFAULT_LOCAL_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;

export interface LocalStorageUsage {
  historyBytes: number;
  settingsBytes: number;
  legacyBackupBytes: number;
  totalBytes: number;
  quotaBytes: number;
  quotaEstimated: boolean;
}

export function storageUsagePercent(usage: LocalStorageUsage) {
  if (!Number.isFinite(usage.totalBytes) || !Number.isFinite(usage.quotaBytes) || usage.quotaBytes <= 0) return 0;
  return Math.max(0, Math.min(100, usage.totalBytes / usage.quotaBytes * 100));
}

export function formatStorageBytes(bytes: number) {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safeBytes < 1024) return `${Math.round(safeBytes)} B`;
  if (safeBytes < 1024 * 1024) {
    const kilobytes = safeBytes / 1024;
    return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
  }
  const megabytes = safeBytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(2) : megabytes.toFixed(1)} MB`;
}

export function formatStoragePercent(percent: number) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  if (safePercent > 0 && safePercent < 0.1) return '< 0.1%';
  return `${safePercent < 10 ? safePercent.toFixed(1) : Math.round(safePercent)}%`;
}
