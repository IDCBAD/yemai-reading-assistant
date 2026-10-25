import { describe, expect, it } from 'vitest';
import { isSidepanelTranslationSender, isWebTranslationSender } from './translationSender';
const url = 'chrome-extension://our-extension/sidepanel.html';
describe('manual translation request origin', () => {
  it('accepts only the exact trusted sidepanel document, including query/hash', () => {
    expect(isSidepanelTranslationSender({ id: 'our-extension', url: url + '?mode=words#translation' }, 'our-extension', url)).toBe(true);
    for (const sender of [{ id: 'other', url }, { id: 'our-extension', url: 'https://example.com/sidepanel.html' },
      { id: 'our-extension', url: url + '.sandbox' }, { id: 'our-extension', url: 'chrome-extension://our-extension/html-runtime.html' },
      { id: 'our-extension', url: 'chrome-extension://another-extension/sidepanel.html' }, { id: 'our-extension' }]) {
      expect(isSidepanelTranslationSender(sender, 'our-extension', url)).toBe(false);
    }
  });
  it('preserves the existing top-level webpage restriction for content lookup preferences', () => {
    const sender = { id: 'our-extension', url: 'https://example.com', tab: { id: 1 }, frameId: 0 };
    expect(isWebTranslationSender(sender, 'our-extension')).toBe(true);
    expect(isWebTranslationSender({ ...sender, frameId: 1 }, 'our-extension')).toBe(false);
    expect(isWebTranslationSender({ ...sender, tab: undefined }, 'our-extension')).toBe(false);
    expect(isWebTranslationSender({ ...sender, url }, 'our-extension')).toBe(false);
  });
});
