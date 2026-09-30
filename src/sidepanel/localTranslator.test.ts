import { afterEach, describe, expect, it, vi } from 'vitest';
import { canTranslateLocally, localTranslationAvailability, translateLocally } from './localTranslator';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Translator');
});

describe('local translation', () => {
  it('offers the action for short English text, but not URLs or long selections', () => {
    expect(canTranslateLocally('context')).toBe(true);
    expect(canTranslateLocally('a meaningful phrase')).toBe(true);
    expect(canTranslateLocally('https://example.com')).toBe(false);
    expect(canTranslateLocally('中文')).toBe(false);
    expect(canTranslateLocally('a'.repeat(241))).toBe(false);
  });

  it('reports unsupported Chrome without making a request', async () => {
    expect(await localTranslationAvailability()).toBe('unavailable');
    await expect(translateLocally('context')).rejects.toThrow('unsupported');
  });

  it('creates a local English to Chinese translator when clicked', async () => {
    const translate = vi.fn(async (text: string) => `译文：${text}`);
    const create = vi.fn(async () => ({ translate }));
    Object.defineProperty(globalThis, 'Translator', {
      configurable: true,
      value: { availability: async () => 'available', create },
    });

    expect(await localTranslationAvailability()).toBe('available');
    await expect(translateLocally('context')).resolves.toBe('译文：context');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sourceLanguage: 'en', targetLanguage: 'zh',
    }));
    expect(translate).toHaveBeenCalledWith('context');
  });
});
