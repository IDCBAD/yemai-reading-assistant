import { describe, expect, it, vi } from 'vitest';
import { handleWordCollectionRequest, type WordCollectionDependencies } from './wordCollections';
import { normalizeWord, wordCaptureKey, type WordCard, type WordCardCapture } from '../shared/wordCards';

const capture: WordCardCapture = { word: 'unpredictable', sentence: 'An unpredictable workflow.', highlightStart: 3, highlightEnd: 16,
  source: { kind: 'page', title: 'Browser agents', url: 'https://browser-use.com/posts/browser-agents' } };
const card: WordCard = { ...capture, id: 'word-1', captureKey: wordCaptureKey(capture), normalizedWord: normalizeWord(capture.word), createdAt: 1, updatedAt: 1 };
const sender = { id: 'extension', url: capture.source.url };
function fixture() {
  return {
    extensionId: 'extension', extensionUrl: 'chrome-extension://extension/',
    runKnowledgeWrite: async <T>(write: () => Promise<T>) => write(),
    save: vi.fn(async () => ({ card, alreadySaved: false })), updateMeaning: vi.fn(async () => card),
    saveExpression: vi.fn(async () => ({ card, alreadySaved: false })), getCollectedExpressions: vi.fn(async () => ['even if']),
    enrich: vi.fn(async () => card), updateSentenceTranslation: vi.fn(async () => card),
    remove: vi.fn(async () => undefined), restore: vi.fn(async () => card), notify: vi.fn(async () => undefined),
  } satisfies WordCollectionDependencies;
}

