import { describe, expect, it, vi } from 'vitest';
import type { WordCard, WordCardEnrichment } from '../shared/wordCards';
import { startWordEnrichment } from './wordEnrichment';

const card: WordCard = { id: 'word-1', word: 'predictable', normalizedWord: 'predictable', sentence: 'The workflow is predictable.', source: { kind: 'page', title: 'Article', url: 'https://example.com/article' }, captureKey: 'capture-1', createdAt: 1, updatedAt: 1 };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
function setup(source = card) {
  const observer = { onPhase: vi.fn(), onSaved: vi.fn() };
  const dependencies = {
    dictionary: vi.fn(async (_word: string): Promise<string | null> => 'a. 可预言的'),
    translate: vi.fn(async (_text: string) => '这个流程是可预测的。'),
    save: vi.fn(async (_id: string, _key: string, patch: WordCardEnrichment): Promise<WordCard> => ({ ...source, ...patch, updatedAt: 2 })),
  };
  return { observer, dependencies };
}

describe('visible word-card enrichment', () => {
  it('uses dictionary meaning and translates the complete captured sentence independently', async () => {
    const { observer, dependencies } = setup();
    await startWordEnrichment(card, observer, dependencies).finished;
    expect(dependencies.dictionary).toHaveBeenCalledWith('predictable');
    expect(dependencies.translate).toHaveBeenCalledExactlyOnceWith(card.sentence);
    expect(dependencies.save).toHaveBeenCalledWith(card.id, card.captureKey, { meaning: 'a. 可预言的', meaningSource: 'dictionary' });
    expect(dependencies.save).toHaveBeenCalledWith(card.id, card.captureKey, { sentenceTranslation: '这个流程是可预测的。', sentenceTranslationSource: 'browser' });
  });
  it('falls back to a labeled browser meaning only when the dictionary has no entry', async () => {
    const { observer, dependencies } = setup(); dependencies.dictionary.mockResolvedValue(null);
    await startWordEnrichment(card, observer, dependencies).finished;
    expect(dependencies.translate).toHaveBeenCalledWith(card.word);
    expect(dependencies.save).toHaveBeenCalledWith(card.id, card.captureKey, expect.objectContaining({ meaningSource: 'browser' }));
  });
  it('respects existing results and deliberate manual empty fields without requesting translations', async () => {
    const current: WordCard = { ...card, meaning: '', meaningSource: 'manual', sentenceTranslation: '', sentenceTranslationSource: 'manual' };
    const { observer, dependencies } = setup(current);
    await startWordEnrichment(current, observer, dependencies).finished;
    expect(dependencies.dictionary).not.toHaveBeenCalled(); expect(dependencies.translate).not.toHaveBeenCalled(); expect(dependencies.save).not.toHaveBeenCalled();
  });
  it('does not save or announce late results after leaving a card', async () => {
    const definition = deferred<string | null>(); const translation = deferred<string>();
    const { observer, dependencies } = setup();
    dependencies.dictionary.mockReturnValue(definition.promise); dependencies.translate.mockReturnValue(translation.promise);
    const task = startWordEnrichment(card, observer, dependencies); task.cancel();
    const phaseCalls = observer.onPhase.mock.calls.length;
    definition.resolve('可预测的'); translation.resolve('这个流程是可预测的。'); await task.finished;
    expect(dependencies.save).not.toHaveBeenCalled(); expect(observer.onSaved).not.toHaveBeenCalled(); expect(observer.onPhase).toHaveBeenCalledTimes(phaseCalls);
  });
  it('keeps the dictionary result when sentence translation needs one-time activation', async () => {
    const { observer, dependencies } = setup(); dependencies.translate.mockRejectedValue({ code: 'setup-required' });
    await startWordEnrichment(card, observer, dependencies).finished;
    expect(observer.onPhase).toHaveBeenCalledWith('sentence', 'setup');
    expect(observer.onPhase).toHaveBeenCalledWith('meaning', 'ready'); expect(observer.onSaved).toHaveBeenCalledTimes(1);
  });
  it('does not present a deleted-card save failure as completed enrichment', async () => {
    const { observer, dependencies } = setup(); dependencies.save.mockRejectedValue(new Error('deleted'));
    await startWordEnrichment(card, observer, dependencies).finished;
    expect(observer.onSaved).not.toHaveBeenCalled(); expect(observer.onPhase).toHaveBeenCalledWith('meaning', 'failed'); expect(observer.onPhase).toHaveBeenCalledWith('sentence', 'failed');
  });
  it('rejects empty translator output instead of saving an apparently complete empty translation', async () => {
    const { observer, dependencies } = setup(); dependencies.translate.mockResolvedValue(' ');
    await startWordEnrichment(card, observer, dependencies).finished;
    expect(observer.onPhase).toHaveBeenCalledWith('sentence', 'failed'); expect(dependencies.save).toHaveBeenCalledTimes(1);
  });
});
