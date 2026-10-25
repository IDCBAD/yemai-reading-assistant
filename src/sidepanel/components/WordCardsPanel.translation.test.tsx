import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordCard } from '../../shared/wordCards';
import type { ManualTranslationResult } from '../../shared/wordTranslation';
import { translateManually } from '../manualTranslation';
import { requestWordCardReferenceTranslation } from './WordCardsPanel';

vi.mock('../manualTranslation', () => ({
  translateManually: vi.fn(), loadTranslationPreference: vi.fn(),
  isRemoteManualPreference: () => true, manualTranslationLabel: () => '百度 · 机器翻译',
}));

const preference = { service: 'baidu-nmt' as const, remoteEnabled: true, configured: true };
const card = {
  id: 'word-1', word: 'theme', sentence: 'Refresh a theme, share a vault.', captureKey: 'capture-1', normalizedWord: 'theme',
  source: { kind: 'page' as const, title: 'Article', url: 'https://example.com' }, createdAt: 1, updatedAt: 1,
} satisfies WordCard;
const result: ManualTranslationResult = { translation: '主题', service: 'baidu-nmt', source: 'baidu' };

beforeEach(() => { vi.mocked(translateManually).mockReset(); });

describe('word card manual reference translation', () => {
  it('starts the chosen field inside the click and preserves the actual Baidu source', async () => {
    vi.mocked(translateManually).mockResolvedValue({ ...result, translation: '  主题  ' });
    const progress = vi.fn();
    const pending = requestWordCardReferenceTranslation(card, 'meaning', preference, () => true, progress);
    // No settings await before the invocation: browser creation must retain click activation.
    expect(translateManually).toHaveBeenCalledExactlyOnceWith('theme', { preference, onDownloadProgress: progress });
    expect(await pending).toEqual(result);
  });

  it('sends only the captured sentence when requesting the sentence field', async () => {
    vi.mocked(translateManually).mockResolvedValue({ ...result, translation: '刷新一个主题，分享一个库。' });
    await requestWordCardReferenceTranslation(card, 'sentence', preference, () => true);
    expect(translateManually).toHaveBeenCalledExactlyOnceWith(card.sentence, { preference, onDownloadProgress: undefined });
  });

  it('discards a late result after a card or service switch', async () => {
    let resolve!: (value: ManualTranslationResult) => void;
    vi.mocked(translateManually).mockReturnValue(new Promise(value => { resolve = value; }));
    let current = true;
    const pending = requestWordCardReferenceTranslation(card, 'meaning', preference, () => current);
    current = false; resolve(result);
    expect(await pending).toBeNull();
  });

  it('keeps browser provenance when the local service was explicitly selected', async () => {
    const local = { service: 'local' as const, remoteEnabled: false, configured: false };
    vi.mocked(translateManually).mockResolvedValue({ translation: '主题', source: 'browser', service: 'browser' });
    expect(await requestWordCardReferenceTranslation(card, 'meaning', local, () => true))
      .toMatchObject({ source: 'browser', service: 'browser' });
  });

  it.each([{ field: 'meaning' as const, text: 'x'.repeat(2001) }, { field: 'sentence' as const, text: 'x'.repeat(4001) }, { field: 'meaning' as const, text: '   ' }])(
    'rejects empty and oversized results instead of saving them', async ({ field, text }) => {
      vi.mocked(translateManually).mockResolvedValue({ ...result, translation: text });
      await expect(requestWordCardReferenceTranslation(card, field, preference, () => true)).rejects.toThrow('译文为空或超过');
    },
  );

  it('rejects an unavailable field without sending an API request', async () => {
    await expect(requestWordCardReferenceTranslation({ ...card, sentence: '' }, 'sentence', preference, () => true)).rejects.toThrow('英文内容');
    expect(translateManually).not.toHaveBeenCalled();
  });

  it('does not retry or replace a failed chosen service', async () => {
    vi.mocked(translateManually).mockRejectedValue(new Error('百度翻译认证失败。'));
    await expect(requestWordCardReferenceTranslation(card, 'meaning', preference, () => true)).rejects.toThrow('认证失败');
    expect(translateManually).toHaveBeenCalledTimes(1);
  });
});
