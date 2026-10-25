import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectExpression, collectWord, getCollectedExpressions } from './wordCollectionClient';
import { normalizeWord, wordCaptureKey, type WordCardCapture } from '../shared/wordCards';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));
const capture: WordCardCapture = { word: 'even if', sentence: 'It works even if the input varies.',
  expression: { name: 'even if' }, source: { kind: 'page', title: 'Article', url: 'https://example.com/article' } };
const card = { ...capture, id: 'expression-card', captureKey: wordCaptureKey(capture), normalizedWord: normalizeWord(capture.word), createdAt: 1, updatedAt: 1 };
beforeEach(() => { sendMessage.mockReset(); });

describe('expression collection client', () => {
  it('uses dedicated save route and returns the existing card without choosing a new example', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, card, alreadySaved: true });
    expect(await collectExpression(capture)).toEqual({ card, alreadySaved: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'word:save-expression', capture });
  });
  it('keeps ordinary word save on its original route', async () => {
    const ordinary = { ...capture, expression: undefined };
    const ordinaryCard = { ...card, ...ordinary, captureKey: wordCaptureKey(ordinary) };
    sendMessage.mockResolvedValueOnce({ ok: true, card: ordinaryCard, alreadySaved: false });
    expect(await collectWord(ordinary)).toEqual({ card: ordinaryCard, alreadySaved: false });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'word:save', capture: ordinary });
  });
  it('queries this article and returns only normalized requested expression names', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, savedExpressions: ['EVEN IF', 'even if'] });
    expect(await getCollectedExpressions(capture.source.url!, ['even if', 'based on'])).toEqual(['even if']);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'word:expression-status', url: capture.source.url, names: ['even if', 'based on'] });
  });
  it.each([{ ok: true }, { ok: true, savedExpressions: ['unrequested expression'] }, { ok: true, savedExpressions: [3] }])('rejects incomplete or unrelated status responses', async (response) => {
    sendMessage.mockResolvedValueOnce(response);
    await expect(getCollectedExpressions(capture.source.url!, ['even if'])).rejects.toThrow('收藏状态无效');
  });
  it('surfaces persistence failure rather than claiming saved', async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, error: 'storage full' });
    await expect(collectExpression(capture)).rejects.toThrow('storage full');
    sendMessage.mockResolvedValueOnce({ ok: true, card: { ...card, expression: { name: '<invalid>' } } });
    await expect(collectExpression(capture)).rejects.toThrow('完整单词卡');
    const ordinary = { ...card, expression: undefined };
    sendMessage.mockResolvedValueOnce({ ok: true, card: { ...ordinary, captureKey: wordCaptureKey(ordinary) } });
    await expect(collectExpression(capture)).rejects.toThrow('来源不一致');
  });
});
