// @ts-expect-error Node built-ins are available in Vitest; this browser project omits Node ambient types.
import { createHash } from 'node:crypto';
// @ts-expect-error Node built-ins are available in Vitest; this browser project omits Node ambient types.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getURL = vi.hoisted(() => vi.fn((path: string) => `chrome-extension://test-extension${path}`));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL } } }));

const fetchMock = vi.fn<typeof fetch>();
function readShard(letter: string): string {
  return readFileSync(new URL(`../../public/dictionaries/en-zh-ecdict/${letter}.json`, import.meta.url), 'utf8');
}
const sample = JSON.stringify({ predictable: 'a. 可预言的', predict: 'v. 预言', "people's": '测试词条' });

beforeEach(() => {
  vi.resetModules();
  getURL.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('packaged English-to-Chinese meaning dictionary', () => {
  it('keeps every generated shard consistent with the pinned source manifest', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/dictionaries/en-zh-ecdict/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.revision).toBe('bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b');
    expect(manifest.sourceSha256).toBe('1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf');
    expect(manifest.frequencyLimit).toBe(40_000);
    const { parseWordMeaningDictionary } = await import('./wordMeaningDictionary');
    let count = 0;
    let bytes = 0;
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const raw = readShard(letter);
      const entries = parseWordMeaningDictionary(raw, letter);
      const shard = manifest.shards[letter];
      expect(createHash('sha256').update(raw).digest('hex')).toBe(shard.sha256);
      expect(new TextEncoder().encode(raw).byteLength).toBe(shard.bytes);
      expect(Object.keys(entries).length).toBe(shard.entries);
      expect(shard.bytes).toBeLessThan(650_000);
      count += shard.entries;
      bytes += shard.bytes;
    }
    expect(count).toBe(80_137);
    expect(manifest.entries).toBe(count);
    expect(bytes).toBe(5_183_475);
    expect(manifest.bytes).toBe(bytes);
  });

  it('returns actual source meanings for article words and an explicitly stored inflection', async () => {
    fetchMock.mockImplementation(async (url) => {
      const letter = String(url).match(/\/([a-z])\.json$/)?.[1];
      return new Response(letter ? readShard(letter) : '', { status: letter ? 200 : 404 });
    });
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    expect(await lookupWordMeaning(' Predictable ')).toBe('a. 可预言的');
    expect(await lookupWordMeaning('flexibility')).toBe('n. 弹性, 适应性\n[计] 灵活性; 适应性');
    expect(await lookupWordMeaning('workflow')).toBe('工作流程');
    expect(await lookupWordMeaning('navigates')).toBe('v. 给（船舶、飞机等）引航, 导航( navigate的第三人称单数 ); （从海上、空中等）横越; 横渡; 飞跃');
    expect(await lookupWordMeaning('navigateses')).toBeNull();
    expect(await lookupWordMeaning('zz-unlisted-yemai')).toBeNull();
    expect(await lookupWordMeaning('very predictable')).toBeNull();
  });

  it('merges concurrent same-letter loads and normalizes only casing, whitespace edges and apostrophes', async () => {
    fetchMock.mockResolvedValue(new Response(sample));
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    expect(await Promise.all([lookupWordMeaning('Predictable'), lookupWordMeaning('predict'), lookupWordMeaning(' PEOPLE’S ')])).toEqual(['a. 可预言的', 'v. 预言', '测试词条']);
    expect(await lookupWordMeaning('predictable')).toBe('a. 可预言的');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('chrome-extension://test-extension/dictionaries/en-zh-ecdict/p.json', expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(getURL).toHaveBeenCalledExactlyOnceWith('/dictionaries/en-zh-ecdict/p.json');
  });

  it('loads different letters independently and never fetches a full dictionary', async () => {
    fetchMock.mockImplementation(async (url) => new Response(String(url).endsWith('/p.json') ? sample : JSON.stringify({ flexibility: 'n. 弹性, 适应性' })));
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    expect(await Promise.all([lookupWordMeaning('predictable'), lookupWordMeaning('flexibility')])).toEqual(['a. 可预言的', 'n. 弹性, 适应性']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getURL.mock.calls.map(([path]) => path).sort()).toEqual(['/dictionaries/en-zh-ecdict/f.json', '/dictionaries/en-zh-ecdict/p.json']);
  });

  it('does not infer roots or substrings, and rejects non-English input without loading', async () => {
    fetchMock.mockResolvedValue(new Response(sample));
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    expect(await lookupWordMeaning('predictables')).toBeNull();
    expect(await lookupWordMeaning('predicta')).toBeNull();
    expect(await lookupWordMeaning('  ')).toBeNull();
    expect(await lookupWordMeaning('中文')).toBeNull();
    expect(await lookupWordMeaning('../p')).toBeNull();
    expect(await lookupWordMeaning('p'.repeat(81))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'status', 'invalid', 'wrong-shard', 'empty', 'bad-value'] as const)('allows retry after %s failure', async (failure) => {
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
    if (failure === 'status') fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    if (failure === 'invalid') fetchMock.mockResolvedValueOnce(new Response('<html>not JSON</html>'));
    if (failure === 'wrong-shard') fetchMock.mockResolvedValueOnce(new Response('{"adapt":"v. 适应"}'));
    if (failure === 'empty') fetchMock.mockResolvedValueOnce(new Response('{}'));
    if (failure === 'bad-value') fetchMock.mockResolvedValueOnce(new Response('{"predictable":null}'));
    fetchMock.mockResolvedValueOnce(new Response(sample));
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    expect(await lookupWordMeaning('predictable')).toBeNull();
    expect(await lookupWordMeaning('predictable')).toBe('a. 可预言的');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds hung fetch and body reads, aborts the load and permits retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    fetchMock.mockResolvedValueOnce({ ok: true, text: () => new Promise(() => undefined) } as unknown as Response);
    fetchMock.mockResolvedValueOnce(new Response(sample));
    const { lookupWordMeaning } = await import('./wordMeaningDictionary');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = lookupWordMeaning('predictable');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await result).toBeNull();
      expect((fetchMock.mock.calls[attempt]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    }
    expect(await lookupWordMeaning('predictable')).toBe('a. 可预言的');
  });
});
