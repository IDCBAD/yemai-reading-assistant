import { describe, expect, it } from 'vitest';
import { DEFAULT_READING_FOCUS_PREFERENCES, normalizeReadingFocusPreferences } from './readingFocusPreferences';

describe('reading focus local preferences', () => {
  it('preserves the original dimming default and requests no expression scan by default', () => {
    expect(normalizeReadingFocusPreferences(null)).toEqual(DEFAULT_READING_FOCUS_PREFERENCES);
    expect(normalizeReadingFocusPreferences({})).toMatchObject({ dimOpacity: .55, autoScanExpressions: false, initialized: false });
  });
  it('bounds opacity and rejects invalid enum and boolean values', () => {
    expect(normalizeReadingFocusPreferences({ dimOpacity: -1, displayMode: '<script>', highlightEnabled: 'false' }))
      .toMatchObject({ dimOpacity: .08, displayMode: 'full', highlightEnabled: true });
    expect(normalizeReadingFocusPreferences({ dimOpacity: Infinity })).toHaveProperty('dimOpacity', .55);
    expect(normalizeReadingFocusPreferences({ dimOpacity: 4 })).toHaveProperty('dimOpacity', .85);
  });
  it('round trips independent toggles and a completed first setup', () => {
    const input = { initialized: true, dimOpacity: .15, highlightEnabled: false, expressionEnabled: true,
      autoScanExpressions: true, displayMode: 'practice' };
    expect(normalizeReadingFocusPreferences(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
});
