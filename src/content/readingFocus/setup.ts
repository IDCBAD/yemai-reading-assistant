import type { ReadingFocusPreferences } from '../../shared/readingFocusPreferences';

export function createReadingFocusSetupStart(options: {
  revision(): number;
  url(): string;
  save(preferences: ReadingFocusPreferences): Promise<void>;
  activate(preferences: ReadingFocusPreferences): void;
}) {
  return async (preferences: ReadingFocusPreferences) => {
    const revision = options.revision();
    const url = options.url();
    await options.save(preferences);
    if (revision !== options.revision() || url !== options.url()) return;
    options.activate(preferences);
  };
}
