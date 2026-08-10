import { describe, expect, it } from 'vitest';
import { shouldRefreshPageMetadataForTab } from './pageMetadataSync';

describe('page metadata synchronization', () => {
  it('ignores updates from background tabs', () => {
    expect(shouldRefreshPageMetadataForTab(2, 1, { title: 'Updated elsewhere' })).toBe(false);
  });

  it('refreshes only meaningful updates from the active tab', () => {
    expect(shouldRefreshPageMetadataForTab(1, 1, { status: 'loading' })).toBe(false);
    expect(shouldRefreshPageMetadataForTab(1, 1, { status: 'complete' })).toBe(true);
    expect(shouldRefreshPageMetadataForTab(1, 1, { url: 'https://example.com/next' })).toBe(true);
  });
});
