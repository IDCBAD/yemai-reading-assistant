import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase } from './database';
import { WordCardRepository } from './wordCardRepository';
import { WorkspaceRepository } from './workspaceRepository';
import { wordCaptureKey, type WordCardCapture } from '../shared/wordCards';

const databases: YemaiDatabase[] = [];
function setup() {
  const database = new YemaiDatabase(`words-${crypto.randomUUID()}`);
  databases.push(database);
  return { database, repository: new WordCardRepository(database) };
}
const capture: WordCardCapture = {
  word: 'unpredictable', sentence: 'Agents handle unpredictable workflows.',
  source: { kind: 'page', title: 'Browser agents', url: 'https://browser-use.com/posts/browser-agents' },
};
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.delete())); });

describe('word card repository', () => {
  it('upgrades a real v4 database without replacing existing tables or content', async () => {
    const { database } = setup();
    const legacy = new Dexie(database.name);
    legacy.version(4).stores({
      conversations: '&id,position,updatedAt,archivedAt,parentConversationId',
      messages: '&id,conversationId,[conversationId+position],createdAt,role,status',
      conversationSources: '&id,conversationId,[conversationId+position],sourceId,revisionId,url,sentAt',
      artifacts: '&key,id,conversationId,messageId,[messageId+position],filename,status',
      readingCards: '&id,sourceConversationId,sourceMessageId,[sourceConversationId+sourceMessageId],createdAt,updatedAt',
      meta: '&key',
    });
    await legacy.table('meta').put({ key: 'retained', value: 'v4 data' });
    await legacy.table('readingCards').put({ id: 'old-card', title: 'Old card' });
    legacy.close();
    await database.open();
    expect(database.verno).toBe(5);
    expect((await database.meta.get('retained'))?.value).toBe('v4 data');
    expect((await database.readingCards.get('old-card'))?.title).toBe('Old card');
    expect(await database.wordCards.count()).toBe(0);
    expect(database.wordCards.schema.indexes.find((index) => index.name === 'captureKey')?.unique).toBe(true);
  });

  it('deduplicates simultaneous captures atomically, preserving a manual meaning', async () => {
    const { database, repository } = setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.saveCapture(capture)));
    expect(results.filter((result) => !result.alreadySaved)).toHaveLength(1);
    expect(new Set(results.map((result) => result.card.id)).size).toBe(1);
    const edited = await repository.updateMeaning(results[0]!.card.id, '不可预测的', 'manual');
    const duplicate = await repository.saveCapture({ ...capture, word: 'UNPREDICTABLE', meaning: 'wrong', meaningSource: 'browser' });
    expect(duplicate).toEqual({ alreadySaved: true, card: edited });
    expect(await database.wordCards.count()).toBe(1);
  });

  it('rejects late translations and stale edits without resurrecting deleted cards', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const edited = await repository.updateMeaning(card.id, '我的释义', 'manual', card.updatedAt);
    await expect(repository.updateMeaning(card.id, 'late', 'browser', card.updatedAt)).rejects.toThrow('释义已修改');
    await expect(repository.updateMeaning(card.id, 'late', 'browser', edited.updatedAt)).rejects.toThrow('释义已修改');
    await expect(repository.updateMeaning(card.id, 'stale edit', 'manual', card.updatedAt)).rejects.toThrow('释义已修改');
    expect((await repository.loadAll())[0]).toEqual(edited);
    await repository.remove(card.id);
    await expect(repository.updateMeaning(card.id, 'late', 'browser')).rejects.toThrow('已不存在');
    expect(await repository.loadAll()).toEqual([]);
  });

  it('protects a deliberately cleared manual meaning from every automatic write', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture({ ...capture, meaning: '手填释义', meaningSource: 'manual' });
    const cleared = await repository.updateMeaning(card.id, '  ', 'manual', card.updatedAt);
    expect(cleared.meaning).toBe('');
    await expect(repository.updateMeaning(card.id, '过期译文', 'browser', card.updatedAt)).rejects.toThrow('释义已修改');
    await expect(repository.updateMeaning(card.id, '不可预测的', 'browser', cleared.updatedAt)).rejects.toThrow('释义已修改');
    expect(await repository.enrich(card.id, card.captureKey, { meaning: '不可预测的', meaningSource: 'dictionary' })).toEqual(cleared);
  });

  it('enriches an empty captured word with a later translation without overwriting saved meanings', async () => {
    const { database, repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const enriched = await repository.saveCapture({ ...capture, meaning: ' 不可预测的 ', meaningSource: 'browser' });
    expect(enriched.alreadySaved).toBe(true);
    expect(enriched.card).toMatchObject({ id: card.id, createdAt: card.createdAt, meaning: '不可预测的', meaningSource: 'browser' });
    expect(enriched.card.updatedAt).toBeGreaterThan(card.updatedAt);
    expect(await repository.saveCapture({ ...capture, meaning: '另一版译文', meaningSource: 'browser' })).toEqual(enriched);
    expect(await repository.saveCapture({ ...capture, meaning: '', meaningSource: 'browser' })).toEqual(enriched);
    const cleared = await repository.updateMeaning(card.id, '', 'manual', enriched.card.updatedAt);
    const enrichedAgain = await repository.saveCapture({ ...capture, meaning: '重新保存的译文', meaningSource: 'browser' });
    expect(enrichedAgain.card).toEqual(cleared);
    const edited = await repository.updateMeaning(card.id, '我的手填释义', 'manual', enrichedAgain.card.updatedAt);
    expect(await repository.saveCapture({ ...capture, meaning: '不能覆盖手填', meaningSource: 'browser' })).toEqual({ card: edited, alreadySaved: true });
    expect(await database.wordCards.count()).toBe(1);
  });

  it('merges concurrent meaning and sentence enrichment without whole-card version conflicts', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    await Promise.all([
      repository.enrich(card.id, card.captureKey, { meaning: '难以预测的', meaningSource: 'dictionary' }),
      repository.enrich(card.id, card.captureKey, { sentenceTranslation: '代理处理难以预测的流程。', sentenceTranslationSource: 'browser' }),
    ]);
    const [enriched] = await repository.loadAll();
    expect(enriched).toMatchObject({ id: card.id, meaning: '难以预测的', meaningSource: 'dictionary', sentenceTranslation: '代理处理难以预测的流程。', sentenceTranslationSource: 'browser' });
    const duplicate = await repository.enrich(card.id, card.captureKey, { meaning: '另一译文', meaningSource: 'browser', sentenceTranslation: '另一句译文', sentenceTranslationSource: 'browser' });
    expect(duplicate).toEqual(enriched);
  });

  it('preserves independent manual fields and empty translations when late enrichment arrives', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    await repository.updateMeaning(card.id, '手填', 'manual');
    const enriched = await repository.enrich(card.id, card.captureKey, { meaning: '机器', meaningSource: 'dictionary', sentenceTranslation: '原句译文', sentenceTranslationSource: 'browser' });
    expect(enriched).toMatchObject({ meaning: '手填', sentenceTranslation: '原句译文' });
    const cleared = await repository.updateSentenceTranslation(card.id, '', enriched.updatedAt);
    expect(await repository.enrich(card.id, card.captureKey, { sentenceTranslation: '迟到的译文', sentenceTranslationSource: 'browser' })).toEqual(cleared);
    await expect(repository.updateSentenceTranslation(card.id, '过期手填', enriched.updatedAt)).rejects.toThrow('已修改');
  });

  it('rejects late enrichment after deletion or a changed capture key, and validates patch fields', async () => {
    const { database, repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const patch = { meaning: '难以预测的', meaningSource: 'dictionary' as const };
    await expect(repository.enrich(card.id, 'changed', patch)).rejects.toThrow('来源已改变');
    await expect(repository.enrich(card.id, card.captureKey, { meaning: 'x'.repeat(2_001), meaningSource: 'browser' })).rejects.toThrow('无效');
    await expect(repository.enrich(card.id, card.captureKey, { sentenceTranslation: 'x'.repeat(4_001), sentenceTranslationSource: 'browser' })).rejects.toThrow('无效');
    await repository.remove(card.id);
    await expect(repository.enrich(card.id, card.captureKey, patch)).rejects.toThrow('已不存在');
    await expect(repository.updateSentenceTranslation(card.id, '译文')).rejects.toThrow('已不存在');
    expect(await database.wordCards.count()).toBe(0);
  });

  it('saves an explicit meaning edit after sentence enrichment changed the card version', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const expectedField = { captureKey: card.captureKey, value: card.meaning ?? '', source: card.meaningSource };
    const enriched = await repository.enrich(card.id, card.captureKey, { sentenceTranslation: '难以预测的流程。', sentenceTranslationSource: 'browser' });
    expect(enriched.updatedAt).toBeGreaterThan(card.updatedAt);
    const edited = await repository.updateMeaning(card.id, '我的释义', 'manual', card.updatedAt, expectedField);
    expect(edited).toMatchObject({ meaning: '我的释义', meaningSource: 'manual', sentenceTranslation: '难以预测的流程。' });
  });

  it('saves an explicit sentence edit after meaning enrichment changed the card version', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const expectedField = { captureKey: card.captureKey, value: card.sentenceTranslation ?? '', source: card.sentenceTranslationSource };
    await repository.enrich(card.id, card.captureKey, { meaning: '难以预测的', meaningSource: 'dictionary' });
    const edited = await repository.updateSentenceTranslation(card.id, '我的原句译文。', card.updatedAt, expectedField);
    expect(edited).toMatchObject({ meaning: '难以预测的', meaningSource: 'dictionary', sentenceTranslation: '我的原句译文。', sentenceTranslationSource: 'manual' });
  });

  it('rejects explicit edits when the actual target value, source or capture changed', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const empty = { captureKey: card.captureKey, value: '' };
    const edited = await repository.updateMeaning(card.id, '已改词义', 'manual');
    await expect(repository.updateMeaning(card.id, '过期草稿', 'manual', undefined, empty)).rejects.toThrow('已修改');
    await expect(repository.updateMeaning(card.id, '过期来源', 'manual', undefined, { captureKey: card.captureKey, value: '已改词义', source: 'browser' })).rejects.toThrow('已修改');
    await expect(repository.updateMeaning(card.id, '旧卡片', 'manual', undefined, { captureKey: 'changed', value: '已改词义', source: 'manual' })).rejects.toThrow('已修改');
    const translated = await repository.updateSentenceTranslation(card.id, '已改原句');
    await expect(repository.updateSentenceTranslation(card.id, '过期草稿', undefined, empty)).rejects.toThrow('已修改');
    await expect(repository.updateSentenceTranslation(card.id, '过期来源', undefined, { captureKey: card.captureKey, value: '已改原句', source: 'browser' })).rejects.toThrow('已修改');
    await expect(repository.updateSentenceTranslation(card.id, '旧卡片', undefined, { captureKey: 'changed', value: '已改原句', source: 'manual' })).rejects.toThrow('已修改');
    expect((await repository.loadAll())[0]).toEqual(translated);
    expect(translated.meaning).toEqual(edited.meaning);
  });

  it('allows user-confirmed translation after a manual clear while keeping automatic enrichment blocked', async () => {
    const { repository } = setup();
    const { card } = await repository.saveCapture(capture);
    const cleared = await repository.updateMeaning(card.id, '', 'manual');
    const patch = { meaning: '自动释义', meaningSource: 'browser' as const };
    expect(await repository.enrich(card.id, card.captureKey, patch)).toEqual(cleared);
    await expect(repository.updateMeaning(card.id, '自动释义', 'browser', cleared.updatedAt)).rejects.toThrow('已修改');
    const confirmed = await repository.updateMeaning(card.id, '用户确认的翻译', 'browser', card.updatedAt, { captureKey: card.captureKey, value: '', source: 'manual' });
    expect(confirmed).toMatchObject({ meaning: '用户确认的翻译', meaningSource: 'browser' });
  });

  it('restores idempotently by capture key and loads newest cards first', async () => {
    const { database, repository } = setup();
    const { card } = await repository.saveCapture(capture);
    await repository.remove(card.id);
    await repository.restore(card);
    expect(await repository.restore({ ...card, id: 'another-id' })).toEqual(card);
    await database.wordCards.put({ ...card, id: 'new', word: 'workflows', normalizedWord: 'workflows', captureKey: wordCaptureKey({ ...capture, word: 'workflows' }), createdAt: card.createdAt + 1, updatedAt: card.updatedAt + 1 });
    expect((await repository.loadAll()).map((entry) => entry.id)).toEqual(['new', card.id]);
    expect(await repository.estimateBytes()).toBeGreaterThan(0);
  });

  it('keeps collected words when saving an empty conversation workspace', async () => {
    const { database, repository } = setup();
    const { card } = await repository.saveCapture(capture);
    await new WorkspaceRepository(database).save({ conversations: [], openTabs: [], activeOpenTabId: '' });
    expect(await repository.loadAll()).toEqual([card]);
  });
});
