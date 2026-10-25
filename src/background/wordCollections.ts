import type { WordCollectionResponse } from '../shared/extensionMessages';
import { isLearningExpressionName } from '../shared/expressionLearning';
import { normalizeSourceIdentityUrl } from '../content/pageManifest';
import { isWordCard, isWordCardCapture, isWordCardEnrichment, isWordMeaningFieldSnapshot, isWordSentenceTranslationFieldSnapshot, type WordCard, type WordCardCapture, type WordCardEnrichment, type WordCardSaveResult, type WordMeaningSource, type WordMeaningFieldSnapshot, type WordSentenceTranslationFieldSnapshot } from '../shared/wordCards';

interface Sender { id?: string; url?: string; frameId?: number; tab?: { id?: number; url?: string } }
export interface WordCollectionDependencies {
  extensionId: string;
  extensionUrl: string;
  runKnowledgeWrite<T>(write: () => Promise<T>): Promise<T>;
  save(capture: WordCardCapture): Promise<WordCardSaveResult>;
  saveExpression(capture: WordCardCapture): Promise<WordCardSaveResult>;
  getCollectedExpressions(url: string, names: string[]): Promise<string[]>;
  updateMeaning(id: string, meaning: string, source: WordMeaningSource, expectedUpdatedAt?: number, expectedField?: WordMeaningFieldSnapshot): Promise<WordCard>;
  enrich(id: string, captureKey: string, patch: WordCardEnrichment): Promise<WordCard>;
  updateSentenceTranslation(id: string, translation: string, expectedUpdatedAt?: number, expectedField?: WordSentenceTranslationFieldSnapshot, source?: 'manual' | 'browser' | 'baidu'): Promise<WordCard>;
  remove(id: string): Promise<void>;
  restore(card: WordCard): Promise<WordCard>;
  notify(): Promise<unknown>;
}

export function isWordCollectionRequest(message: unknown): boolean {
  return Boolean(message && typeof message === 'object' && 'type' in message
    && ['word:save', 'word:save-expression', 'word:expression-status', 'word:update-meaning', 'word:enrich', 'word:update-sentence-translation', 'word:remove', 'word:restore'].includes(String(message.type)));
}

function currentArticle(sender: Sender): string | undefined {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || sender.tab!.id! < 0) return undefined;
  try {
    const source = new URL(sender.url ?? '');
    const current = sender.tab!.url === undefined ? source : new URL(sender.tab!.url);
    if (!['https:', 'http:'].includes(source.protocol) || !['https:', 'http:'].includes(current.protocol)
      || current.origin !== source.origin) return undefined;
    return normalizeSourceIdentityUrl(current.href);
  } catch { return undefined; }
}

function validArticleUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4_096) return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

