import type { ReadingCardRow, YemaiDatabase } from './database';

export class ReadingCardRepository {
  constructor(private readonly database: YemaiDatabase) {}

  async loadAll() {
    return this.database.readingCards.orderBy('createdAt').reverse().toArray();
  }

  async save(card: ReadingCardRow) {
    await this.database.readingCards.put(card);
    return card;
  }

  async remove(id: string) {
    await this.database.readingCards.delete(id);
  }

  async clear() {
    await this.database.readingCards.clear();
  }

  async estimateBytes() {
    const cards = await this.database.readingCards.toArray();
    return new Blob([JSON.stringify(cards)]).size;
  }
}
