import { browser } from 'wxt/browser';
import { translateLocally } from './localTranslator';
import { canTranslateText, usesRemoteTranslation, type ManualTranslationResult, type TranslationPreference } from '../shared/wordTranslation';

export function isRemoteManualPreference(preference: TranslationPreference) {
  return preference.service === 'baidu-llm' || preference.service === 'baidu-nmt' || usesRemoteTranslation(preference);
}
export function manualTranslationEnabled(preference: TranslationPreference | null, localEnabled: boolean) {
  return Boolean(preference && (isRemoteManualPreference(preference) || localEnabled));
}
export function manualTranslationLabel(preference: TranslationPreference | null) {
  if (!preference) return '正在读取翻译设置';
  if (!isRemoteManualPreference(preference)) return '浏览器本地翻译';
  return preference.service === 'baidu-llm' ? '百度 · 大模型翻译' : '百度 · 机器翻译';
}
export async function loadTranslationPreference(): Promise<TranslationPreference> {
  const response = await browser.runtime.sendMessage({ type: 'word-translation:preference' }) as { ok?: boolean; preference?: TranslationPreference };
  if (!response?.ok || !response.preference) throw new Error('无法读取翻译服务设置。');
  return response.preference;
}

/** Must be called directly from the click for browser language-pack preparation. */
export function translateManually(text: string, options: {
  preference: TranslationPreference;
  onDownloadProgress?: (progress: number) => void;
}): Promise<ManualTranslationResult> {
  if (!canTranslateText(text)) return Promise.reject(new Error('请选择不超过 5000 字符的英文内容。'));
  if (isRemoteManualPreference(options.preference)) {
    return browser.runtime.sendMessage({ type: 'word-translation:text', input: { text, service: options.preference.service } })
      .then((response: { ok?: boolean; result?: ManualTranslationResult; error?: string }) => {
        if (!response?.ok || !response.result) throw new Error(response?.error || '翻译暂时不可用。');
        return response.result;
      });
  }
  // No asynchronous preference read before this call: retain the user's click activation.
  return translateLocally(text, options.onDownloadProgress).then(translation => ({ translation, service: 'browser', source: 'browser' }));
}
