import { yemaiDatabase, type ReadingCardRow } from '../data/database';
import { ReadingCardRepository } from '../data/readingCardRepository';

const repository = new ReadingCardRepository(yemaiDatabase);

export function loadReadingCards() {
  return repository.loadAll();
}

export function saveReadingCard(card: ReadingCardRow) {
  return repository.save(card);
}

export function removeReadingCard(id: string) {
  return repository.remove(id);
}

export function clearReadingCards() {
  return repository.clear();
}

export function estimateReadingCardBytes() {
  return repository.estimateBytes();
}
