import { describe, expect, it } from 'vitest';
import {
  includedPageReference,
  isPageReferenceIncluded,
  setPageReferenceIncluded,
  shouldAttachPageSnapshot,
} from './pageReference';

describe('draft page reference', () => {
  it('includes the current page by default', () => {
    const reference = includedPageReference({ url: 'https://example.com/a' });
    expect(isPageReferenceIncluded(reference, { url: 'https://example.com/a' })).toBe(true);
  });

  it('excludes only the page the user cancelled', () => {
    const reference = setPageReferenceIncluded({ url: 'https://example.com/a' }, false);
    expect(isPageReferenceIncluded(reference, { url: 'https://example.com/a' })).toBe(false);
    expect(isPageReferenceIncluded(reference, { url: 'https://example.com/b' })).toBe(true);
  });

  it('never includes an unavailable page', () => {
    expect(isPageReferenceIncluded(includedPageReference({ url: '' }), { url: '' })).toBe(false);
  });

  it('attaches a previously sent page again on follow-up questions', () => {
    expect(shouldAttachPageSnapshot(true, { url: 'https://example.com/a', sentAt: 123 })).toBe(true);
    expect(shouldAttachPageSnapshot(false, { url: 'https://example.com/a' })).toBe(false);
  });
});
