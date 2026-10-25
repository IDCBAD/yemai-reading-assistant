import { afterEach, describe, expect, it, vi } from 'vitest';
import { BAIDU_TRANSLATION_ENDPOINT, translateBaidu } from './baiduTranslation';
const request = { appid: '123456789', apiKey: 'test-only-not-a-real-key', text: 'complete', model: 'llm' as const };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.useRealTimers());
describe('Baidu translation transport', () => {
  it('uses the fixed endpoint, Bearer and documented response; llm reference is explicit', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ trans_result: [{ src: 'complete', dst: '完成' }] }));
    expect(await translateBaidu({ ...request, reference: '原句：The task is complete.' }, { fetch: fetcher })).toBe('完成');
    const [endpoint, init] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe(BAIDU_TRANSLATION_ENDPOINT);
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(init.headers.Authorization).toBe('Bearer test-only-not-a-real-key');
    expect(JSON.parse(init.body)).toEqual({ appid: '123456789', from: 'en', to: 'zh', q: 'complete', model_type: 'llm', reference: '原句：The task is complete.' });
  });
  it('nmt omits reference and rejects unsupported instructions before sending', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ trans_result: [{ src: 'complete', dst: '完整' }] }));
    await translateBaidu({ ...request, model: 'nmt' }, { fetch: fetcher });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty('reference');
    await expect(translateBaidu({ ...request, model: 'nmt', reference: 'instruction' }, { fetch: fetcher })).rejects.toMatchObject({ code: 'configuration' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('has a hard timeout even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    const promise = translateBaidu(request, { timeoutMs: 25, fetch: vi.fn(() => new Promise<Response>(() => {})) });
    const check = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30); await check;
  });
  it('covers response-body stalls with the same deadline', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const promise = translateBaidu(request, { timeoutMs: 25, fetch: vi.fn().mockResolvedValue(new Response(body)) });
    const check = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(30); await check;
  });
  it.each([
    new Response('not-json'), json({ trans_result: [{ src: 'another word', dst: '文本' }] }),
    json({ trans_result: [{ src: 'complete', dst: '' }] }), json({ trans_result: 'wrong' }),
    json({ trans_result: [{ src: 'complete', dst: 'x'.repeat(128_001) }] }),
  ])('rejects malformed, oversized and mismatched output', async response => {
    await expect(translateBaidu(request, { fetch: vi.fn().mockResolvedValue(response) })).rejects.toMatchObject({ code: 'response' });
  });
  it.each([['52003', 'auth'], ['54001', 'auth'], ['54004', 'quota'], ['54003', 'rate'], ['54005', 'rate']])('maps %s without revealing upstream messages', async (code, expected) => {
    const promise = translateBaidu(request, { fetch: vi.fn().mockResolvedValue(json({ error_code: code, error_msg: request.apiKey })) });
    await expect(promise).rejects.toMatchObject({ code: expected });
    await expect(promise).rejects.not.toThrow(request.apiKey);
  });
  it('does not expose network exception content or retry', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`secret ${request.apiKey}`));
    await expect(translateBaidu(request, { fetch: fetcher })).rejects.toMatchObject({ code: 'network' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending request without retrying', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const promise = translateBaidu(request, { signal: controller.signal, fetch: fetcher });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
