import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWordTranslationRuntime, type WordTranslationDependencies } from './wordTranslation';
import type { TranslationSettings, TranslationUsage } from '../shared/wordTranslation';
import { BaiduTranslationError, type BaiduTranslationRequest } from '../services/baiduTranslation';
const input = { word: 'complete', sentence: 'The task is complete.' };
function setup(overrides: Partial<WordTranslationDependencies> = {}) {
  let settings: TranslationSettings = { service: 'auto', remoteEnabled: true, appid: '123456789', apiKey: 'test-only-key' };
  let usage: TranslationUsage | undefined;
  const translate = vi.fn(overrides.translate ?? (async (request: BaiduTranslationRequest) => request.text === 'complete' ? '完成的' : '任务已完成。'));
  const deps = { getSettings: vi.fn(async () => settings), lookupMeaning: vi.fn(async () => '完整；完成'),
    lookupPronunciation: vi.fn(async () => '/kəmˈpliːt/'),
    getUsage: vi.fn(async () => usage), setUsage: vi.fn(async (value: TranslationUsage) => { usage = value; }), ...overrides, translate };
  return { runtime: createWordTranslationRuntime(deps), deps, setSettings: (value: Partial<TranslationSettings>) => { settings = { ...settings, ...value }; }, getUsage: () => usage };
}
afterEach(() => vi.useRealTimers());
describe('word translation runtime', () => {
  it('shares exact sentence translations between webpage lookup and sidepanel manual translation', async () => {
    const { runtime, deps, getUsage } = setup();
    await runtime.lookup({ ...input, service: 'baidu-nmt' });
    const before = { ...getUsage() };
    const result = await runtime.translateText({ text: input.sentence });
    expect(result).toMatchObject({ translation: '任务已完成。', source: 'baidu', service: 'baidu-nmt' });
    expect(deps.translate).toHaveBeenCalledTimes(2);
    expect(getUsage()).toEqual(before);
  });
  it('translates only the selected text once, supports long passages and honors explicit model choice', async () => {
    const { runtime, deps } = setup();
    const text = 'An English paragraph. '.repeat(30);
    await runtime.translateText({ text, service: 'baidu-llm' });
    expect(deps.translate).toHaveBeenCalledTimes(1);
    expect(deps.translate).toHaveBeenCalledWith(expect.objectContaining({ text: text.trim(), model: 'llm' }));
    await expect(runtime.translateText({ text: 'x'.repeat(5001) })).rejects.toThrow('5000');
    expect(deps.translate).toHaveBeenCalledTimes(1);
  });
  it('never sends a manual remote request when disabled or local was explicitly selected', async () => {
    const { runtime, deps, setSettings } = setup();
    await expect(runtime.translateText({ text: 'complete', service: 'local' })).rejects.toMatchObject({ code: 'configuration' });
    setSettings({ remoteEnabled: false });
    await expect(runtime.translateText({ text: 'complete', service: 'baidu-llm' })).rejects.toMatchObject({ code: 'configuration' });
    expect(deps.translate).not.toHaveBeenCalled();
  });
  it('Auto routes context to llm with instruction and exposes only real returned fields', async () => {
    const { runtime, deps, getUsage } = setup();
    const result = await runtime.lookup(input);
    expect(result).toMatchObject({ service: 'baidu-llm', meaning: '完整；完成', contextMeaning: '完成的', sentenceTranslation: '任务已完成。' });
    expect(result.examples).toEqual([{ text: input.sentence, translation: '任务已完成。', source: 'page' }]);
    expect(deps.translate.mock.calls[0]![0]).toMatchObject({ model: 'llm', reference: expect.stringContaining(input.sentence) });
    expect(deps.translate.mock.calls[1]![0]).not.toHaveProperty('reference');
    expect(getUsage()?.llm).toBe(input.word.length + input.sentence.length);
    expect(getUsage()?.nmt).toBe(0);
  });
  it('Auto without context uses nmt; explicit nmt never claims contextual meaning', async () => {
    const { runtime, deps } = setup();
    expect((await runtime.lookup({ ...input, sentence: '' })).service).toBe('baidu-nmt');
    expect(await runtime.lookup({ ...input, service: 'baidu-nmt' })).not.toHaveProperty('contextMeaning');
    expect(deps.translate.mock.calls.every(call => !('reference' in call[0]))).toBe(true);
  });
  it('unconfigured Auto remains local with notice, explicit remote cannot silently fall back', async () => {
    const { runtime, deps, setSettings } = setup(); setSettings({ apiKey: '' });
    expect(await runtime.lookup(input)).toMatchObject({ service: 'local', meaning: '完整；完成', notice: expect.any(String) });
    await expect(runtime.lookup({ ...input, service: 'baidu-llm' })).rejects.toMatchObject({ code: 'configuration' });
    expect(deps.translate).not.toHaveBeenCalled();
  });
  it('explicit remote errors do not fall back or leak injected errors', async () => {
    const translate = vi.fn().mockRejectedValue(new BaiduTranslationError('auth'));
    const { runtime } = setup({ translate });
    await expect(runtime.lookup({ ...input, service: 'baidu-nmt' })).rejects.toMatchObject({ code: 'auth' });
    expect(translate).toHaveBeenCalledTimes(1);
  });
  it('singleflights simultaneous lookups and cache hits consume no requests or usage', async () => {
    const { runtime, deps, getUsage } = setup();
    const results = await Promise.all([runtime.lookup(input), runtime.lookup(input), runtime.lookup(input)]);
    expect(results).toHaveLength(3); expect(deps.translate).toHaveBeenCalledTimes(2);
    const usage = { ...getUsage() };
    const hit = await runtime.lookup(input); expect(hit.cached).toBe(true);
    expect(getUsage()).toEqual(usage); expect(deps.translate).toHaveBeenCalledTimes(2);
    hit.examples[0]!.text = 'mutated';
    expect((await runtime.lookup(input)).examples[0]!.text).toBe(input.sentence);
  });
  it('credentials and sentence changes invalidate results', async () => {
    const { runtime, deps, setSettings } = setup();
    await runtime.lookup(input); setSettings({ apiKey: 'second-test-only-key' });
    expect((await runtime.lookup(input)).cached).not.toBe(true);
    await runtime.lookup({ ...input, sentence: 'Complete the form.' });
    expect(deps.translate).toHaveBeenCalledTimes(6);
    expect(deps.translate.mock.calls[4]![0]).toMatchObject({ reference: expect.stringContaining('Complete the form.') });
    setSettings({ appid: '999999999' }); await runtime.lookup(input);
    expect(deps.translate).toHaveBeenCalledTimes(8);
  });
  it('serializes different lookups and enforces at least 120ms between requests', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const translate = vi.fn(async () => { starts.push(Date.now()); return '译文'; });
    const { runtime } = setup({ translate });
    const pending = Promise.all([runtime.lookup({ word: 'one', sentence: '' }), runtime.lookup({ word: 'two', sentence: '' })]);
    await vi.runAllTimersAsync(); await pending;
    expect(starts).toHaveLength(2); expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(120);
  });
  it('deduplicates identical word/sentence, expires cache and resets separate monthly estimates', async () => {
    let time = Date.UTC(2026, 9, 31, 23, 59);
    const { runtime, deps, getUsage } = setup({ now: () => time });
    await runtime.lookup({ word: 'complete', sentence: 'complete' });
    expect(deps.translate).toHaveBeenCalledTimes(1); expect(getUsage()?.llm).toBe(8);
    time += 31 * 60_000;
    await runtime.lookup({ word: 'complete', sentence: 'complete' });
    expect(deps.translate).toHaveBeenCalledTimes(2); expect(getUsage()).toEqual({ month: '2026-11', llm: 8, nmt: 0 });
  });
  it('validates malformed and oversized input before consulting providers', async () => {
    const { runtime, deps } = setup();
    for (const value of [null, {}, { ...input, sentence: 'x'.repeat(1001) }, { ...input, word: 'x'.repeat(241) },
      { ...input, word: Array(17).fill('word').join(' ') }, { ...input, word: '中文' }, { ...input, word: '<script>' },
      { ...input, word: 'based on\nresult in' }, { ...input, service: 'unknown' }]) {
      await expect(runtime.lookup(value as never)).rejects.toThrow('查词内容无效');
    }
    expect(deps.getSettings).not.toHaveBeenCalled();
  });
  it('reuses existing local and remote translation for full technical expressions', async () => {
    const { runtime, deps } = setup();
    const word = 'at least one complete MPEG frame';
    await runtime.lookup({ word, sentence: '', service: 'local' });
    expect(deps.lookupMeaning).toHaveBeenCalledWith(word);
    expect(deps.translate).not.toHaveBeenCalled();
    await runtime.lookup({ word: 'HTTP 429', sentence: '', service: 'baidu-nmt' });
    expect(deps.translate).toHaveBeenCalledWith(expect.objectContaining({ text: 'HTTP 429', model: 'nmt' }));
    await expect(runtime.lookup({ word: 'a'.repeat(240), sentence: '', service: 'local' })).resolves.toMatchObject({ service: 'local' });
  });
  it('keeps paid word/context results if the sentence request fails and allows manual retry', async () => {
    const translate = vi.fn().mockResolvedValueOnce('完成的').mockRejectedValueOnce(new BaiduTranslationError('timeout'))
      .mockResolvedValueOnce('任务已完成。');
    const { runtime } = setup({ translate });
    const partial = await runtime.lookup(input);
    expect(partial).toMatchObject({ meaning: '完整；完成', contextMeaning: '完成的', notice: expect.stringContaining('原句暂未译出') });
    expect(partial.sentenceTranslation).toBeUndefined();
    expect(partial.examples).toEqual([{ text: input.sentence, source: 'page', translation: undefined }]);
    expect(translate).toHaveBeenCalledTimes(2);
    expect((await runtime.lookup(input)).sentenceTranslation).toBe('任务已完成。');
    expect(translate).toHaveBeenCalledTimes(3);
    expect(translate.mock.calls[2]![0].text).toBe(input.sentence);
  });
  it('reuses the 117-character sentence when another word is selected and counts only new text', async () => {
    const sentence = 'Refresh a theme, share a vault, write a guide, or make a video that helps someone discover a new way to use Obsidian.';
    const { runtime, deps, getUsage } = setup();
    await runtime.lookup({ word: 'theme', sentence, service: 'baidu-nmt' });
    expect(getUsage()?.nmt).toBe(122);
    await runtime.lookup({ word: 'vault', sentence, service: 'baidu-nmt' });
    expect(getUsage()?.nmt).toBe(127);
    expect(deps.translate.mock.calls.filter(([request]) => request.text === sentence)).toHaveLength(1);
    expect(deps.translate).toHaveBeenCalledTimes(3);
  });
  it('singleflights a shared sentence across simultaneous lookups for different words', async () => {
    const { runtime, deps, getUsage } = setup();
    await Promise.all([runtime.lookup({ ...input, word: 'task' }), runtime.lookup(input)]);
    expect(deps.translate).toHaveBeenCalledTimes(3);
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.sentence)).toHaveLength(1);
    expect(getUsage()?.llm).toBe('task'.length + input.word.length + input.sentence.length);
  });
  it('does not share sentences between models or credential configurations', async () => {
    const { runtime, deps, setSettings } = setup();
    await runtime.lookup({ ...input, service: 'baidu-nmt' });
    await runtime.lookup({ ...input, word: 'task', service: 'baidu-llm' });
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.sentence)).toHaveLength(2);
    setSettings({ apiKey: 'another-synthetic-key' });
    await runtime.lookup({ ...input, word: 'task', service: 'baidu-nmt' });
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.sentence)).toHaveLength(3);
  });
  it('keeps contextual word requests distinct when the reference sentence changes', async () => {
    const { runtime, deps } = setup();
    await runtime.lookup(input);
    await runtime.lookup({ ...input, sentence: 'Please complete the task.' });
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.word)).toHaveLength(2);
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.word).map(([request]) => request.reference))
      .toEqual([expect.stringContaining(input.sentence), expect.stringContaining('Please complete the task.')]);
  });
  it('expires shared sentences and treats changed source text as a new request', async () => {
    let time = Date.UTC(2026, 9, 25);
    const { runtime, deps } = setup({ now: () => time });
    await runtime.lookup(input);
    await runtime.lookup({ ...input, word: 'task', sentence: input.sentence + ' ' + 'Again.' });
    time += 31 * 60_000;
    await runtime.lookup({ ...input, word: 'is' });
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.sentence)).toHaveLength(2);
    expect(deps.translate.mock.calls.filter(([request]) => request.text === input.sentence + ' Again.')).toHaveLength(1);
  });
  it.each(['任务已完成。', '词义\n说明', '长'.repeat(81)])('does not label sentence-like or overlong output as contextual word meaning', async wordResult => {
    const translate = vi.fn().mockResolvedValueOnce(wordResult).mockResolvedValueOnce('任务已完成。');
    const { runtime } = setup({ translate, lookupMeaning: async () => null });
    const result = await runtime.lookup(input);
    expect(result.contextMeaning).toBeUndefined();
    expect(result.meaning).toBeNull();
    expect(result.sentenceTranslation).toBe('任务已完成。');
    expect(result.notice).toContain('语境词义未通过格式检查');
  });
  it.each([{ remoteEnabled: false }, { apiKey: '' }])('rechecks permission after an in-flight word before sending its sentence', async changed => {
    let resolveWord!: (value: string) => void;
    const translate = vi.fn(() => new Promise<string>(resolve => { resolveWord = resolve; }));
    const { runtime, deps, setSettings, getUsage } = setup({ translate });
    const pending = runtime.lookup(input);
    const duplicate = runtime.lookup(input);
    const checks = [expect(pending).rejects.toThrow('翻译设置已更改'), expect(duplicate).rejects.toThrow('翻译设置已更改')];
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    setSettings(changed);
    resolveWord('完成的');
    await Promise.all(checks);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(getUsage()?.llm).toBe(input.word.length);
    const local = await runtime.lookup(input);
    expect(local).toMatchObject({ service: 'local', meaning: '完整；完成' });
    expect(local.contextMeaning).toBeUndefined();
    expect(local.cached).not.toBe(true);
    expect(deps.setUsage).toHaveBeenCalledTimes(1);
  });
  it('does not return or cache a late word result when disabled during a no-sentence request', async () => {
    let resolveWord!: (value: string) => void;
    const translate = vi.fn(() => new Promise<string>(resolve => { resolveWord = resolve; }));
    const { runtime, setSettings } = setup({ translate });
    const pending = runtime.lookup({ ...input, sentence: '' });
    const check = expect(pending).rejects.toThrow('翻译设置已更改');
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    setSettings({ remoteEnabled: false }); resolveWord('完整');
    await check;
    expect((await runtime.lookup({ ...input, sentence: '' })).service).toBe('local');
  });
  it('rechecks disabled settings after the spacing delay and does not count the unsent request', async () => {
    vi.useFakeTimers();
    const { runtime, deps, setSettings, getUsage } = setup();
    const first = runtime.lookup({ word: 'one', sentence: '' });
    const next = runtime.lookup({ word: 'two', sentence: '' });
    const check = expect(next).rejects.toThrow('翻译设置已更改');
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(deps.translate).toHaveBeenCalledTimes(1);
    setSettings({ remoteEnabled: false });
    await vi.advanceTimersByTimeAsync(150);
    await check;
    expect(deps.translate).toHaveBeenCalledTimes(1);
    expect(getUsage()?.nmt).toBe(3);
  });
});
