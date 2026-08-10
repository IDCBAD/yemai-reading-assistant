import { describe, expect, it } from 'vitest';
import { hasDefiniteUrlMismatch, isDefinitelyUnsupportedPage } from './tabTarget';

describe('browser tab targeting', () => {
  it('does not reject a tab merely because Chrome hides its URL', () => {
    expect(isDefinitelyUnsupportedPage(undefined)).toBe(false);
    expect(hasDefiniteUrlMismatch(undefined, 'https://example.com/article')).toBe(false);
  });

  it('rejects only known unsupported pages and definite URL changes', () => {
    expect(isDefinitelyUnsupportedPage('chrome://extensions/')).toBe(true);
    expect(isDefinitelyUnsupportedPage('https://example.com/article')).toBe(false);
    expect(hasDefiniteUrlMismatch('https://example.com/other', 'https://example.com/article')).toBe(true);
  });
});
