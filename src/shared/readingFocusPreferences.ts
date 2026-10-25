export type ReadingDisplayMode = 'full' | 'skeleton' | 'practice';
export interface ReadingFocusPreferences {
  initialized: boolean;
  dimOpacity: number;
  highlightEnabled: boolean;
  expressionEnabled: boolean;
  autoScanExpressions: boolean;
  displayMode: ReadingDisplayMode;
}
export const READING_FOCUS_PREFERENCES_KEY = 'readingFocusPreferencesV2';
export const DEFAULT_READING_FOCUS_PREFERENCES: ReadingFocusPreferences = {
  initialized: false,
  dimOpacity: .55,
  highlightEnabled: true,
  expressionEnabled: true,
  autoScanExpressions: false,
  displayMode: 'full',
};

/** Only these local display preferences are accepted; they contain no page or account data. */
export function normalizeReadingFocusPreferences(value: unknown): ReadingFocusPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaults = DEFAULT_READING_FOCUS_PREFERENCES;
  return {
    initialized: input.initialized === true,
    dimOpacity: typeof input.dimOpacity === 'number' && Number.isFinite(input.dimOpacity)
      ? Math.max(.08, Math.min(.85, input.dimOpacity)) : defaults.dimOpacity,
    highlightEnabled: typeof input.highlightEnabled === 'boolean' ? input.highlightEnabled : defaults.highlightEnabled,
    expressionEnabled: typeof input.expressionEnabled === 'boolean' ? input.expressionEnabled : defaults.expressionEnabled,
    autoScanExpressions: typeof input.autoScanExpressions === 'boolean' ? input.autoScanExpressions : defaults.autoScanExpressions,
    displayMode: ['full', 'skeleton', 'practice'].includes(String(input.displayMode))
      ? input.displayMode as ReadingDisplayMode : defaults.displayMode,
  };
}