describe('word collection messages', () => {
  it('saves expression captures from the current SPA URL through the write queue', async () => {
    const deps = fixture();
    const queue = vi.fn();
    deps.runKnowledgeWrite = async <T>(write: () => Promise<T>) => { queue(); return write(); };
    const expression = { ...capture, expression: { name: 'even if' }, source: { ...capture.source, url: 'https://browser-use.com/next#part' } };
    const spaSender = { ...sender, frameId: 0, tab: { id: 1, url: 'https://browser-use.com/next' } };
    expect(await handleWordCollectionRequest({ type: 'word:save-expression', capture: expression }, spaSender, deps)).toMatchObject({ ok: true });
    expect(deps.saveExpression).toHaveBeenCalledWith(expression);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(await handleWordCollectionRequest({ type: 'word:save-expression', capture: { ...expression, source: capture.source } }, spaSender, deps)).toMatchObject({ ok: false });
  });

  it('queries only requested expression status without taking the write queue or notifying', async () => {
    const deps = fixture();
    deps.runKnowledgeWrite = async () => { throw new Error('write queue must not run'); };
    const request = { type: 'word:expression-status', url: capture.source.url, names: ['even if'] };
    expect(await handleWordCollectionRequest(request, { ...sender, frameId: 0, tab: { id: 1 } }, deps)).toEqual({ ok: true, savedExpressions: ['even if'] });
    expect(deps.getCollectedExpressions).toHaveBeenCalledWith(capture.source.url, ['even if']);
    expect(deps.notify).not.toHaveBeenCalled();
    const panel = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' };
    expect(await handleWordCollectionRequest(request, panel, deps)).toMatchObject({ ok: true });
  });

  it.each([
    { ...sender, frameId: 1, tab: { id: 1 } },
    { ...sender, frameId: 0, tab: { id: 1, url: 'https://other.example/article' } },
    { ...sender, frameId: 0, tab: { id: -1 } },
    { ...sender, frameId: 0 },
    { ...sender, id: 'other', frameId: 0, tab: { id: 1 } },
  ])('rejects expression save and status for untrusted or noncurrent content senders', async (requestSender) => {
    const deps = fixture();
    expect(await handleWordCollectionRequest({ type: 'word:save-expression', capture: { ...capture, expression: { name: 'even if' } } }, requestSender, deps)).toMatchObject({ ok: false });
    expect(await handleWordCollectionRequest({ type: 'word:expression-status', url: capture.source.url, names: ['even if'] }, requestSender, deps)).toMatchObject({ ok: false });
    expect(deps.saveExpression).not.toHaveBeenCalled();
    expect(deps.getCollectedExpressions).not.toHaveBeenCalled();
  });

  it.each([{ names: Array(61).fill('even if') }, { names: ['<b>bad</b>'] }, { url: 'file:///local' }, { names: 'even if' }])('rejects malformed expression status queries', async (patch) => {
    const deps = fixture();
    expect(await handleWordCollectionRequest({ type: 'word:expression-status', url: capture.source.url, names: ['even if'], ...patch }, { ...sender, frameId: 0, tab: { id: 1 } }, deps)).toMatchObject({ ok: false });
    expect(deps.getCollectedExpressions).not.toHaveBeenCalled();
  });

  it('cannot bypass expression persistence rules through ordinary save', async () => {
    const deps = fixture();
    expect(await handleWordCollectionRequest({ type: 'word:save', capture: { ...capture, expression: { name: 'even if' } } }, sender, deps)).toMatchObject({ ok: false });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('returns success only after persistence completes, even when the panel broadcast fails', async () => {
    const deps = fixture();
    let complete!: () => void;
    deps.save.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { complete = resolve; }); return { card, alreadySaved: false }; });
    deps.notify.mockRejectedValueOnce(new Error('No receiving end'));
    let settled = false;
    const pending = handleWordCollectionRequest({ type: 'word:save', capture }, sender, deps).then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(deps.notify).not.toHaveBeenCalled();
    complete();
    expect(await pending).toEqual({ ok: true, card, alreadySaved: false });
  });
  it('does not acknowledge a database failure', async () => {
    const deps = fixture();
    deps.save.mockRejectedValueOnce(new Error('Quota exceeded'));
    expect(await handleWordCollectionRequest({ type: 'word:save', capture }, sender, deps)).toEqual({ ok: false, error: 'Quota exceeded' });
    expect(deps.notify).not.toHaveBeenCalled();
  });
  it('also ignores a synchronous notification failure after committing', async () => {
    const deps = fixture();
    deps.notify.mockImplementationOnce(() => { throw new Error('runtime unavailable'); });
    expect(await handleWordCollectionRequest({ type: 'word:save', capture }, sender, deps)).toMatchObject({ ok: true, card });
  });
  it.each([
    [{ type: 'word:save', capture }, { ...sender, id: 'other' }],
    [{ type: 'word:save', capture }, { ...sender, url: 'https://other.example/' }],
    [{ type: 'word:save', capture: { ...capture, word: 'hello. entire sentence.' } }, sender],
    [{ type: 'word:save', capture: { ...capture, source: { kind: 'assistant', title: '', messageId: 'answer' } } }, sender],
    [{ type: 'word:remove', id: card.id }, sender],
    [{ type: 'word:restore', card }, sender],
  ])('rejects invalid payload or sender without writing', async (request, requestSender) => {
    const deps = fixture();
    expect(await handleWordCollectionRequest(request, requestSender, deps)).toMatchObject({ ok: false });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.restore).not.toHaveBeenCalled();
  });
  it('allows assistant captures and edits only from extension pages', async () => {
    const deps = fixture();
    const panel = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' };
    const assistantCapture = { ...capture, source: { kind: 'assistant', title: '回答', messageId: 'answer' } };
    expect(await handleWordCollectionRequest({ type: 'word:save', capture: assistantCapture }, panel, deps)).toMatchObject({ ok: true });
    expect(await handleWordCollectionRequest({ type: 'word:update-meaning', id: card.id, meaning: '不可预测的', meaningSource: 'manual', expectedUpdatedAt: 1 }, panel, deps)).toMatchObject({ ok: true, card });
    expect(deps.updateMeaning).toHaveBeenCalledWith(card.id, '不可预测的', 'manual', 1, undefined);
  });
  it('rejects changes during maintenance before invoking storage', async () => {
    const deps = fixture();
    deps.runKnowledgeWrite = async () => { throw new Error('正在导入备份'); };
    expect(await handleWordCollectionRequest({ type: 'word:save', capture }, sender, deps)).toEqual({ ok: false, error: '正在导入备份' });
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('routes enrichment and manual sentence updates through the maintenance-aware queue', async () => {
    const deps = fixture();
    const queue = vi.fn();
    deps.runKnowledgeWrite = async <T>(write: () => Promise<T>) => { queue(); return write(); };
    const panel = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' };
    const patch = { meaning: '难以预测的', meaningSource: 'dictionary', sentenceTranslation: '难以预测的流程。', sentenceTranslationSource: 'browser' };
    expect(await handleWordCollectionRequest({ type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch }, panel, deps)).toMatchObject({ ok: true, card });
    expect(deps.enrich).toHaveBeenCalledWith(card.id, card.captureKey, patch);
    expect(await handleWordCollectionRequest({ type: 'word:update-sentence-translation', id: card.id, translation: '', expectedUpdatedAt: 1 }, panel, deps)).toMatchObject({ ok: true, card });
    expect(deps.updateSentenceTranslation).toHaveBeenCalledWith(card.id, '', 1, undefined, undefined);
    expect(queue).toHaveBeenCalledTimes(2);
  });

  it('forwards validated field snapshots for explicit edits', async () => {
    const deps = fixture();
    const panel = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' };
    const expectedField = { captureKey: card.captureKey, value: '', source: 'manual' };
    expect(await handleWordCollectionRequest({ type: 'word:update-meaning', id: card.id, meaning: '确认的翻译', meaningSource: 'browser', expectedUpdatedAt: 1, expectedField }, panel, deps)).toMatchObject({ ok: true });
    expect(deps.updateMeaning).toHaveBeenCalledWith(card.id, '确认的翻译', 'browser', 1, expectedField);
    expect(await handleWordCollectionRequest({ type: 'word:update-sentence-translation', id: card.id, translation: '原句译文', expectedUpdatedAt: 1, expectedField }, panel, deps)).toMatchObject({ ok: true });
    expect(deps.updateSentenceTranslation).toHaveBeenCalledWith(card.id, '原句译文', 1, expectedField, undefined);
  });
  it('preserves the selected manual translator source and rejects unknown sentence sources', async () => {
    const deps = fixture();
    const panel = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' };
    const request = { type: 'word:update-sentence-translation', id: card.id, translation: '原句译文', source: 'baidu' };
    expect(await handleWordCollectionRequest(request, panel, deps)).toMatchObject({ ok: true });
    expect(deps.updateSentenceTranslation).toHaveBeenCalledWith(card.id, '原句译文', undefined, undefined, 'baidu');
    expect(await handleWordCollectionRequest({ ...request, source: 'unknown' }, panel, deps)).toMatchObject({ ok: false });
    expect(deps.updateSentenceTranslation).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch: { meaning: 'x', meaningSource: 'manual' } },
    { type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch: { meaning: 'x' } },
    { type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch: { sentenceTranslation: 'x', sentenceTranslationSource: 'dictionary' } },
    { type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch: { meaning: 'x', meaningSource: 'browser', extra: true } },
    { type: 'word:enrich', id: card.id, captureKey: '', patch: { meaning: 'x', meaningSource: 'browser' } },
    { type: 'word:update-sentence-translation', id: card.id, translation: 'x'.repeat(4_001) },
    { type: 'word:update-meaning', id: card.id, meaning: 'x', meaningSource: 'manual', expectedField: { captureKey: card.captureKey, value: '', source: 'invalid' } },
    { type: 'word:update-sentence-translation', id: card.id, translation: 'x', expectedField: { captureKey: card.captureKey, value: '', source: 'dictionary' } },
    { type: 'word:update-meaning', id: card.id, meaning: 'x', meaningSource: 'manual', expectedField: { captureKey: card.captureKey } },
  ])('rejects invalid enrichment and sentence writes without invoking storage', async (request) => {
    const deps = fixture();
    expect(await handleWordCollectionRequest(request, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' }, deps)).toMatchObject({ ok: false });
    expect(deps.enrich).not.toHaveBeenCalled();
    expect(deps.updateMeaning).not.toHaveBeenCalled();
    expect(deps.updateSentenceTranslation).not.toHaveBeenCalled();
  });

  it('rejects page-origin enrichment and import-time writes', async () => {
    const deps = fixture();
    const request = { type: 'word:enrich', id: card.id, captureKey: card.captureKey, patch: { meaning: 'x', meaningSource: 'browser' } };
    expect(await handleWordCollectionRequest(request, sender, deps)).toMatchObject({ ok: false });
    deps.runKnowledgeWrite = async () => { throw new Error('正在导入备份'); };
    expect(await handleWordCollectionRequest(request, { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' }, deps)).toEqual({ ok: false, error: '正在导入备份' });
    expect(deps.enrich).not.toHaveBeenCalled();
  });
});
