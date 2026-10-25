import { browser } from 'wxt/browser';
import { PageReadingRepository } from '../data/pageReadingRepository';
import { loadWorkosConnectionSettings } from '../services/workosConnection';
import { createBackgroundTransport } from './createTransport';
import { createPageReadingRuntime } from './pageReadingRuntime';
import { createReadingFocusPreferencesHandler } from './readingFocusPreferences';
import { READING_FOCUS_PREFERENCES_KEY } from '../shared/readingFocusPreferences';

export function registerPageReadingAnalysis() {
  const runtime = createPageReadingRuntime({
    extensionId: browser.runtime.id,
    repository: new PageReadingRepository(),
    loadConnection: loadWorkosConnectionSettings,
    createTransport: createBackgroundTransport,
    keepAlive: () => browser.runtime.getPlatformInfo(),
  });
  browser.runtime.onMessage.addListener(runtime.handle);
  const preferences = createReadingFocusPreferencesHandler({
    extensionId: browser.runtime.id,
    load: async () => (await browser.storage.local.get(READING_FOCUS_PREFERENCES_KEY))[READING_FOCUS_PREFERENCES_KEY],
    save: async (value) => { await browser.storage.local.set({ [READING_FOCUS_PREFERENCES_KEY]: value }); },
  });
  browser.runtime.onMessage.addListener(preferences);
  // No tab update/removal subscription: leaving reading mode never stops a task.
  return { ...runtime, dispose() {
    browser.runtime.onMessage.removeListener(runtime.handle);
    browser.runtime.onMessage.removeListener(preferences);
    runtime.dispose();
  } };
}
