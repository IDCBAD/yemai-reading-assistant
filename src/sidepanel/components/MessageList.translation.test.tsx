import { describe, expect, it } from 'vitest';
import { answerTranslationScope, captureAnswerTranslation } from './MessageList';
import type { WordCardCapture } from '../../shared/wordCards';

const capture: WordCardCapture = {
  word: 'theme', sentence: 'Refresh a theme.', highlightStart: 10, highlightEnd: 15,
  source: { kind: 'assistant', title: '页脉回答', messageId: 'answer-one' },
};
const context = { text: capture.sentence, highlightStart: 10, highlightEnd: 15 };
const translated = (): Parameters<typeof captureAnswerTranslation>[0] => ({
  source: 'theme', wordCapture: capture, context, result: '主题', meaningSource: 'baidu',
  sentenceResult: '更换一个主题。', sentenceTranslationSource: 'baidu',
  status: 'ready', sentenceStatus: 'ready', progress: null, left: 0, top: 0,
  serviceLabel: '百度 · 机器翻译',
});

describe('answer selection translation scope and collection provenance', () => {
  it('keeps oversized provider text visible without submitting invalid word-card fields', () => {
    const tooLong = translated(); tooLong.result = 'x'.repeat(2001);
    expect(captureAnswerTranslation(tooLong)).toBeNull();
    const longSentence = translated(); longSentence.sentenceResult = 'x'.repeat(4001);
    expect(captureAnswerTranslation(longSentence)).toMatchObject({ meaning: '主题' });
    expect(captureAnswerTranslation(longSentence)).not.toHaveProperty('sentenceTranslation');
  });
  it('translates precisely the selected passage without attaching the surrounding answer', () => {
    const passage = 'This is the selected paragraph. Only these sentences should be sent.';
    expect(answerTranslationScope(passage, null, context)).toEqual({ translationText: passage, context: null });
  });

  it('preserves a selected passage beyond the quotation limit without truncating its translation', () => {
    const passage = 'word '.repeat(999).trim();
    expect(passage.length).toBeGreaterThan(4000);
    expect(answerTranslationScope(passage, null, null).translationText).toBe(passage);
    expect(answerTranslationScope('x'.repeat(5001), null, null).translationText).toBeNull();
  });

  it('keeps the original sentence only for a selected collectible word', () => {
    expect(answerTranslationScope('theme', capture, context)).toEqual({ translationText: 'theme', context });
  });

  it('saves the actual provider for both selected word and available sentence', () => {
    expect(captureAnswerTranslation(translated())).toEqual({ ...capture, meaning: '主题', meaningSource: 'baidu',
      sentenceTranslation: '更换一个主题。', sentenceTranslationSource: 'baidu' });
    const local = translated(); local.meaningSource = 'browser'; local.sentenceTranslationSource = 'browser';
    expect(captureAnswerTranslation(local)).toMatchObject({ meaningSource: 'browser', sentenceTranslationSource: 'browser' });
  });

  it('does not fabricate a sentence result while it is still loading', () => {
    const pendingSentence = translated(); pendingSentence.sentenceStatus = 'loading';
    const result = captureAnswerTranslation(pendingSentence);
    expect(result).toMatchObject({ meaning: '主题', meaningSource: 'baidu' });
    expect(result).not.toHaveProperty('sentenceTranslation');
    expect(result).not.toHaveProperty('sentenceTranslationSource');
  });

  it('does not collect untranslated, failed or non-word selections', () => {
    const loading = translated(); loading.status = 'loading';
    expect(captureAnswerTranslation(loading)).toBeNull();
    const failed = translated(); failed.status = 'error';
    expect(captureAnswerTranslation(failed)).toBeNull();
    const passage = translated(); passage.wordCapture = undefined;
    expect(captureAnswerTranslation(passage)).toBeNull();
  });
});
