export type KnowledgeUsageSource = 'browser-indexeddb' | 'browser-origin' | 'content-estimate';

export interface BrowserStorageEstimateLike {
  usage?: number;
  quota?: number;
  usageDetails?: Record<string, number>;
}

export interface LocalStorageUsage {
  historyBytes: number;
  knowledgeBytes: number;
  knowledgeUsageSource: KnowledgeUsageSource;
  settingsBytes: number;
  legacyBackupBytes: number;
  totalBytes: number;
  quotaBytes?: number;
  quotaEstimated: boolean;
}

function finiteBytes(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function resolveKnowledgeStorageUsage(
  contentEstimateBytes: number,
  browserEstimate?: BrowserStorageEstimateLike,
) {
  const indexedDbBytes = finiteBytes(browserEstimate?.usageDetails?.indexedDB);
  const originBytes = finiteBytes(browserEstimate?.usage);
  const fallbackBytes = finiteBytes(contentEstimateBytes) ?? 0;
  const quotaBytes = finiteBytes(browserEstimate?.quota);

  if (indexedDbBytes !== undefined) {
    return { knowledgeBytes: indexedDbBytes, knowledgeUsageSource: 'browser-indexeddb' as const, quotaBytes };
  }
  if (originBytes !== undefined) {
    return { knowledgeBytes: originBytes, knowledgeUsageSource: 'browser-origin' as const, quotaBytes };
  }
  return { knowledgeBytes: fallbackBytes, knowledgeUsageSource: 'content-estimate' as const, quotaBytes };
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
