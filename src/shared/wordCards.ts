export const WORD_COLLECTION_ENABLED_KEY = 'wordCollectionEnabled';
export const LOCAL_TRANSLATION_ENABLED_KEY = 'localTranslationEnabled';

export type WordMeaningSource = 'manual' | 'browser' | 'dictionary';
export interface WordCardFieldSnapshot<Source extends string = WordMeaningSource> {
  captureKey: string;
  value: string;
  source?: Source;
}
export type WordMeaningFieldSnapshot = WordCardFieldSnapshot<WordMeaningSource>;
export type WordSentenceTranslationFieldSnapshot = WordCardFieldSnapshot<'manual' | 'browser'>;
export interface WordCardEnrichment {
  meaning?: string;
  meaningSource?: 'browser' | 'dictionary';
  sentenceTranslation?: string;
  sentenceTranslationSource?: 'browser';
}

export interface WordCardSource {
  kind: 'page' | 'assistant';
  title: string;
  url?: string;
  conversationId?: string;
  messageId?: string;
}

export interface WordCardCapture {
  word: string;
  /** A captured source sentence, or empty when the surrounding text is unavailable. */
  sentence: string;
  highlightStart?: number;
  highlightEnd?: number;
  source: WordCardSource;
  meaning?: string;
  meaningSource?: WordMeaningSource;
  sentenceTranslation?: string;
  sentenceTranslationSource?: 'manual' | 'browser';
}

export interface WordCard extends WordCardCapture {
  id: string;
  captureKey: string;
  /** Case/whitespace normalization only. This is not a dictionary lemma. */
  normalizedWord: string;
  createdAt: number;
  updatedAt: number;
}

export interface WordCardSaveResult {
  card: WordCard;
  alreadySaved: boolean;
}

export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/gu, ' ').replace(/’/gu, "'").toLowerCase();
}

export function isCollectibleWord(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && text.length <= 80
    && /^[a-z]+(?:['’\-][a-z]+)*(?:\s+[a-z]+(?:['’\-][a-z]+)*){0,4}$/iu.test(text);
}

export function wordCaptureKey(capture: WordCardCapture) {
  return JSON.stringify([
    normalizeWord(capture.word), capture.source.kind,
    capture.source.url ?? '', capture.source.conversationId ?? '', capture.source.messageId ?? '',
    capture.sentence.replace(/\s+/gu, ' ').trim(),
  ]);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldSnapshot(value: unknown, maxLength: number, sources: string[]): boolean {
  return record(value) && typeof value.captureKey === 'string' && value.captureKey.length > 0
    && typeof value.value === 'string' && value.value.length <= maxLength
    && (value.source === undefined || (typeof value.source === 'string' && sources.includes(value.source)))
    && Object.keys(value).every((key) => ['captureKey', 'value', 'source'].includes(key));
}

export function isWordMeaningFieldSnapshot(value: unknown): value is WordMeaningFieldSnapshot {
  return isFieldSnapshot(value, 2_000, ['manual', 'browser', 'dictionary']);
}

export function isWordSentenceTranslationFieldSnapshot(value: unknown): value is WordSentenceTranslationFieldSnapshot {
  return isFieldSnapshot(value, 4_000, ['manual', 'browser']);
}

export function isWordCardCapture(value: unknown): value is WordCardCapture {
  if (!record(value) || typeof value.word !== 'string' || !isCollectibleWord(value.word)
    || typeof value.sentence !== 'string' || value.sentence.length > 1_000 || !record(value.source)) return false;
  const source = value.source;
  if (!['page', 'assistant'].includes(String(source.kind)) || typeof source.title !== 'string' || source.title.length > 500) return false;
  if (source.kind === 'page' && typeof source.url !== 'string') return false;
  if (source.kind === 'assistant' && (typeof source.messageId !== 'string' || !source.messageId)) return false;
  if (source.url !== undefined) {
    if (typeof source.url !== 'string' || source.url.length > 4_096) return false;
    try { if (!['https:', 'http:'].includes(new URL(source.url).protocol)) return false; } catch { return false; }
  }
  if (source.conversationId !== undefined && typeof source.conversationId !== 'string') return false;
  if (source.messageId !== undefined && typeof source.messageId !== 'string') return false;
  if (value.meaning !== undefined && (typeof value.meaning !== 'string' || value.meaning.length > 2_000)) return false;
  if (value.meaningSource !== undefined && (typeof value.meaningSource !== 'string' || !['manual', 'browser', 'dictionary'].includes(value.meaningSource))) return false;
  if (value.sentenceTranslation !== undefined && (typeof value.sentenceTranslation !== 'string' || value.sentenceTranslation.length > 4_000)) return false;
  if (value.sentenceTranslationSource !== undefined && value.sentenceTranslationSource !== 'manual' && value.sentenceTranslationSource !== 'browser') return false;
  if (value.highlightStart !== undefined || value.highlightEnd !== undefined) {
    if (!Number.isInteger(value.highlightStart) || !Number.isInteger(value.highlightEnd)) return false;
    const start = value.highlightStart as number;
    const end = value.highlightEnd as number;
    if (start < 0 || end <= start || end > value.sentence.length
      || normalizeWord(value.sentence.slice(start, end)) !== normalizeWord(value.word)) return false;
  }
  return true;
}

export function isWordCardEnrichment(value: unknown): value is WordCardEnrichment {
  if (!record(value) || Object.keys(value).some((key) => !['meaning', 'meaningSource', 'sentenceTranslation', 'sentenceTranslationSource'].includes(key))) return false;
  const hasMeaning = value.meaning !== undefined;
  const hasSentence = value.sentenceTranslation !== undefined;
  return (hasMeaning || hasSentence)
    && (hasMeaning ? typeof value.meaning === 'string' && value.meaning.length <= 2_000 && (value.meaningSource === 'browser' || value.meaningSource === 'dictionary') : value.meaningSource === undefined)
    && (hasSentence ? typeof value.sentenceTranslation === 'string' && value.sentenceTranslation.length <= 4_000 && value.sentenceTranslationSource === 'browser' : value.sentenceTranslationSource === undefined);
}

export function isWordCard(value: unknown): value is WordCard {
  if (!isWordCardCapture(value) || !record(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && value.captureKey === wordCaptureKey(value)
    && value.normalizedWord === normalizeWord(value.word)
    && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && value.createdAt <= 8_640_000_000_000_000
    && typeof value.updatedAt === 'number' && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= value.createdAt && value.updatedAt <= 8_640_000_000_000_000;
}
