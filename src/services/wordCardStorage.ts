import { yemaiDatabase } from '../data/database';
import { WordCardRepository } from '../data/wordCardRepository';
import type { WordCard, WordCardCapture, WordCardEnrichment, WordMeaningSource, WordMeaningFieldSnapshot, WordSentenceTranslationFieldSnapshot } from '../shared/wordCards';

const repository = new WordCardRepository(yemaiDatabase);

export const loadWordCards = () => repository.loadAll();
export const saveWordCardCapture = (capture: WordCardCapture) => repository.saveCapture(capture);
export const updateWordCardMeaning = (id: string, meaning: string, source: WordMeaningSource, expectedUpdatedAt?: number, expectedField?: WordMeaningFieldSnapshot) => repository.updateMeaning(id, meaning, source, expectedUpdatedAt, expectedField);
export const enrichWordCard = (id: string, captureKey: string, patch: WordCardEnrichment) => repository.enrich(id, captureKey, patch);
export const updateWordCardSentenceTranslation = (id: string, translation: string, expectedUpdatedAt?: number, expectedField?: WordSentenceTranslationFieldSnapshot) => repository.updateSentenceTranslation(id, translation, expectedUpdatedAt, expectedField);
export const removeWordCard = (id: string) => repository.remove(id);
export const restoreWordCard = (card: WordCard) => repository.restore(card);
export const estimateWordCardBytes = () => repository.estimateBytes();
