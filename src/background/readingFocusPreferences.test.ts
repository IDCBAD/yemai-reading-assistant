import { describe, expect, it, vi } from 'vitest';
import { createReadingFocusPreferencesHandler } from './readingFocusPreferences';
import { DEFAULT_READING_FOCUS_PREFERENCES } from '../shared/readingFocusPreferences';

describe('reading preferences trusted storage bridge', () => {
  const sender = { id: 'own', frameId: 0, url: 'https://example.test/a', tab: { id: 1 } };
  it('reads and writes only normalized display preferences', async () => {
    const save = vi.fn(async () => {});
    const handle = createReadingFocusPreferencesHandler({ extensionId: 'own', load: async () => ({ ...DEFAULT_READING_FOCUS_PREFERENCES, initialized: true }), save });
    const get = await new Promise<any>(resolve => { expect(handle({ type: 'reading-focus:preferences-get' }, sender, resolve)).toBe(true); });
    expect(get).toMatchObject({ ok: true, preferences: { initialized: true, dimOpacity: .55 } });
    const set = await new Promise<any>(resolve => handle({ type: 'reading-focus:preferences-set', preferences: { dimOpacity: -1, token: 'not saved', autoScanExpressions: false } }, sender, resolve));
    expect(set).toMatchObject({ ok: true, preferences: { dimOpacity: .08 } });
    expect(save).toHaveBeenCalledWith(expect.not.objectContaining({ token: expect.anything() }));
  });
  it('rejects foreign senders and subframes before touching storage', () => {
    const load = vi.fn(async () => ({})), save = vi.fn(async () => {});
    const handle = createReadingFocusPreferencesHandler({ extensionId: 'own', load, save });
    for (const from of [{ ...sender, id: 'foreign' }, { ...sender, frameId: 1 }, { ...sender, url: 'file:///a' }]) {
      const respond = vi.fn(); expect(handle({ type: 'reading-focus:preferences-get' }, from, respond)).toBe(false);
      expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    }
    expect(load).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it('reports write errors without returning storage errors or content', async () => {
    const handle = createReadingFocusPreferencesHandler({ extensionId: 'own', load: async () => ({}), save: async () => { throw Error('internal details'); } });
    const result = await new Promise<any>(resolve => handle({ type: 'reading-focus:preferences-set', preferences: {} }, sender, resolve));
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('internal details');
  });
});
