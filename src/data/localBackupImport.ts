import type { YemaiDatabase } from './database';
import type { YemaiBackupCounts, YemaiBackupV1 } from './localBackup';

export type LocalBackupImportMode = 'merge' | 'replace';

export interface LocalBackupImportChanges {
  added: YemaiBackupCounts;
  updatedReadingCards: number;
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
});

function importedCounts(backup: YemaiBackupV1): YemaiBackupCounts {
  return {
    conversations: backup.conversations.length,
    messages: backup.messages.length,
    sources: backup.sources.length,
    artifacts: backup.artifacts.length,
    readingCards: backup.readingCards.length,
  };
}

async function countAll(database: YemaiDatabase): Promise<YemaiBackupCounts> {
  const [conversations, messages, sources, artifacts, readingCards] = await Promise.all([
    database.conversations.count(),
    database.messages.count(),
    database.conversationSources.count(),
    database.artifacts.count(),
    database.readingCards.count(),
  ]);
  return { conversations, messages, sources, artifacts, readingCards };
}

function missingRows<Row>(rows: Row[], existing: Array<Row | undefined>) {
  return rows.filter((_row, index) => existing[index] === undefined);
}

export async function importYemaiBackup(
  database: YemaiDatabase,
  backup: YemaiBackupV1,
  mode: LocalBackupImportMode,
): Promise<LocalBackupImportResult> {
  return database.transaction(
    'rw',
    [
      database.conversations,
      database.messages,
      database.conversationSources,
      database.artifacts,
      database.readingCards,
    ],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          database.conversations.clear(),
          database.messages.clear(),
          database.conversationSources.clear(),
          database.artifacts.clear(),
          database.readingCards.clear(),
        ]);
        await Promise.all([
          backup.conversations.length ? database.conversations.bulkPut(backup.conversations) : undefined,
          backup.messages.length ? database.messages.bulkPut(backup.messages) : undefined,
          backup.sources.length ? database.conversationSources.bulkPut(backup.sources) : undefined,
          backup.artifacts.length ? database.artifacts.bulkPut(backup.artifacts) : undefined,
          backup.readingCards.length ? database.readingCards.bulkPut(backup.readingCards) : undefined,
        ]);
        const totalAfter = await countAll(database);
        const expected = importedCounts(backup);
        if (JSON.stringify(totalAfter) !== JSON.stringify(expected)) {
          throw new Error('替换后的数据库回读数量与备份不一致。');
        }
        return {
          mode,
          changes: { added: expected, updatedReadingCards: 0, skipped: emptyCounts() },
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
      await Promise.all([
        conversationsToAdd.length ? database.conversations.bulkAdd(conversationsToAdd) : undefined,
        messagesToAdd.length ? database.messages.bulkAdd(messagesToAdd) : undefined,
        sourcesToAdd.length ? database.conversationSources.bulkAdd(sourcesToAdd) : undefined,
        artifactsToAdd.length ? database.artifacts.bulkAdd(artifactsToAdd) : undefined,
        cardsToAdd.length ? database.readingCards.bulkAdd(cardsToAdd) : undefined,
      ]);
      if (cardsToUpdate.length) await database.readingCards.bulkPut(cardsToUpdate);
      const added: YemaiBackupCounts = {
        conversations: conversationsToAdd.length,
        messages: messagesToAdd.length,
        sources: sourcesToAdd.length,
        artifacts: artifactsToAdd.length,
        readingCards: cardsToAdd.length,
      };
      const skipped: YemaiBackupCounts = {
        conversations: backup.conversations.length - conversationsToAdd.length,
        messages: backup.messages.length - messagesToAdd.length,
        sources: backup.sources.length - sourcesToAdd.length,
        artifacts: backup.artifacts.length - artifactsToAdd.length,
        readingCards: backup.readingCards.length - cardsToAdd.length - cardsToUpdate.length,
      };
      const totalAfter = await countAll(database);
      const expectedAfter: YemaiBackupCounts = {
        conversations: totalBefore.conversations + added.conversations,
        messages: totalBefore.messages + added.messages,
        sources: totalBefore.sources + added.sources,
        artifacts: totalBefore.artifacts + added.artifacts,
        readingCards: totalBefore.readingCards + added.readingCards,
      };
      if (JSON.stringify(totalAfter) !== JSON.stringify(expectedAfter)) {
        throw new Error('合并后的数据库回读校验失败。');
      }
      return { mode, changes: { added, updatedReadingCards: cardsToUpdate.length, skipped }, totalAfter };
    },
  );
}
