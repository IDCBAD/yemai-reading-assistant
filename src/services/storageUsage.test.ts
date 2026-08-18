import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
  formatStorageBytes,
  formatStoragePercent,
  storageUsagePercent,
} from './storageUsage';

describe('local storage usage presentation', () => {
  it('calculates progress against the 10 MiB Chrome quota', () => {
    expect(storageUsagePercent({
      historyBytes: 512 * 1024,
      totalBytes: 1024 * 1024,
      quotaBytes: DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
    })).toBe(10);
  });

  it('clamps invalid and over-quota values', () => {
    expect(storageUsagePercent({ historyBytes: 0, totalBytes: -1, quotaBytes: 0 })).toBe(0);
    expect(storageUsagePercent({ historyBytes: 0, totalBytes: 20, quotaBytes: 10 })).toBe(100);
  });

  it('formats byte and percentage labels without false precision', () => {
    expect(formatStorageBytes(900)).toBe('900 B');
    expect(formatStorageBytes(1536)).toBe('1.5 KB');
    expect(formatStorageBytes(2.5 * 1024 * 1024)).toBe('2.50 MB');
    expect(formatStoragePercent(0.04)).toBe('< 0.1%');
    expect(formatStoragePercent(7.25)).toBe('7.3%');
    expect(formatStoragePercent(72.4)).toBe('72%');
  });
});
