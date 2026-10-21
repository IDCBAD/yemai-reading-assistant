import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function factory(status: string) {
  const translate = vi.fn(async (text: string) => `中文：${text}`);
  const create = vi.fn(async () => ({ translate }));
  const availability = vi.fn(async () => status);
  vi.stubGlobal('Translator', { create, availability });
  return { translate, create, availability };
}

describe('local translation preparation', () => {
  it('does not start a model download automatically', async () => {
    const api = factory('downloadable'); const module = await import('./localTranslator');
    await expect(module.translateLocallyWhenReady('The workflow is predictable.')).rejects.toMatchObject({ code: 'setup-required' });
    expect(api.create).not.toHaveBeenCalled();
    const preparation = module.initializeLocalTranslation();
    expect(api.create).toHaveBeenCalledTimes(1); await preparation;
    await expect(module.translateLocallyWhenReady('The workflow is predictable.')).resolves.toBe('中文：The workflow is predictable.');
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('reuses an available translator for the word and complete sentence', async () => {
    const api = factory('available'); const module = await import('./localTranslator');
    await Promise.all([module.translateLocallyWhenReady('predictable'), module.translateLocallyWhenReady('The workflow is predictable.')]);
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.translate).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable browsers without attempting creation', async () => {
    vi.stubGlobal('Translator', undefined); const module = await import('./localTranslator');
    await expect(module.translateLocallyWhenReady('hello')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('allows activation retry after a rejected creation', async () => {
    const api = factory('available'); const denied = new Error('activation required'); denied.name = 'NotAllowedError';
    api.create.mockRejectedValueOnce(denied); const module = await import('./localTranslator');
    await expect(module.translateLocallyWhenReady('hello')).rejects.toMatchObject({ code: 'setup-required' });
    await module.initializeLocalTranslation();
    await expect(module.translateLocallyWhenReady('hello')).resolves.toBe('中文：hello');
    expect(api.create).toHaveBeenCalledTimes(2);
  });
});

it('retries stalled preparation while allowing downloads that keep progressing', async () => {
  vi.useFakeTimers();
  let progress: ((event: { loaded: number }) => void) | undefined;
  const create = vi.fn(({ monitor }) => {
    monitor({ addEventListener: (_type: string, listener: typeof progress) => { progress = listener; } });
    return new Promise(() => {});
  });
  vi.stubGlobal('Translator', { create });
  const module = await import('./localTranslator');
  const preparation = module.initializeLocalTranslation();
  const rejected = expect(preparation).rejects.toThrow('没有进展');
  await vi.advanceTimersByTimeAsync(70_000);
  progress?.({ loaded: 0.5 });
  await vi.advanceTimersByTimeAsync(70_000);
  expect(create).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  create.mockImplementationOnce(() => Promise.resolve({ translate: async () => '中文' }));
  await module.initializeLocalTranslation();
  expect(create).toHaveBeenCalledTimes(2);
  progress?.({ loaded: 1 });
  expect(vi.getTimerCount()).toBe(0);
});
