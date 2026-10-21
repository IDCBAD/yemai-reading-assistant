import type { YemaiDatabase } from './database';
import type { YemaiBackupCounts, YemaiBackup, NormalizedYemaiBackup } from './localBackup';
import type { WordCard } from '../shared/wordCards';

export type LocalBackupImportMode = 'merge' | 'replace';

export interface LocalBackupImportChanges {
  added: YemaiBackupCounts;
  updatedReadingCards: number;
  updatedWordCards?: number;
  skipped: YemaiBackupCounts;
}

export interface LocalBackupImportResult {
  mode: LocalBackupImportMode;
  changes: LocalBackupImportChanges;
  totalAfter: YemaiBackupCounts;
}

const emptyCounts = (): YemaiBackupCounts => ({
  conversations: 0,
  messages: 0,
  sources: 0,
  artifacts: 0,
  readingCards: 0,
  wordCards: 0,
});

function importedCounts(backup: YemaiBackup | NormalizedYemaiBackup): YemaiBackupCounts {
  return {
    conversations: backup.conversations.length,
    messages: backup.messages.length,
    sources: backup.sources.length,
    artifacts: backup.artifacts.length,
    readingCards: backup.readingCards.length,
    wordCards: (backup.formatVersion === 2 ? backup.wordCards : []).length,
  };
}

async function countAll(database: YemaiDatabase): Promise<YemaiBackupCounts> {
  const [conversations, messages, sources, artifacts, readingCards, wordCards] = await Promise.all([
    database.conversations.count(),
    database.messages.count(),
    database.conversationSources.count(),
    database.artifacts.count(),
    database.readingCards.count(),
    database.wordCards.count(),
  ]);
  return { conversations, messages, sources, artifacts, readingCards, wordCards };
}

function missingRows<Row>(rows: Row[], existing: Array<Row | undefined>) {
  return rows.filter((_row, index) => existing[index] === undefined);
}

function mergeWordCard(existing: WordCard, incoming: WordCard): WordCard | undefined {
  // Only a newer version of this exact card can contribute fields. A second
  // capture with the same content remains a duplicate, not a replacement.
  if (existing.id !== incoming.id || incoming.updatedAt <= existing.updatedAt) return undefined;
  const merged = { ...existing };
  if (incoming.meaning !== undefined && (incoming.meaningSource === 'manual'
    || (existing.meaningSource !== 'manual' && !existing.meaning?.trim() && incoming.meaning.trim()))) {
    merged.meaning = incoming.meaning;
    merged.meaningSource = incoming.meaningSource;
  }
  if (incoming.sentenceTranslation !== undefined && (incoming.sentenceTranslationSource === 'manual'
    || (existing.sentenceTranslationSource !== 'manual' && !existing.sentenceTranslation?.trim() && incoming.sentenceTranslation.trim()))) {
    merged.sentenceTranslation = incoming.sentenceTranslation;
    merged.sentenceTranslationSource = incoming.sentenceTranslationSource;
  }
  if (merged.meaning === existing.meaning && merged.meaningSource === existing.meaningSource
    && merged.sentenceTranslation === existing.sentenceTranslation && merged.sentenceTranslationSource === existing.sentenceTranslationSource) return undefined;
  merged.updatedAt = incoming.updatedAt;
  return merged;
}

