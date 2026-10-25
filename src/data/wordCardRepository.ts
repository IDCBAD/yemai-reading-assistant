import type { YemaiDatabase } from './database';
import { normalizeLearningExpressionName } from '../shared/expressionLearning';
import { normalizeSourceIdentityUrl } from '../content/pageManifest';
import { isWordCard, isWordCardCapture, isWordCardEnrichment, isWordMeaningFieldSnapshot, isWordSentenceTranslationFieldSnapshot, normalizeWord, wordCaptureKey, type WordCard, type WordCardCapture, type WordCardEnrichment, type WordCardSaveResult, type WordMeaningSource, type WordMeaningFieldSnapshot, type WordSentenceTranslationFieldSnapshot } from '../shared/wordCards';

export class WordCardRepository {
  constructor(private readonly database: YemaiDatabase) {}

  async loadAll(): Promise<WordCard[]> {
    return this.database.wordCards.orderBy('createdAt').reverse().toArray();
  }

  async getCollectedExpressions(url: string, names: string[]): Promise<string[]> {
    const article = normalizeSourceIdentityUrl(url);
    const requested = new Set(names.map(normalizeLearningExpressionName));
    const cards = await this.database.wordCards.filter((card) => card.source.kind === 'page'
      && Boolean(card.expression) && normalizeSourceIdentityUrl(card.source.url ?? '') === article
      && requested.has(normalizeLearningExpressionName(card.expression!.name))).toArray();
    return [...new Set(cards.map((card) => normalizeLearningExpressionName(card.expression!.name)))];
  }

  async saveExpressionCapture(capture: WordCardCapture): Promise<WordCardSaveResult> {
    if (!isWordCardCapture(capture) || !capture.expression || capture.source.kind !== 'page') throw new Error('表达收藏内容无效。');
    return this.database.transaction('rw', this.database.wordCards, async () => {
      // A single table transaction serializes independent tabs/repository instances.
      const captureKey = wordCaptureKey(capture);
      const saved = await this.database.wordCards.where('captureKey').equals(captureKey).first();
      if (saved) return { card: saved, alreadySaved: true };
      const now = Date.now();
      const card: WordCard = { ...structuredClone(capture), word: capture.word.trim(),
        id: crypto.randomUUID(), captureKey, normalizedWord: normalizeWord(capture.word), createdAt: now, updatedAt: now };
      await this.database.wordCards.add(card);
      return { card, alreadySaved: false };
    });
  }

