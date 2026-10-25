import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase } from './database';
import { createYemaiBackup } from './localBackup';
import { MAX_CACHED_PAGE_READING_TASKS, PageReadingRepository } from './pageReadingRepository';
import { parsePageReadingAnalysis, type PageReadingTask, type PageReadingTaskStatus } from '../shared/pageReadingFocus';

const databases: YemaiDatabase[] = [];
function setup(name = `page-reading-${crypto.randomUUID()}`) {
  const database = new YemaiDatabase(name);
  databases.push(database);
  return { database, repository: new PageReadingRepository(database) };
}
const snapshot = { url: 'https://example.com/doc', title: 'Test', paragraphs: [{ id: 'p0', text: 'Use a script.' }] };
const task = (id = 'one', status: PageReadingTaskStatus = 'preparing', updatedAt = 1): PageReadingTask => ({
  id, snapshot, target: 'internal:agent:https://api.example.com', status, createdAt: 1, updatedAt,
});
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.delete())); });

describe('page reading repository', () => {
  it('allows independent expression tasks while unknown groups still block only future groups versions', async () => {
    const { repository } = setup();
    const old = task('old', 'unknown'); // legacy missing mode means groups
    await repository.put(old);
    expect(await repository.claim({ ...task('new-groups'), mode: 'groups' })).toEqual({ task: old, created: false });
    const expressions = { ...task('expressions'), mode: 'expressions' as const };
    expect(await repository.claim(expressions)).toEqual({ task: expressions, created: true });
    expect(await repository.claim({ ...expressions, id: 'new-expression-version' })).toEqual({ task: expressions, created: false });
  });
  it('persists ready results and remote progress across database instances', async () => {
    const { database, repository } = setup();
    const cached = { ...task('cached', 'ready'), result: parsePageReadingAnalysis('{"paragraphs":[{"id":"p0","groups":[]}]}', snapshot) };
    await repository.put(cached);
    await repository.put({ ...task('running', 'analyzing'), remoteUuid: 'remote', runId: 'run' });
    database.close();
    const reopened = setup(database.name);
    expect(await reopened.repository.get('cached')).toEqual(cached);
    expect(await reopened.repository.get('running')).toMatchObject({ remoteUuid: 'remote', runId: 'run', status: 'analyzing' });
    expect(await reopened.repository.get('missing')).toBeUndefined();
    reopened.database.close();
  });

  it('claims simultaneous requests atomically across repository instances', async () => {
    const { database, repository } = setup();
    const other = setup(database.name);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? repository : other.repository).claim(task())));
    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(results.every((result) => result.task.id === 'one')).toBe(true);
    expect(await database.meta.count()).toBe(1);
    other.database.close();
  });

  it('reuses ready, inflight and unknown tasks even with retry, retries failures only explicitly', async () => {
    const { repository } = setup();
    const statuses: PageReadingTaskStatus[] = ['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping', 'unknown', 'ready'];
    for (const status of statuses) {
      const original = { ...task(status, status), snapshot: { ...snapshot, paragraphs: [{ id: status, text: 'Use a script.' }] } };
      await repository.put(original);
      expect(await repository.claim({ ...original, status: 'preparing' }, true)).toEqual({ task: original, created: false });
    }
    for (const status of ['failed', 'stopped'] as const) {
      const original = { ...task(status, status), snapshot: { ...snapshot, paragraphs: [{ id: status, text: 'Use a script.' }] } };
      await repository.put(original);
      expect(await repository.claim({ ...original, status: 'preparing' })).toEqual({ task: original, created: false });
      const retried: PageReadingTask = { ...original, status: 'preparing' };
      expect(await repository.claim(retried, true)).toEqual({ task: retried, created: true });
    }
  });

  it.each(['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping', 'unknown'] as const)(
    'reuses an older analysis-version task in %s without creating a new submission', async (status) => {
      const { database, repository } = setup();
      const old = { ...task('v1-key', status), snapshot: { ...snapshot, url: `${snapshot.url}#section`, title: 'Old title' } };
      await repository.put(old);
      expect(await repository.claim(task('v2-key'), true)).toEqual({ task: old, created: false });
      expect(await database.meta.count()).toBe(1);
      expect(await repository.get('v2-key')).toBeUndefined();
    },
  );

  it('atomically deduplicates concurrent claims using different version keys across repository instances', async () => {
    const { database, repository } = setup();
    const other = setup(database.name);
    const claims = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? repository : other.repository).claim(task(index % 2 ? 'v1-key' : 'v2-key'))));
    expect(claims.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(claims.map(({ task }) => task.id)).size).toBe(1);
    expect(await database.meta.count()).toBe(1);
    other.database.close();
  });

  it.each(['ready', 'failed', 'stopped'] as const)('allows a new version after an older %s task', async (status) => {
    const { repository } = setup();
    await repository.put(task('v1-key', status));
    expect(await repository.claim(task('v2-key'))).toEqual({ task: task('v2-key'), created: true });
  });

  it('keeps unknown protection after reopening the repository', async () => {
    const { database, repository } = setup();
    const old = { ...task('v1-key', 'unknown'), remoteUuid: 'remote', runId: 'run' };
    await repository.put(old);
    database.close();
    const reopened = setup(database.name);
    expect(await reopened.repository.claim(task('v2-key'), true)).toEqual({ task: old, created: false });
    reopened.database.close();
  });

  it.each(['target', 'url', 'order', 'text', 'paragraph-id'] as const)(
    'permits a distinct %s even when the prior version is unknown', async (difference) => {
      const { repository } = setup();
      const old = { ...task('v1-key', 'unknown'), snapshot: { ...snapshot, paragraphs: [
        { id: 'a', text: 'Read the article.' }, { id: 'b', text: 'Use a script.' },
      ] } };
      await repository.put(old);
      const next: PageReadingTask = structuredClone({ ...old, id: 'v2-key', status: 'preparing' });
      if (difference === 'target') next.target = 'another-agent';
      if (difference === 'url') next.snapshot.url = 'https://example.com/other';
      if (difference === 'order') next.snapshot.paragraphs.reverse();
      if (difference === 'text') next.snapshot.paragraphs[0]!.text += ' Updated.';
      if (difference === 'paragraph-id') next.snapshot.paragraphs[0]!.id = 'new-a';
      expect(await repository.claim(next)).toEqual({ task: next, created: true });
    },
  );

  it('lists unfinished tasks and prunes only old completed records, preserving unknown and unrelated metadata', async () => {
    const { database, repository } = setup();
    await database.meta.put({ key: 'other-feature', value: 'kept' });
    for (const status of ['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping', 'unknown'] as const) {
      await repository.put(task(status, status));
    }
    for (let i = 0; i < 25; i++) await repository.put(task(`done-${i}`, (['ready', 'failed', 'stopped'] as const)[i % 3]!, i));
    expect((await repository.listUnfinished()).map(({ status }) => status).sort())
      .toEqual(['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping'].sort());
    await repository.prune();
    expect(await database.meta.count()).toBe(MAX_CACHED_PAGE_READING_TASKS + 8);
    expect(await repository.get('done-0')).toBeUndefined();
    expect(await repository.get('done-24')).toMatchObject({ id: 'done-24' });
    expect(await repository.get('unknown')).toMatchObject({ status: 'unknown' });
    expect((await repository.listUnfinished())).toHaveLength(6);
    expect((await database.meta.get('other-feature'))?.value).toBe('kept');
  });

  it('never writes conversations and keeps disposable analysis out of local knowledge backups', async () => {
    const { database, repository } = setup();
    await repository.claim(task('private-analysis', 'ready'));
    const backup = await createYemaiBackup(database, { appVersion: 'test' });
    expect(backup.counts).toMatchObject({ conversations: 0, messages: 0, sources: 0, artifacts: 0, readingCards: 0, wordCards: 0 });
    expect(JSON.stringify(backup)).not.toContain('private-analysis');
    expect(JSON.stringify(backup)).not.toContain('api.example.com');
  });
});
