// @ts-expect-error Node built-ins are available in Vitest; this browser project omits Node ambient types.
import { createHash } from 'node:crypto';
// @ts-expect-error Node built-ins are available in Vitest; this browser project omits Node ambient types.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getURL = vi.hoisted(() => vi.fn((path: string) => `chrome-extension://test-extension${path}`));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL } } }));

const dictionary = readFileSync(new URL('../../public/dictionaries/en-US-ipa.txt', import.meta.url), 'utf8');
const sample = "predictable\t/pɹiˈdɪktəbəɫ/, /pɹɪˈdɪktəbəɫ/\nunpredictable\t/ˌənpɹɪˈdɪktəbəɫ/\nadapt\t/əˈdæpt/\ndon't\t/doʊnt/\n";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  getURL.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('packaged US pronunciation dictionary', () => {
  it('keeps the pinned upstream data intact and includes the words used in reading', async () => {
    expect(createHash('sha256').update(dictionary).digest('hex')).toBe('2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67');
    const { parseWordPronunciationDictionary } = await import('./wordPronunciation');
    const entries = parseWordPronunciationDictionary(dictionary);
    expect(entries.get('predictable')).toBe('/pɹiˈdɪktəbəɫ/, /pɹɪˈdɪktəbəɫ/');
    expect(entries.get('unpredictable')).toBe('/ˌənpɹɪˈdɪktəbəɫ/');
    expect(entries.get('adapt')).toBe('/əˈdæpt/');
    expect(entries.size).toBeGreaterThan(100_000);
  });

  it('preserves multiple readings and merges distinct duplicate lines', async () => {
    const { parseWordPronunciationDictionary } = await import('./wordPronunciation');
    const entries = parseWordPronunciationDictionary('read\t/ɹid/\r\nREAD\t/ɹɛd/\nread\t/ɹid/\nlead\t/lid/, /lɛd/\ninvalid\nempty\t\nhtml\t<p>not IPA</p>');
    expect(entries.get('read')).toBe('/ɹid/, /ɹɛd/');
    expect(entries.get('lead')).toBe('/lid/, /lɛd/');
    expect(entries.size).toBe(2);
  });

  it('looks up real dictionary text without constructing the complete parser result', async () => {
    fetchMock.mockResolvedValue(new Response(dictionary));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('predictable')).toBe('/pɹiˈdɪktəbəɫ/, /pɹɪˈdɪktəbəɫ/');
    expect(await lookupWordPronunciation('UNPREDICTABLE')).toBe('/ˌənpɹɪˈdɪktəbəɫ/');
    expect(await lookupWordPronunciation('adapt')).toBe('/əˈdæpt/');
    expect(await lookupWordPronunciation('yemai-unlisted-word')).toBeNull();
    expect(await lookupWordPronunciation('predictabl')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('merges only complete same-word lines and retains distinct IPA readings in source order', async () => {
    fetchMock.mockResolvedValue(new Response('read\t/ɹid/\r\nREAD\t/ɹɛd/\nread\t/ɹid/\nreading\t/ˈɹidɪŋ/\nbread\t/bɹɛd/\nread\t<p>invalid</p>\n'));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('read')).toBe('/ɹid/, /ɹɛd/');
    expect(await lookupWordPronunciation('reading')).toBe('/ˈɹidɪŋ/');
    expect(await lookupWordPronunciation('rea')).toBeNull();
  });

  it('treats punctuation literally and normalizes straight and curly apostrophes', async () => {
    fetchMock.mockResolvedValue(new Response("a.b\t/eɪ bi/\naxb\t/æks/\nc++\t/si/\nword(s)\t/wɜɹdz/\ndon’t\t/doʊnt/\ndon't\t/doʊnt/\ndon‘t\t/dəʊnt/\n"));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('a.b')).toBe('/eɪ bi/');
    expect(await lookupWordPronunciation('c++')).toBe('/si/');
    expect(await lookupWordPronunciation('word(s)')).toBe('/wɜɹdz/');
    expect(await lookupWordPronunciation('DON’T')).toBe('/doʊnt/, /dəʊnt/');
    expect(await lookupWordPronunciation('a.*')).toBeNull();
    expect(await lookupWordPronunciation('a.b\naxb')).toBeNull();
    expect(await lookupWordPronunciation('a.b\t/eɪ bi/')).toBeNull();
  });

  it('loads only the extension resource once across concurrent and subsequent lookups', async () => {
    fetchMock.mockResolvedValue(new Response(sample));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await Promise.all([lookupWordPronunciation('Predictable'), lookupWordPronunciation('adapt')])).toEqual(['/pɹiˈdɪktəbəɫ/, /pɹɪˈdɪktəbəɫ/', '/əˈdæpt/']);
    expect(await lookupWordPronunciation(' DON’T ')).toBe('/doʊnt/');
    expect(getURL).toHaveBeenCalledExactlyOnceWith('/dictionaries/en-US-ipa.txt');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('chrome-extension://test-extension/dictionaries/en-US-ipa.txt', expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  it('does not infer a root, substring, or phrase pronunciation for unknown entries', async () => {
    fetchMock.mockResolvedValue(new Response(sample));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('adapted')).toBeNull();
    expect(await lookupWordPronunciation('predict')).toBeNull();
    expect(await lookupWordPronunciation('very predictable')).toBeNull();
    expect(await lookupWordPronunciation('unknown-example-word')).toBeNull();
  });

  it('skips an empty word without loading the dictionary', async () => {
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('  ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['network', 'status', 'invalid'] as const)('allows retry after %s failure without a remote fallback', async (failure) => {
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
    if (failure === 'status') fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    if (failure === 'invalid') fetchMock.mockResolvedValueOnce(new Response('<html>not a dictionary</html>'));
    fetchMock.mockResolvedValueOnce(new Response(sample));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    expect(await lookupWordPronunciation('adapt')).toBeNull();
    expect(await lookupWordPronunciation('adapt')).toBe('/əˈdæpt/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === 'chrome-extension://test-extension/dictionaries/en-US-ipa.txt')).toBe(true);
  });

  it('bounds a hung resource load, aborts it, and permits retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    fetchMock.mockResolvedValueOnce(new Response(sample));
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    const result = lookupWordPronunciation('adapt');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBeNull();
    expect((fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(await lookupWordPronunciation('adapt')).toBe('/əˈdæpt/');
  });

  it('also bounds a body read that never finishes', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, text: () => new Promise(() => undefined) } as unknown as Response);
    const { lookupWordPronunciation } = await import('./wordPronunciation');
    const result = lookupWordPronunciation('adapt');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBeNull();
  });
});
