import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase, type ReadingCardRow } from './database';
import { ReadingCardRepository } from './readingCardRepository';

const databaseNames: string[] = [];

function createDatabase() {
  const name = `reading-cards-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return new YemaiDatabase(name);
}

function card(id = 'card-1'): ReadingCardRow {
  return {
    id,
    sourceConversationId: 'conversation-1',
    sourceMessageId: 'message-1',
    title: '可靠性评估',
    excerpt: '评估维度包括可靠性和安全性。',
    bodyMarkdown: '## 可靠性评估\n\n评估维度包括可靠性和安全性。',
    sources: [{ title: '文章', url: 'https://example.com', site: 'example.com' }],
    artifacts: [],
    messageCreatedAt: 10,
    createdAt: 20,
    updatedAt: 20,
  };
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('ReadingCardRepository', () => {
  it('saves idempotently and loads newest cards first', async () => {
    const database = createDatabase();
    const repository = new ReadingCardRepository(database);
    await repository.save(card('older'));
    await repository.save({ ...card('newer'), createdAt: 30, updatedAt: 30 });
    await repository.save({ ...card('older'), title: '更新后的标题' });

    const cards = await repository.loadAll();
    expect(cards.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(cards[1]?.title).toBe('更新后的标题');
    expect(await database.readingCards.count()).toBe(2);
  });

  it('removes cards without touching their source message', async () => {
    const database = createDatabase();
    const repository = new ReadingCardRepository(database);
    await repository.save(card());
    await database.messages.put({
      id: 'message-1',
      conversationId: 'conversation-1',
      position: 0,
      role: 'assistant',
      content: '仍然存在',
      createdAt: 10,
      status: 'complete',
    });

    await repository.remove('card-1');

    expect(await database.readingCards.count()).toBe(0);
    expect(await database.messages.get('message-1')).toBeDefined();
  });

  it('upgrades an existing v1 database without losing workspace rows', async () => {
    const database = createDatabase();
    const legacy = new Dexie(database.name);
    legacy.version(1).stores({
      conversations: '&id,position,updatedAt,archivedAt,parentConversationId',
      messages: '&id,conversationId,[conversationId+position],createdAt,role,status',
      conversationSources: '&id,conversationId,[conversationId+position],sourceId,revisionId,url,sentAt',
      artifacts: '&key,id,conversationId,messageId,[messageId+position],filename,status',
      meta: '&key',
    });
    await legacy.table('meta').put({ key: 'migration', value: 'kept' });
    legacy.close();

    await database.open();

    expect((await database.meta.get('migration'))?.value).toBe('kept');
    await database.readingCards.put(card());
    expect(await database.readingCards.count()).toBe(1);
  });
});