export async function importYemaiBackup(
  database: YemaiDatabase,
  backup: YemaiBackup | NormalizedYemaiBackup,
  mode: LocalBackupImportMode,
): Promise<LocalBackupImportResult> {
  const wordCards = backup.formatVersion === 2 ? backup.wordCards : [];
  return database.transaction(
    'rw',
    [
      database.conversations,
      database.messages,
      database.conversationSources,
      database.artifacts,
      database.readingCards,
      database.wordCards,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          database.conversations.clear(),
          database.messages.clear(),
          database.conversationSources.clear(),
          database.artifacts.clear(),
          database.readingCards.clear(),
          database.wordCards.clear(),
        ]);
        await Promise.all([
          backup.conversations.length ? database.conversations.bulkPut(backup.conversations) : undefined,
          backup.messages.length ? database.messages.bulkPut(backup.messages) : undefined,
          backup.sources.length ? database.conversationSources.bulkPut(backup.sources) : undefined,
          backup.artifacts.length ? database.artifacts.bulkPut(backup.artifacts) : undefined,
          backup.readingCards.length ? database.readingCards.bulkPut(backup.readingCards) : undefined,
          wordCards.length ? database.wordCards.bulkAdd(wordCards) : undefined,
        ]);
        const totalAfter = await countAll(database);
        const expected = importedCounts(backup);
        if (JSON.stringify(totalAfter) !== JSON.stringify(expected)) {
          throw new Error('替换后的数据库回读数量与备份不一致。');
        }
        return {
          mode,
          changes: { added: expected, updatedReadingCards: 0, updatedWordCards: 0, skipped: emptyCounts() },
          totalAfter,
        };
      }

      const [existingConversations, existingMessages, existingSources, existingArtifacts, existingCards] = await Promise.all([
        database.conversations.bulkGet(backup.conversations.map((row) => row.id)),
        database.messages.bulkGet(backup.messages.map((row) => row.id)),
        database.conversationSources.bulkGet(backup.sources.map((row) => row.id)),
        database.artifacts.bulkGet(backup.artifacts.map((row) => row.key)),
        database.readingCards.bulkGet(backup.readingCards.map((row) => row.id)),
      ]);
      const totalBefore = await countAll(database);
      const conversationsToAdd = missingRows(backup.conversations, existingConversations);
      const messagesToAdd = missingRows(backup.messages, existingMessages);
      const sourcesToAdd = missingRows(backup.sources, existingSources);
      const artifactsToAdd = missingRows(backup.artifacts, existingArtifacts);
      const cardsToAdd = missingRows(backup.readingCards, existingCards);
      const cardsToUpdate = backup.readingCards.filter((card, index) => {
        const existing = existingCards[index];
        return existing !== undefined && card.updatedAt > existing.updatedAt;
      });
      const wordsToAdd = [] as typeof wordCards;
      const wordsToUpdate = [] as typeof wordCards;
      for (const card of wordCards) {
        const existing = await database.wordCards.where('captureKey').equals(card.captureKey).first();
        if (existing) {
          const merged = mergeWordCard(existing, card);
          if (merged) wordsToUpdate.push(merged);
        } else if (!await database.wordCards.get(card.id)) {
          wordsToAdd.push(card);
        }
      }
      await Promise.all([
        conversationsToAdd.length ? database.conversations.bulkAdd(conversationsToAdd) : undefined,
        messagesToAdd.length ? database.messages.bulkAdd(messagesToAdd) : undefined,
        sourcesToAdd.length ? database.conversationSources.bulkAdd(sourcesToAdd) : undefined,
        artifactsToAdd.length ? database.artifacts.bulkAdd(artifactsToAdd) : undefined,
        cardsToAdd.length ? database.readingCards.bulkAdd(cardsToAdd) : undefined,
      ]);
      if (cardsToUpdate.length) await database.readingCards.bulkPut(cardsToUpdate);
      if (wordsToAdd.length) await database.wordCards.bulkAdd(wordsToAdd);
      if (wordsToUpdate.length) await database.wordCards.bulkPut(wordsToUpdate);
      const added: YemaiBackupCounts = {
        conversations: conversationsToAdd.length,
        messages: messagesToAdd.length,
        sources: sourcesToAdd.length,
        artifacts: artifactsToAdd.length,
        readingCards: cardsToAdd.length,
        wordCards: wordsToAdd.length,
      };
      const skipped: YemaiBackupCounts = {
        conversations: backup.conversations.length - conversationsToAdd.length,
        messages: backup.messages.length - messagesToAdd.length,
        sources: backup.sources.length - sourcesToAdd.length,
        artifacts: backup.artifacts.length - artifactsToAdd.length,
        readingCards: backup.readingCards.length - cardsToAdd.length - cardsToUpdate.length,
        wordCards: wordCards.length - wordsToAdd.length - wordsToUpdate.length,
      };
      const totalAfter = await countAll(database);
      const expectedAfter: YemaiBackupCounts = {
        conversations: totalBefore.conversations + added.conversations,
        messages: totalBefore.messages + added.messages,
        sources: totalBefore.sources + added.sources,
        artifacts: totalBefore.artifacts + added.artifacts,
        readingCards: totalBefore.readingCards + added.readingCards,
        wordCards: (totalBefore.wordCards ?? 0) + (added.wordCards ?? 0),
      };
      if (JSON.stringify(totalAfter) !== JSON.stringify(expectedAfter)) {
        throw new Error('合并后的数据库回读校验失败。');
      }
      return { mode, changes: { added, updatedReadingCards: cardsToUpdate.length, updatedWordCards: wordsToUpdate.length, skipped }, totalAfter };
    },
  );
}
