import type { ReadingCardRow } from './database';
import type { CollectionMaterial, Conversation } from '../sidepanel/types';
import { readingCardKind, readingCardQuestion } from '../sidepanel/readingCards';

export {
  COLLECTION_PROMPT,
  MAX_COLLECTION_MATERIAL_CHARACTERS,
  MAX_COLLECTION_PROMPT_CHARACTERS,
  collectionContextText,
  collectionMessagePrompt,
  collectionPrompt,
  collectionQuestionPrompt,
} from './collectionPrompt';

export function collectionMaterials(cards: ReadingCardRow[], conversations: Conversation[]): CollectionMaterial[] {
  return cards.map((card) => ({
    cardId: card.id,
    title: card.title,
    kind: readingCardKind(card),
    question: readingCardQuestion(card, conversations),
    answer: card.bodyMarkdown,
    sources: card.sources.map((source) => ({ ...source })),
    savedAt: card.createdAt,
  }));
}
