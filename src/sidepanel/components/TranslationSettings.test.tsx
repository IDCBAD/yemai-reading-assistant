import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSLATION_SETTINGS } from '../../shared/wordTranslation';
import { TranslationSettings, translationSettingsIssue } from './TranslationSettings';

describe('translation settings', () => {
  it('allows a local-only configuration without requiring remote credentials', () => {
    expect(translationSettingsIssue(DEFAULT_TRANSLATION_SETTINGS)).toBeNull();
    expect(translationSettingsIssue({ ...DEFAULT_TRANSLATION_SETTINGS, service: 'local' })).toBeNull();
  });

  it('requires an app ID and nonblank key before enabling remote requests', () => {
    const enabled = { ...DEFAULT_TRANSLATION_SETTINGS, remoteEnabled: true };
    expect(translationSettingsIssue(enabled)).toContain('APPID');
    expect(translationSettingsIssue({ ...enabled, appid: 'not-numeric', apiKey: 'test-secret' })).toContain('APPID');
    expect(translationSettingsIssue({ ...enabled, appid: '12345678901234567', apiKey: '  ' })).toContain('API Key');
    expect(translationSettingsIssue({ ...enabled, appid: '12345678901234567', apiKey: 'test-secret' })).toBeNull();
  });

  it('renders masked credentials with explicit labels and separates estimate from official balance', () => {
    const html = renderToStaticMarkup(<TranslationSettings />);
    expect(html).toContain('type="password"');
    expect(html).toContain('>百度 APPID</label>');
    expect(html).toContain('>百度 API Key</label>');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('value="auto" selected=""');
    expect(html).toContain('value="baidu-llm"');
    expect(html).toContain('value="baidu-nmt"');
    expect(html).toContain('测试额度，并非每月赠送');
    expect(html).toContain('此估算不是剩余额度');
    expect(html).not.toContain('checked=""');
  });
});
