import { describe, expect, it } from 'vitest';
import { pageChangeSignature, shouldPublishPageChange } from './pageChange';

const page = {
  title: 'Introduction',
  site: 'example.com',
  url: 'https://example.com/book/introduction',
};

describe('page change synchronization', () => {
  it('deduplicates metadata updates for the same page', () => {
    const signature = pageChangeSignature(page);
    expect(shouldPublishPageChange(signature, page)).toBe(false);
  });

  it('publishes URL and title changes', () => {
    const signature = pageChangeSignature(page);
    expect(shouldPublishPageChange(signature, { ...page, url: 'https://example.com/book/chapter-1' })).toBe(true);
    expect(shouldPublishPageChange(signature, { ...page, title: 'Chapter 1' })).toBe(true);
  });

  it('publishes a soft navigation even when metadata is unchanged', () => {
    const signature = pageChangeSignature(page);
    expect(shouldPublishPageChange(signature, page, true)).toBe(true);
  });
});
