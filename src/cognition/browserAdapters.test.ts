import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { YemaiDatabase } from '../data/database';
import { DexieCognitionProjection } from './browserAdapters';

const databases: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => Dexie.delete(name)));
});

describe('DexieCognitionProjection', () => {
  it('is a replaceable projection and never touches workspace rows', async () => {
    const name = `cognition-projection-${crypto.randomUUID()}`;
    databases.push(name);
    const database = new YemaiDatabase(name);
    const projection = new DexieCognitionProjection(database);
    await database.meta.put({ key: 'workspace-marker', value: 'keep' });
    const row = {
      id: 'cognition-1', filename: 'one.md', title: '一个原则', type: 'judgment-principle',
      status: 'current', updatedAt: '2026-08-27T08:00:00.000Z', searchableText: '一个原则', fingerprint: 'abc',
    };

    await projection.put(row);
    expect(await projection.all()).toEqual([row]);
    await projection.replace([]);

    expect(await projection.all()).toEqual([]);
    expect((await database.meta.get('workspace-marker'))?.value).toBe('keep');
  });
});
