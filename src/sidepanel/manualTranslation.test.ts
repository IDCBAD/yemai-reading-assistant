import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translateManually, loadTranslationPreference, manualTranslationEnabled } from './manualTranslation';
import type { TranslationPreference } from '../shared/wordTranslation';
const { sendMessage, translateLocally } = vi.hoisted(() => ({ sendMessage: vi.fn(), translateLocally: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));
vi.mock('./localTranslator', () => ({ translateLocally }));
const remote: TranslationPreference = { service: 'auto', remoteEnabled: true, configured: true };
beforeEach(() => { sendMessage.mockReset(); translateLocally.mockReset(); });
describe('manual translation service selection', () => {
  it('uses the shared background service without creating a local translator', async () => {
    sendMessage.mockResolvedValue({ ok: true, result: { translation: '任务完成。', service: 'baidu-nmt', source: 'baidu' } });
    expect(manualTranslationEnabled(remote, false)).toBe(true);
    expect(await translateManually('The task is complete.', { preference: remote })).toMatchObject({ source: 'baidu' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'word-translation:text', input: { text: 'The task is complete.', service: 'auto' } });
    expect(translateLocally).not.toHaveBeenCalled();
  });
  it('starts the browser translator synchronously inside the click without waiting for settings', async () => {
    translateLocally.mockResolvedValue('完成');
    const result = translateManually('complete', { preference: { ...remote, service: 'local' } });
    expect(translateLocally).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await result).toMatchObject({ translation: '完成', source: 'browser', service: 'browser' });
  });
  it('uses local only for unconfigured Auto, not for explicitly selected Baidu', async () => {
    translateLocally.mockResolvedValue('任务');
    await translateManually('task', { preference: { ...remote, configured: false } });
    expect(translateLocally).toHaveBeenCalledTimes(1);
    sendMessage.mockResolvedValue({ ok: false, error: '请配置百度翻译。' });
    await expect(translateManually('task', { preference: { ...remote, configured: false, service: 'baidu-llm' } })).rejects.toThrow('请配置');
    expect(translateLocally).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized text before calling any provider and does not translate when merely reading preferences', async () => {
    sendMessage.mockResolvedValue({ ok: true, preference: remote });
    expect(await loadTranslationPreference()).toEqual(remote);
    await expect(translateManually('a'.repeat(5001), { preference: remote })).rejects.toThrow('5000');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(translateLocally).not.toHaveBeenCalled();
    expect(manualTranslationEnabled(null, true)).toBe(false);
  });
});
