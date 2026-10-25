import type { WordCardCapture } from './wordCards';

export type TranslationService = 'auto' | 'baidu-llm' | 'baidu-nmt' | 'local';
export const TRANSLATION_SETTINGS_KEY = 'wordTranslationSettings';
export const TRANSLATION_USAGE_KEY = 'wordTranslationUsage';
export interface TranslationSettings {
  service: TranslationService;
  appid: string;
  apiKey: string;
  remoteEnabled: boolean;
}
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = { service: 'auto', appid: '', apiKey: '', remoteEnabled: false };
export interface WordTranslationInput { word: string; sentence: string; service?: TranslationService }
export interface WordTranslationExample {
  text: string;
  translation?: string;
  /** The actual source; a translator response must not invent dictionary examples. */
  source: 'page' | 'dictionary';
}
export interface WordTranslationResult {
  service: Exclude<TranslationService, 'auto'>;
  meaning: string | null;
  meaningSource?: 'dictionary' | 'baidu';
  pronunciation?: string | null;
  sentenceTranslation?: string;
  contextMeaning?: string;
  examples: WordTranslationExample[];
  cached?: boolean;
  notice?: string;
}
export interface TranslationUsage { month: string; llm: number; nmt: number }
/** Public preference only. Never include account credentials in runtime replies. */
export interface TranslationPreference { service: TranslationService; remoteEnabled: boolean; configured: boolean }
export interface ManualTranslationInput { text: string; service?: TranslationService }
export interface ManualTranslationResult {
  translation: string;
  service: 'baidu-llm' | 'baidu-nmt' | 'browser';
  source: 'baidu' | 'browser';
  notice?: string;
}
export const MAX_MANUAL_TRANSLATION_CHARS = 5000;
export function canTranslateText(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && value.length <= MAX_MANUAL_TRANSLATION_CHARS
    && /[a-z]/i.test(value) && !/^https?:\/\//i.test(value);
}
export function usesRemoteTranslation(preference: TranslationPreference): boolean {
  return preference.service !== 'local' && preference.remoteEnabled && preference.configured;
}
export const TRANSLATION_SERVICES: { value: TranslationService; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'baidu-llm', label: '百度 · 大模型翻译' },
  { value: 'baidu-nmt', label: '百度 · 机器翻译' }, { value: 'local', label: '本地词典' },
];
export function isTranslationService(value: unknown): value is TranslationService {
  return TRANSLATION_SERVICES.some(item => item.value === value);
}
export function normalizeTranslationSettings(value: unknown): TranslationSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { service: isTranslationService(data.service) ? data.service : 'auto',
    appid: typeof data.appid === 'string' ? data.appid.trim().slice(0, 100) : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey.trim().slice(0, 512) : '', remoteEnabled: data.remoteEnabled === true };
}
export function translationInputFromCapture(capture: WordCardCapture, service?: TranslationService): WordTranslationInput {
  return { word: capture.word, sentence: capture.sentence, service };
}
