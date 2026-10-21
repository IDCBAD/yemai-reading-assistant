import type { WordCard, WordCardEnrichment } from '../shared/wordCards';
import { enrichCollectedWord } from '../services/wordCollectionClient';
import { lookupWordMeaning } from '../services/wordMeaningDictionary';
import { translateLocallyWhenReady } from './localTranslator';

export type WordEnrichmentPhase = 'idle' | 'loading' | 'ready' | 'setup' | 'unavailable' | 'failed';
export type WordEnrichmentField = 'meaning' | 'sentence';
interface EnrichmentDependencies {
  dictionary(word: string): Promise<string | null>;
  translate(text: string): Promise<string>;
  save(id: string, captureKey: string, patch: WordCardEnrichment): Promise<WordCard>;
}
interface EnrichmentObserver {
  onPhase(field: WordEnrichmentField, phase: WordEnrichmentPhase): void;
  onSaved(card: WordCard): void;
}

const translations = new Map<string, Promise<string>>();
function translateOnce(text: string): Promise<string> {
  const existing = translations.get(text);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('translation-timeout')), 30_000); });
  const task = Promise.race([translateLocallyWhenReady(text), timeout])
    .finally(() => clearTimeout(timer))
    .catch((error: unknown) => { translations.delete(text); throw error; });
  if (translations.size >= 64) translations.delete(translations.keys().next().value!);
  translations.set(text, task);
  return task;
}

function errorPhase(error: unknown): WordEnrichmentPhase {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return code === 'setup-required' ? 'setup' : code === 'unavailable' ? 'unavailable' : 'failed';
}

/** Only the visible card is enriched. Cancellation prevents late saves and UI updates. */
export function startWordEnrichment(card: WordCard, observer: EnrichmentObserver, dependencies: EnrichmentDependencies = {
  dictionary: lookupWordMeaning, translate: translateOnce, save: enrichCollectedWord,
}) {
  let active = true;
  const phase = (field: WordEnrichmentField, value: WordEnrichmentPhase) => { if (active) observer.onPhase(field, value); };
  const save = async (patch: WordCardEnrichment) => {
    if (!active) return;
    const updated = await dependencies.save(card.id, card.captureKey, patch);
    if (active) observer.onSaved(updated);
  };
  const meaning = async () => {
    if (card.meaning?.trim() || card.meaningSource === 'manual') { phase('meaning', 'ready'); return; }
    phase('meaning', 'loading');
    try {
      const definition = await dependencies.dictionary(card.word);
      if (!active) return;
      if (definition?.trim()) await save({ meaning: definition, meaningSource: 'dictionary' });
      else {
        const translated = (await dependencies.translate(card.word)).trim();
        if (!translated || translated.length > 2_000) throw new Error('empty-translation');
        await save({ meaning: translated, meaningSource: 'browser' });
      }
      phase('meaning', 'ready');
    } catch (error) { phase('meaning', errorPhase(error)); }
  };
  const sentence = async () => {
    if (!card.sentence || card.sentenceTranslation?.trim() || card.sentenceTranslationSource === 'manual') { phase('sentence', 'ready'); return; }
    phase('sentence', 'loading');
    try {
      const translated = (await dependencies.translate(card.sentence)).trim();
      if (!translated || translated.length > 4_000) throw new Error('empty-translation');
      await save({ sentenceTranslation: translated, sentenceTranslationSource: 'browser' });
      phase('sentence', 'ready');
    } catch (error) { phase('sentence', errorPhase(error)); }
  };
  const finished = Promise.all([meaning(), sentence()]).then(() => undefined);
  return { finished, cancel() { active = false; } };
}
