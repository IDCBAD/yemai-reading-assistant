import { describe, expect, it } from 'vitest';
import {
  formatStorageBytes,
  resolveKnowledgeStorageUsage,
} from './storageUsage';

describe('local storage usage presentation', () => {
  it('prefers the browser IndexedDB estimate over the origin total', () => {
    expect(resolveKnowledgeStorageUsage(128, {
      usage: 512,
      quota: 2048,
      usageDetails: { indexedDB: 384 },
    })).toEqual({
      knowledgeBytes: 384,
      knowledgeUsageSource: 'browser-indexeddb',
      quotaBytes: 2048,
    });
  });

  it('falls back from the browser origin estimate to the content estimate', () => {
    expect(resolveKnowledgeStorageUsage(128, { usage: 512 })).toEqual({
      knowledgeBytes: 512,
      knowledgeUsageSource: 'browser-origin',
      quotaBytes: undefined,
    });
    expect(resolveKnowledgeStorageUsage(128)).toEqual({
      knowledgeBytes: 128,
      knowledgeUsageSource: 'content-estimate',
      quotaBytes: undefined,
    });
  });

  it('rejects invalid browser estimates and formats bytes without false precision', () => {
    expect(resolveKnowledgeStorageUsage(128, { usage: -1, quota: Number.NaN })).toEqual({
      knowledgeBytes: 128,
      knowledgeUsageSource: 'content-estimate',
      quotaBytes: undefined,
    });
    expect(formatStorageBytes(900)).toBe('900 B');
    expect(formatStorageBytes(1536)).toBe('1.5 KB');
    expect(formatStorageBytes(2.5 * 1024 * 1024)).toBe('2.50 MB');
  });
});
