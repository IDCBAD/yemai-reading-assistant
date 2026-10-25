import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isCollectibleWord, isWordCard, isWordCardCapture, normalizeWord, wordCaptureKey } from './wordCards';
import { YemaiDatabase } from '../data/database';
import { WordCardRepository } from '../data/wordCardRepository';
import { createYemaiBackup, parseYemaiBackup, serializeYemaiBackup } from '../data/localBackup';

describe('collectible English expressions', () => {
  it('validates display templates independently of exact source words and preserves metadata in backups', async () => {
    const database = new YemaiDatabase(`expression-metadata-${crypto.randomUUID()}`);
    try {
      const word = 'protect users from being charged';
      const sentence = `We ${word} for failed output.`;
      const capture = { word, sentence, highlightStart: 3, highlightEnd: 3 + word.length, expression: { name: 'protect … from …' },
        source: { kind: 'page' as const, title: 'Insurance', url: 'https://example.com/insurance' } };
      expect(isWordCardCapture(capture)).toBe(true);
      expect(isWordCardCapture({ ...capture, word: capture.expression.name })).toBe(false);
      expect(isWordCardCapture({ ...capture, expression: { name: '<b>invalid</b>' } })).toBe(false);
      expect(isWordCardCapture({ ...capture, expression: { name: 'even if', extra: true } })).toBe(false);
      expect(isWordCardCapture({ ...capture, source: { kind: 'assistant', title: '', messageId: 'm' } })).toBe(false);
      const saved = await new WordCardRepository(database).saveExpressionCapture(capture);
      const backup = await createYemaiBackup(database, { appVersion: 'test', exportedAt: Date.now() });
      const restored = parseYemaiBackup(serializeYemaiBackup(backup)).backup.wordCards[0]!;
      expect(restored).toEqual(saved.card);
      expect(isWordCard(restored)).toBe(true);
      await database.wordCards.clear();
      expect(await new WordCardRepository(database).restore(restored)).toEqual(saved.card);
      expect(await new WordCardRepository(database).getCollectedExpressions(capture.source.url, ['protect ... from ...'])).toEqual(['protect … from …']);
      expect(wordCaptureKey({ ...capture, source: { ...capture.source, url: `${capture.source.url}#anchor` }, expression: { name: 'PROTECT ... FROM ...' } })).toBe(saved.card.captureKey);
      expect(wordCaptureKey({ ...capture, expression: undefined })).not.toBe(saved.card.captureKey);
    } finally { await database.delete(); }
  });
  it.each(['be responsible for making sure that requests are valid', 'at least one complete MPEG frame',
    'HTTP 429', 'GPT-4.1', 'NVIDIA H100', 'C++', 'Node.js', 'C#',
    'retrieval augmented generation (RAG)', 'HTTP: error handling'])('accepts %s', (value) => {
    expect(isCollectibleWord(value)).toBe(true);
  });

  it.each(['', '中文', '<b>based on</b>', 'https://example.com', 'example.com', 'www.example.org',
    'based on\nresult in', 'based on\tresult in', 'not a whole sentence.', 'an expression!',
    'a'.repeat(241), Array(17).fill('word').join(' '), '123 456', 'word ()', '(unbalanced',
    'unbalanced)', 'word..name', 'word + other', 'word / other'])('rejects %s', (value) => {
    expect(isCollectibleWord(value)).toBe(false);
  });

  it('accepts the limits and uses the same validation for captures and stored cards', () => {
    expect(isCollectibleWord(Array(16).fill('term').join(' '))).toBe(true);
    expect(isCollectibleWord('a'.repeat(240))).toBe(true);
    const word = 'at least one complete MPEG frame';
    const sentence = `The output needs ${word} to qualify.`;
    const capture = { word, sentence, highlightStart: sentence.indexOf(word), highlightEnd: sentence.indexOf(word) + word.length,
      meaning: '至少一个完整的 MPEG 帧', source: { kind: 'page' as const, title: 'Audio', url: 'https://example.com/audio' } };
    expect(isWordCardCapture(capture)).toBe(true);
    expect(isWordCard({ ...capture, id: 'expression', captureKey: wordCaptureKey(capture),
      normalizedWord: normalizeWord(word), createdAt: 1, updatedAt: 1 })).toBe(true);
    expect(isWordCardCapture({ ...capture, word: `${word}\nresult in` })).toBe(false);
    expect(isWordCardCapture({ ...capture, highlightStart: 0 })).toBe(false);
  });

  it('persists and exports a six-word expression without inventing a meaning source', async () => {
    const database = new YemaiDatabase(`expression-${crypto.randomUUID()}`);
    try {
      const word = 'at least one complete MPEG frame';
      const sentence = `The output needs ${word} to qualify.`;
      const capture = { word, sentence, highlightStart: 17, highlightEnd: 17 + word.length,
        meaning: '至少一个完整的 MPEG 帧', source: { kind: 'page' as const, title: 'Audio', url: 'https://example.com/audio' } };
      const saved = await new WordCardRepository(database).saveCapture(capture);
      expect(await database.wordCards.get(saved.card.id)).toMatchObject(capture);
      expect(saved.card).not.toHaveProperty('meaningSource');
      const backup = await createYemaiBackup(database, { appVersion: 'test', exportedAt: Date.now() });
      expect(parseYemaiBackup(serializeYemaiBackup(backup)).backup.wordCards).toEqual([saved.card]);
    } finally { await database.delete(); }
  });
});
