import { browser } from 'wxt/browser';
import { isLearningExpressionName, normalizeLearningExpressionName } from '../shared/expressionLearning';
import type { WordCollectionRequest, WordCollectionResponse } from '../shared/extensionMessages';
import { isWordCard, wordCaptureKey, type WordCard, type WordCardCapture, type WordCardEnrichment, type WordCardSaveResult, type WordMeaningSource, type WordMeaningFieldSnapshot, type WordSentenceTranslationFieldSnapshot } from '../shared/wordCards';

async function send(request: WordCollectionRequest) {
  const response = await browser.runtime.sendMessage(request) as WordCollectionResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || '无法连接收藏服务，请重新打开插件后重试。');
  return response;
}

function requireCard(response: Extract<WordCollectionResponse, { ok: true }>): WordCard {
  if (!isWordCard(response.card)) throw new Error('收藏服务没有返回完整单词卡，请重新打开单词本检查。');
  return response.card;
}

export async function collectWord(capture: WordCardCapture): Promise<WordCardSaveResult> {
  const response = await send({ type: 'word:save', capture });
  return { card: requireCard(response), alreadySaved: response.alreadySaved === true };
}

export async function collectExpression(capture: WordCardCapture): Promise<WordCardSaveResult> {
  const response = await send({ type: 'word:save-expression', capture });
  const card = requireCard(response);
  if (!capture.expression || !card.expression || card.captureKey !== wordCaptureKey(capture)) throw new Error('表达收藏返回的来源不一致，请重新打开清单。');
  return { card, alreadySaved: response.alreadySaved === true };
}

export async function getCollectedExpressions(url: string, names: string[]): Promise<string[]> {
  const response = await send({ type: 'word:expression-status', url, names });
  const requested = new Set(names.map(normalizeLearningExpressionName));
  if (!Array.isArray(response.savedExpressions) || response.savedExpressions.some((name) => typeof name !== 'string'
    || !isLearningExpressionName(name) || !requested.has(normalizeLearningExpressionName(name)))) throw new Error('表达收藏状态无效，请重新打开清单。');
  return [...new Set(response.savedExpressions.map(normalizeLearningExpressionName))];
}

export async function updateCollectedWordMeaning(id: string, meaning: string, meaningSource: WordMeaningSource, expectedUpdatedAt?: number, expectedField?: WordMeaningFieldSnapshot): Promise<WordCard> {
  return requireCard(await send({ type: 'word:update-meaning', id, meaning, meaningSource, expectedUpdatedAt, expectedField }));
}

export async function enrichCollectedWord(id: string, captureKey: string, patch: WordCardEnrichment): Promise<WordCard> {
  return requireCard(await send({ type: 'word:enrich', id, captureKey, patch }));
}

export async function updateCollectedWordSentenceTranslation(id: string, translation: string, expectedUpdatedAt?: number, expectedField?: WordSentenceTranslationFieldSnapshot, source?: 'manual' | 'browser' | 'baidu'): Promise<WordCard> {
  return requireCard(await send({ type: 'word:update-sentence-translation', id, translation, expectedUpdatedAt, expectedField, ...(source ? { source } : {}) }));
}

export async function removeCollectedWord(id: string): Promise<void> {
  await send({ type: 'word:remove', id });
}

export async function restoreCollectedWord(card: WordCard): Promise<WordCard> {
  return requireCard(await send({ type: 'word:restore', card }));
}
