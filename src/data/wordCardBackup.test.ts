import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YemaiDatabase } from './database';
import { createYemaiBackup, parseYemaiBackup, serializeYemaiBackup, type YemaiBackupV1 } from './localBackup';
import { importYemaiBackup } from './localBackupImport';
import { WordCardRepository } from './wordCardRepository';
import { wordCaptureKey, type WordCard } from '../shared/wordCards';

const databases: YemaiDatabase[] = [];
function setup() {
  const database = new YemaiDatabase(`word-backup-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}
function card(id = 'word-1'): WordCard {
  const capture = { word: 'unpredictable', sentence: 'An unpredictable workflow.', source: { kind: 'page' as const, title: 'Article', url: 'https://example.com/' } };
  return { ...capture, id, captureKey: wordCaptureKey(capture), normalizedWord: capture.word, createdAt: 10, updatedAt: 10 };
}
async function emptyBackup() { return createYemaiBackup(setup(), { appVersion: '0.6.1', exportedAt: 100 }); }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((database) => database.delete())); });

describe('word card backups', () => {
  it('exports v2 independent words, source sentences and manual meanings', async () => {
    const database = setup();
    const word = { ...card(), meaning: '难以预测的', meaningSource: 'dictionary' as const, sentenceTranslation: '难以预测的流程。', sentenceTranslationSource: 'manual' as const };
    await database.wordCards.add(word);
    const backup = await createYemaiBackup(database, { appVersion: '0.6.1', exportedAt: 100 });
    expect(backup.formatVersion).toBe(2);
    expect(backup.counts.wordCards).toBe(1);
    expect(parseYemaiBackup(serializeYemaiBackup(backup)).backup.wordCards).toEqual([word]);
    const target = setup();
    await importYemaiBackup(target, backup, 'replace');
    expect(await target.wordCards.get(word.id)).toEqual(word);
  });

  it('normalizes real v1 backups and preserves words on merge, clears them on replace', async () => {
    const { wordCards: _words, counts, ...base } = await emptyBackup();
    const { wordCards: _count, ...v1Counts } = counts;
    const v1: YemaiBackupV1 = { ...base, formatVersion: 1, counts: v1Counts };
    const normalized = parseYemaiBackup(serializeYemaiBackup(v1)).backup;
    expect(normalized.wordCards).toEqual([]);
    expect(normalized.counts.wordCards).toBe(0);
    const target = setup();
    await target.wordCards.put(card());
    await importYemaiBackup(target, v1, 'merge');
    expect(await target.wordCards.count()).toBe(1);
    await importYemaiBackup(target, normalized, 'replace');
    expect(await target.wordCards.count()).toBe(0);
  });

  it('rejects v2 missing lists, count mismatches, invalid records and duplicate IDs or captures', async () => {
    const backup = await emptyBackup();
    const { wordCards: _words, ...missing } = backup;
    const samples = [missing, { ...backup, counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [{ ...card(), normalizedWord: 'wrong' }], counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [{ ...card(), createdAt: 1e100, updatedAt: 1e100 }], counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [{ ...card(), meaningSource: 'unknown' }], counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [{ ...card(), sentenceTranslation: 'x'.repeat(4_001), sentenceTranslationSource: 'browser' }], counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [{ ...card(), sentenceTranslation: '译文', sentenceTranslationSource: 'dictionary' }], counts: { ...backup.counts, wordCards: 1 } },
      { ...backup, wordCards: [card(), card('different-id')], counts: { ...backup.counts, wordCards: 2 } },
      { ...backup, wordCards: [card(), { ...card(), sentence: 'Other', captureKey: wordCaptureKey({ ...card(), sentence: 'Other' }) }], counts: { ...backup.counts, wordCards: 2 } },
    ];
    for (const sample of samples) expect(() => parseYemaiBackup(JSON.stringify(sample))).toThrow();
  });

  it('merges by capture key and respects manual meanings and record timestamps', async () => {
    const target = setup();
    const original = { ...card(), meaning: '手填', meaningSource: 'manual' as const, updatedAt: 20 };
    await target.wordCards.put(original);
    const backup = await emptyBackup();
    backup.wordCards = [{ ...card('duplicate'), updatedAt: 100, meaning: '重复' }];
    backup.counts.wordCards = 1;
    await importYemaiBackup(target, backup, 'merge');
    expect(await target.wordCards.toArray()).toEqual([original]);
    backup.wordCards = [{ ...card(), updatedAt: 100, meaning: '机器翻译', meaningSource: 'browser' }];
    await importYemaiBackup(target, backup, 'merge');
    expect(await target.wordCards.get(original.id)).toEqual(original);
    backup.wordCards = [{ ...original, updatedAt: 30, meaning: '较新手填' }];
    await importYemaiBackup(target, backup, 'merge');
    expect((await target.wordCards.get(original.id))?.meaning).toBe('较新手填');
    backup.wordCards = [original];
    await importYemaiBackup(target, backup, 'merge');
    expect((await target.wordCards.get(original.id))?.meaning).toBe('较新手填');
  });

  it('merges sentence translation independently of a protected manual meaning', async () => {
    const target = setup();
    const original = { ...card(), meaning: '', meaningSource: 'manual' as const, updatedAt: 20 };
    await target.wordCards.put(original);
    const backup = await emptyBackup();
    backup.wordCards = [{ ...card(), updatedAt: 30, meaning: '机器释义', meaningSource: 'dictionary', sentenceTranslation: '难以预测的流程。', sentenceTranslationSource: 'browser' }];
    backup.counts.wordCards = 1;
    const result = await importYemaiBackup(target, backup, 'merge');
    expect(result.changes.updatedWordCards).toBe(1);
    const merged = await target.wordCards.get(original.id);
    expect(merged).toMatchObject({ meaning: '', meaningSource: 'manual', sentenceTranslation: '难以预测的流程。', sentenceTranslationSource: 'browser', updatedAt: 30 });
    // Later non-manual values must not replace a saved nonempty sentence.
    backup.wordCards = [{ ...card(), updatedAt: 40, sentenceTranslation: '另一句译文', sentenceTranslationSource: 'browser' }];
    await importYemaiBackup(target, backup, 'merge');
    expect(await target.wordCards.get(original.id)).toEqual(merged);
    // A newer explicit manual clear remains authoritative during future merges.
    backup.wordCards = [{ ...card(), updatedAt: 50, sentenceTranslation: '', sentenceTranslationSource: 'manual' }];
    await importYemaiBackup(target, backup, 'merge');
    backup.wordCards = [{ ...card(), updatedAt: 60, sentenceTranslation: '不能填回', sentenceTranslationSource: 'browser' }];
    await importYemaiBackup(target, backup, 'merge');
    expect(await target.wordCards.get(original.id)).toMatchObject({ meaning: '', meaningSource: 'manual', sentenceTranslation: '', sentenceTranslationSource: 'manual', updatedAt: 50 });
  });

  it('preserves newer local fields when importing a legacy v2 card without translations', async () => {
    const target = setup();
    const original = { ...card(), meaning: '词典释义', meaningSource: 'dictionary' as const, sentenceTranslation: '我的译文', sentenceTranslationSource: 'manual' as const, updatedAt: 20 };
    await target.wordCards.put(original);
    const backup = await emptyBackup();
    backup.wordCards = [{ ...card(), updatedAt: 30 }];
    backup.counts.wordCards = 1;
    expect(parseYemaiBackup(serializeYemaiBackup(backup)).backup.wordCards).toEqual(backup.wordCards);
    await importYemaiBackup(target, backup, 'merge');
    expect(await target.wordCards.get(original.id)).toEqual(original);
  });

  it('rolls back word replacement and all other tables if a write fails', async () => {
    const target = setup();
    await target.wordCards.put(card());
    await target.readingCards.put({ id: 'keep', sourceConversationId: '', sourceMessageId: '', title: 'Retained', excerpt: '', bodyMarkdown: '', sources: [], artifacts: [], messageCreatedAt: 1, createdAt: 1, updatedAt: 1 });
    const backup = await emptyBackup();
    backup.wordCards = [card('incoming')];
    backup.counts.wordCards = 1;
    vi.spyOn(target.wordCards, 'bulkAdd').mockRejectedValue(new Error('disk failure'));
    await expect(importYemaiBackup(target, backup, 'replace')).rejects.toThrow('disk failure');
    expect(await target.wordCards.toArray()).toEqual([card()]);
    expect((await target.readingCards.get('keep'))?.title).toBe('Retained');
    expect(await new WordCardRepository(target).loadAll()).toHaveLength(1);
  });

  it('rolls back added reading cards when merging words fails', async () => {
    const target = setup();
    const backup = await emptyBackup();
    backup.wordCards = [card()];
    backup.counts.wordCards = 1;
    backup.readingCards = [{ id: 'new-reading-card', sourceConversationId: '', sourceMessageId: '', title: 'New', excerpt: '', bodyMarkdown: '', sources: [], artifacts: [], messageCreatedAt: 1, createdAt: 1, updatedAt: 1 }];
    backup.counts.readingCards = 1;
    vi.spyOn(target.wordCards, 'bulkAdd').mockRejectedValue(new Error('disk failure'));
    await expect(importYemaiBackup(target, backup, 'merge')).rejects.toThrow('disk failure');
    expect(await target.wordCards.count()).toBe(0);
    expect(await target.readingCards.count()).toBe(0);
  });
});