export async function handleWordCollectionRequest(message: unknown, sender: Sender, deps: WordCollectionDependencies): Promise<WordCollectionResponse> {
  try {
    if (sender.id !== deps.extensionId || !isWordCollectionRequest(message)) throw new Error('单词收藏请求来源无效。');
    const data = message as Record<string, unknown>;
    const extensionPage = Boolean(sender.url?.startsWith(deps.extensionUrl));
    if (data.type === 'word:expression-status') {
      if (!validArticleUrl(data.url) || !Array.isArray(data.names) || data.names.length > 60
        || data.names.some((name) => typeof name !== 'string' || !isLearningExpressionName(name))) throw new Error('表达收藏查询无效。');
      if (!extensionPage && currentArticle(sender) !== normalizeSourceIdentityUrl(data.url)) throw new Error('表达来源与当前页面不一致，请重新打开清单。');
      return { ok: true, savedExpressions: await deps.getCollectedExpressions(data.url, data.names as string[]) };
    }
    if (data.type === 'word:save-expression') {
      if (!isWordCardCapture(data.capture) || !data.capture.expression || data.capture.source.kind !== 'page') throw new Error('所选内容无法保存为表达卡。');
      const capture = data.capture;
      if (!extensionPage && currentArticle(sender) !== normalizeSourceIdentityUrl(capture.source.url!)) throw new Error('表达来源与当前页面不一致，请重新打开清单。');
      const result = await deps.runKnowledgeWrite(() => deps.saveExpression(capture));
      await Promise.resolve().then(() => deps.notify()).catch(() => undefined);
      return { ok: true, ...result };
    }
    if (data.type === 'word:save') {
      if (!isWordCardCapture(data.capture) || data.capture.expression) throw new Error('所选内容无法保存为单词卡。');
      const capture = data.capture;
      if (capture.source.kind === 'assistant' ? !extensionPage : !sender.url || capture.source.url !== sender.url) {
        throw new Error('单词来源与当前页面不一致，请重新划词。');
      }
      const result = await deps.runKnowledgeWrite(() => deps.save(capture));
      // A missing panel listener must not make a committed save look like a failure.
      await Promise.resolve().then(() => deps.notify()).catch(() => undefined);
      return { ok: true, ...result };
    }
    if (!extensionPage) throw new Error('只能在页脉中修改单词收藏。');
    let card: WordCard | undefined;
    if (data.type === 'word:restore') {
      if (!isWordCard(data.card)) throw new Error('单词卡数据无效。');
      const restored = data.card;
      card = await deps.runKnowledgeWrite(() => deps.restore(restored));
    } else {
      if (typeof data.id !== 'string' || !data.id || data.id.length > 200) throw new Error('单词卡编号无效。');
      const id = data.id;
      if (data.type === 'word:remove') await deps.runKnowledgeWrite(() => deps.remove(id));
      else if (data.type === 'word:enrich') {
        if (typeof data.captureKey !== 'string' || !data.captureKey || data.captureKey.length > 8_192 || !isWordCardEnrichment(data.patch)) throw new Error('单词补充内容无效。');
        const { captureKey, patch } = data;
        card = await deps.runKnowledgeWrite(() => deps.enrich(id, captureKey, patch));
      } else if (data.type === 'word:update-sentence-translation') {
        if (typeof data.translation !== 'string' || data.translation.length > 4_000
          || (data.source !== undefined && (typeof data.source !== 'string' || !['manual', 'browser', 'baidu'].includes(data.source)))
          || (data.expectedField !== undefined && !isWordSentenceTranslationFieldSnapshot(data.expectedField))
          || (data.expectedUpdatedAt !== undefined && (typeof data.expectedUpdatedAt !== 'number' || !Number.isSafeInteger(data.expectedUpdatedAt)))) throw new Error('原句译文无效。');
        const { translation, expectedUpdatedAt, expectedField, source } = data;
        card = await deps.runKnowledgeWrite(() => deps.updateSentenceTranslation(id, translation, expectedUpdatedAt as number | undefined, expectedField as WordSentenceTranslationFieldSnapshot | undefined, source as 'manual' | 'browser' | 'baidu' | undefined));
      }
      else {
        if (typeof data.meaning !== 'string' || data.meaning.length > 2_000
          || (data.meaningSource !== 'manual' && data.meaningSource !== 'browser' && data.meaningSource !== 'dictionary' && data.meaningSource !== 'baidu')
          || (data.expectedField !== undefined && !isWordMeaningFieldSnapshot(data.expectedField))
          || (data.expectedUpdatedAt !== undefined && (typeof data.expectedUpdatedAt !== 'number' || !Number.isSafeInteger(data.expectedUpdatedAt)))) {
          throw new Error('释义内容无效。');
        }
        const { meaning, meaningSource, expectedUpdatedAt, expectedField } = data;
        card = await deps.runKnowledgeWrite(() => deps.updateMeaning(id, meaning, meaningSource, expectedUpdatedAt as number | undefined, expectedField as WordMeaningFieldSnapshot | undefined));
      }
    }
    await Promise.resolve().then(() => deps.notify()).catch(() => undefined);
    return { ok: true, card };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '保存单词失败，请重试。' };
  }
}
