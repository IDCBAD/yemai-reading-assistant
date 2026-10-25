import { describe, expect, it, vi } from 'vitest';
import { createReadingFocusSetupStart } from './setup';
import { DEFAULT_READING_FOCUS_PREFERENCES } from '../../shared/readingFocusPreferences';

describe('first setup pending save', () => {
  const preferences = { ...DEFAULT_READING_FOCUS_PREFERENCES, initialized: true };
  for (const action of ['cancel', 'navigate', 'invalidate'] as const) {
    it(`does not activate after ${action} while a save is pending`, async () => {
      let revision = 0, url = 'https://example.test/a', resolve!: () => void;
      const activate = vi.fn();
      const start = createReadingFocusSetupStart({ revision: () => revision, url: () => url,
        save: () => new Promise<void>(done => { resolve = done; }), activate });
      const saving = start(preferences);
      expect(activate).not.toHaveBeenCalled();
      if (action === 'navigate') url = 'https://example.test/b'; else revision++;
      resolve(); await saving;
      expect(activate).not.toHaveBeenCalled();
    });
  }
  it('activates exactly once after a successful unchanged setup', async () => {
    const activate = vi.fn();
    const start = createReadingFocusSetupStart({ revision: () => 1, url: () => 'https://example.test/a', save: async () => {}, activate });
    await start(preferences); expect(activate).toHaveBeenCalledExactlyOnceWith(preferences);
  });
  it('does not activate when persistence fails', async () => {
    const activate = vi.fn();
    const start = createReadingFocusSetupStart({ revision: () => 1, url: () => 'https://example.test/a', save: async () => { throw Error('disk'); }, activate });
    await expect(start(preferences)).rejects.toThrow('disk'); expect(activate).not.toHaveBeenCalled();
  });
});