  async saveCapture(capture: WordCardCapture): Promise<WordCardSaveResult> {
    if (!isWordCardCapture(capture)) throw new Error('单词收藏内容无效。');
    if (capture.expression) return this.saveExpressionCapture(capture);
    return this.database.transaction('rw', this.database.wordCards, async () => {
      const captureKey = wordCaptureKey(capture);
      const existing = await this.database.wordCards.where('captureKey').equals(captureKey).first();
      if (existing) {
        // A later explicit “collect with translation” may enrich an empty card,
        // but repeating a capture never replaces an existing meaning.
        const meaning = capture.meaning?.trim();
        if (!existing.meaning?.trim() && existing.meaningSource !== 'manual' && (capture.meaningSource === 'browser' || capture.meaningSource === 'baidu') && meaning) {
          const card: WordCard = {
            ...existing, meaning, meaningSource: capture.meaningSource,
            updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
          };
          await this.database.wordCards.put(card);
          if (!card.sentenceTranslation?.trim() && card.sentenceTranslationSource !== 'manual' && capture.sentenceTranslationSource === 'baidu' && capture.sentenceTranslation?.trim()) {
            card.sentenceTranslation = capture.sentenceTranslation.trim(); card.sentenceTranslationSource = 'baidu';
            await this.database.wordCards.put(card);
          }
          return { card, alreadySaved: true };
        }
        if (!existing.sentenceTranslation?.trim() && existing.sentenceTranslationSource !== 'manual' && capture.sentenceTranslationSource === 'baidu' && capture.sentenceTranslation?.trim()) {
          const card: WordCard = { ...existing, sentenceTranslation: capture.sentenceTranslation.trim(), sentenceTranslationSource: 'baidu', updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
          await this.database.wordCards.put(card); return { card, alreadySaved: true };
        }
        return { card: existing, alreadySaved: true };
      }
      const now = Date.now();
      const card: WordCard = {
        ...structuredClone(capture), word: capture.word.trim(),
        id: crypto.randomUUID(), captureKey, normalizedWord: normalizeWord(capture.word),
        createdAt: now, updatedAt: now,
      };
      await this.database.wordCards.add(card);
      return { card, alreadySaved: false };
    });
  }

  async updateMeaning(id: string, meaning: string, source: WordMeaningSource, expectedUpdatedAt?: number, expectedField?: WordMeaningFieldSnapshot): Promise<WordCard> {
    if (typeof meaning !== 'string' || meaning.length > 2_000 || !['manual', 'browser', 'dictionary', 'baidu'].includes(source)
      || (expectedField !== undefined && !isWordMeaningFieldSnapshot(expectedField))) {
      throw new Error('单词释义无效。');
    }
    return this.database.transaction('rw', this.database.wordCards, async () => {
      const existing = await this.database.wordCards.get(id);
      if (!existing) throw new Error('这张单词卡片已不存在。');
      const conflict = expectedField
        ? existing.captureKey !== expectedField.captureKey || (existing.meaning ?? '') !== expectedField.value || existing.meaningSource !== expectedField.source
        : (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) || (source !== 'manual' && existing.meaningSource === 'manual');
      if (conflict) throw new Error('释义已修改，请刷新后重试。');
      const card: WordCard = { ...existing, meaning: meaning.trim(), meaningSource: source, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
      await this.database.wordCards.put(card);
      return card;
    });
  }

  async enrich(id: string, captureKey: string, patch: WordCardEnrichment): Promise<WordCard> {
    if (!isWordCardEnrichment(patch)) throw new Error('单词补充内容无效。');
    return this.database.transaction('rw', this.database.wordCards, async () => {
      const existing = await this.database.wordCards.get(id);
      if (!existing) throw new Error('这张单词卡片已不存在。');
      if (existing.captureKey !== captureKey) throw new Error('单词来源已改变，请重新打开卡片。');
      const card = { ...existing };
      if (!existing.meaning?.trim() && existing.meaningSource !== 'manual' && patch.meaning?.trim()) {
        card.meaning = patch.meaning.trim();
        card.meaningSource = patch.meaningSource;
      }
      if (!existing.sentenceTranslation?.trim() && existing.sentenceTranslationSource !== 'manual' && patch.sentenceTranslation?.trim()) {
        card.sentenceTranslation = patch.sentenceTranslation.trim();
        card.sentenceTranslationSource = patch.sentenceTranslationSource;
      }
      if (card.meaning === existing.meaning && card.sentenceTranslation === existing.sentenceTranslation) return existing;
      card.updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
      await this.database.wordCards.put(card);
      return card;
    });
  }

  async updateSentenceTranslation(id: string, translation: string, expectedUpdatedAt?: number, expectedField?: WordSentenceTranslationFieldSnapshot, source: 'manual' | 'browser' | 'baidu' = 'manual'): Promise<WordCard> {
    if (typeof translation !== 'string' || translation.length > 4_000
      || !['manual', 'browser', 'baidu'].includes(source)
      || (expectedField !== undefined && !isWordSentenceTranslationFieldSnapshot(expectedField))) throw new Error('原句译文无效。');
    return this.database.transaction('rw', this.database.wordCards, async () => {
      const existing = await this.database.wordCards.get(id);
      if (!existing) throw new Error('这张单词卡片已不存在。');
      const conflict = expectedField
        ? existing.captureKey !== expectedField.captureKey || (existing.sentenceTranslation ?? '') !== expectedField.value || existing.sentenceTranslationSource !== expectedField.source
        : expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt;
      if (conflict) throw new Error('卡片已修改，请刷新后重试。');
      const card: WordCard = { ...existing, sentenceTranslation: translation.trim(), sentenceTranslationSource: source, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
      await this.database.wordCards.put(card);
      return card;
    });
  }

  async remove(id: string): Promise<void> {
    await this.database.wordCards.delete(id);
  }

  async restore(card: WordCard): Promise<WordCard> {
    if (!isWordCard(card)) throw new Error('单词卡片无效。');
    return this.database.transaction('rw', this.database.wordCards, async () => {
      const existing = await this.database.wordCards.where('captureKey').equals(card.captureKey).first();
      if (existing) return existing;
      // A stale undo must never overwrite an unrelated card reusing this ID.
      if (await this.database.wordCards.get(card.id)) throw new Error('单词卡片 ID 已被使用。');
      await this.database.wordCards.add(card);
      return card;
    });
  }

  async estimateBytes(): Promise<number> {
    return new Blob([JSON.stringify(await this.database.wordCards.toArray())]).size;
  }
}
