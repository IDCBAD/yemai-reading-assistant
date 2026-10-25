import { yemaiDatabase, type YemaiDatabase } from './database';
import type { PageReadingTask, PageReadingTaskStatus } from '../shared/pageReadingFocus';
import { normalizeSourceIdentityUrl } from '../content/pageManifest';

export const PAGE_READING_META_PREFIX = 'pageReadingTask:';
export const MAX_CACHED_PAGE_READING_TASKS = 20;
const unfinished = new Set<PageReadingTaskStatus>(['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping']);
const completed = new Set<PageReadingTaskStatus>(['ready', 'failed', 'stopped']);
const blocksDuplicate = new Set<PageReadingTaskStatus>([...unfinished, 'unknown']);

/** Prompt versions change cache keys, but cannot make an uncertain submission safe to repeat. */
function sameArticleTarget(left: PageReadingTask, right: PageReadingTask) {
  return left.target === right.target
    && (left.mode ?? 'groups') === (right.mode ?? 'groups')
    && normalizeSourceIdentityUrl(left.snapshot.url) === normalizeSourceIdentityUrl(right.snapshot.url)
    && left.snapshot.paragraphs.length === right.snapshot.paragraphs.length
    && left.snapshot.paragraphs.every((paragraph, index) => {
      const other = right.snapshot.paragraphs[index]!;
      return paragraph.id === other.id && paragraph.text === other.text;
    });
}

/** Disposable reading data lives only in meta; it never creates conversations or knowledge backup records. */
export class PageReadingRepository {
  constructor(private readonly database: YemaiDatabase = yemaiDatabase) {}

  async get(id: string): Promise<PageReadingTask | undefined> {
    return (await this.database.meta.get(PAGE_READING_META_PREFIX + id))?.value as PageReadingTask | undefined;
  }

  async put(task: PageReadingTask): Promise<void> {
    await this.database.meta.put({ key: PAGE_READING_META_PREFIX + task.id, value: task });
  }

  async claim(task: PageReadingTask, retry = false): Promise<{ task: PageReadingTask; created: boolean }> {
    return this.database.transaction('rw', this.database.meta, async () => {
      const existing = await this.get(task.id);
      if (existing && !(retry && (existing.status === 'failed' || existing.status === 'stopped'))) {
        return { task: existing, created: false };
      }
      // Keep this lookup and claim in the same transaction, including across
      // repository instances racing with different analysis-version keys.
      const records = await this.database.meta.where('key').startsWith(PAGE_READING_META_PREFIX).toArray();
      const prior = records.map(({ value }) => value as PageReadingTask)
        .find((other) => other.id !== task.id && blocksDuplicate.has(other.status) && sameArticleTarget(other, task));
      if (prior) return { task: prior, created: false };
      await this.put(task);
      return { task, created: true };
    });
  }

  async listUnfinished(): Promise<PageReadingTask[]> {
    const records = await this.database.meta.where('key').startsWith(PAGE_READING_META_PREFIX).toArray();
    return records.map(({ value }) => value as PageReadingTask).filter(({ status }) => unfinished.has(status));
  }

  async prune(): Promise<void> {
    await this.database.transaction('rw', this.database.meta, async () => {
      const records = await this.database.meta.where('key').startsWith(PAGE_READING_META_PREFIX).toArray();
      const disposable = records.filter(({ value }) => completed.has((value as PageReadingTask).status))
        .sort((a, b) => (b.value as PageReadingTask).updatedAt - (a.value as PageReadingTask).updatedAt || a.key.localeCompare(b.key));
      await this.database.meta.bulkDelete(disposable.slice(MAX_CACHED_PAGE_READING_TASKS).map(({ key }) => key));
    });
  }
}
