import type { Table } from 'dexie';
import type { WorkspaceState } from '../sidepanel/types';
import type {
  ArtifactRow,
  ConversationRow,
  ConversationSourceRow,
  MessageRow,
  WorkspaceUiState,
  YemaiDatabase,
} from './database';
import { rowsToWorkspace, workspaceToRows, type WorkspaceRows } from './workspaceRows';

type PersistedRow = ConversationRow | MessageRow | ConversationSourceRow | ArtifactRow;

function rowSignature(row: PersistedRow) {
  return JSON.stringify(row);
}

async function syncTable<Row extends PersistedRow>(
  table: Table<Row, string>,
  incoming: Row[],
  keyOf: (row: Row) => string,
  signatures: Map<string, string>,
) {
  const incomingById = new Map(incoming.map((row) => [keyOf(row), row]));
  const changed = incoming.filter((row) => {
    return signatures.get(keyOf(row)) !== rowSignature(row);
  });
  const removedIds = [...signatures.keys()].filter((key) => !incomingById.has(key));

  if (changed.length) await table.bulkPut(changed);
  if (removedIds.length) await table.bulkDelete(removedIds);
  return { changed: changed.length, removed: removedIds.length };
}

export interface WorkspaceWriteSummary {
  changed: number;
  removed: number;
}

export class WorkspaceRepository {
  private signaturesInitialized = false;
  private readonly conversationSignatures = new Map<string, string>();
  private readonly messageSignatures = new Map<string, string>();
  private readonly sourceSignatures = new Map<string, string>();
  private readonly artifactSignatures = new Map<string, string>();

  constructor(private readonly database: YemaiDatabase) {}

  private seedSignatures(rows: Omit<WorkspaceRows, 'ui'>) {
    this.conversationSignatures.clear();
    this.messageSignatures.clear();
    this.sourceSignatures.clear();
    this.artifactSignatures.clear();
    rows.conversations.forEach((row) => this.conversationSignatures.set(row.id, rowSignature(row)));
    rows.messages.forEach((row) => this.messageSignatures.set(row.id, rowSignature(row)));
    rows.sources.forEach((row) => this.sourceSignatures.set(row.id, rowSignature(row)));
    rows.artifacts.forEach((row) => this.artifactSignatures.set(row.key, rowSignature(row)));
    this.signaturesInitialized = true;
  }

  private async ensureSignatures() {
    if (this.signaturesInitialized) return;
    const [conversations, messages, sources, artifacts] = await Promise.all([
      this.database.conversations.toArray(),
      this.database.messages.toArray(),
      this.database.conversationSources.toArray(),
      this.database.artifacts.toArray(),
    ]);
    this.seedSignatures({ conversations, messages, sources, artifacts });
  }

  async load(ui: WorkspaceUiState, recoveredAt = Date.now()) {
    const [conversations, messages, sources, artifacts] = await Promise.all([
      this.database.conversations.toArray(),
      this.database.messages.toArray(),
      this.database.conversationSources.toArray(),
      this.database.artifacts.toArray(),
    ]);
    this.seedSignatures({ conversations, messages, sources, artifacts });
    return rowsToWorkspace({ conversations, messages, sources, artifacts }, ui, recoveredAt);
  }

  async save(workspace: WorkspaceState, savedAt = Date.now()): Promise<{ ui: WorkspaceUiState; summary: WorkspaceWriteSummary }> {
    const rows = workspaceToRows(workspace, savedAt);
    await this.ensureSignatures();
    const summaries = await this.database.transaction(
      'rw',
      [
        this.database.conversations,
        this.database.messages,
        this.database.conversationSources,
        this.database.artifacts,
      ],
      async () => Promise.all([
        syncTable(this.database.conversations, rows.conversations, (row) => row.id, this.conversationSignatures),
        syncTable(this.database.messages, rows.messages, (row) => row.id, this.messageSignatures),
        syncTable(this.database.conversationSources, rows.sources, (row) => row.id, this.sourceSignatures),
        syncTable(this.database.artifacts, rows.artifacts, (row) => row.key, this.artifactSignatures),
      ]),
    );
    this.seedSignatures(rows);
    return {
      ui: rows.ui,
      summary: summaries.reduce((total, summary) => ({
        changed: total.changed + summary.changed,
        removed: total.removed + summary.removed,
      }), { changed: 0, removed: 0 }),
    };
  }

  async replace(rows: WorkspaceRows) {
    await this.database.transaction(
      'rw',
      [
        this.database.conversations,
        this.database.messages,
        this.database.conversationSources,
        this.database.artifacts,
      ],
      async () => {
        await Promise.all([
          this.database.conversations.clear(),
          this.database.messages.clear(),
          this.database.conversationSources.clear(),
          this.database.artifacts.clear(),
        ]);
        await Promise.all([
          rows.conversations.length ? this.database.conversations.bulkPut(rows.conversations) : undefined,
          rows.messages.length ? this.database.messages.bulkPut(rows.messages) : undefined,
          rows.sources.length ? this.database.conversationSources.bulkPut(rows.sources) : undefined,
          rows.artifacts.length ? this.database.artifacts.bulkPut(rows.artifacts) : undefined,
        ]);
      },
    );
    this.seedSignatures(rows);
  }

  async estimateBytes() {
    const [conversations, messages, sources, artifacts] = await Promise.all([
      this.database.conversations.toArray(),
      this.database.messages.toArray(),
      this.database.conversationSources.toArray(),
      this.database.artifacts.toArray(),
    ]);
    return new Blob([
      JSON.stringify({ conversations, messages, sources, artifacts }),
    ]).size;
  }
}
