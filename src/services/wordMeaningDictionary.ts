import { browser } from 'wxt/browser';

const LOAD_TIMEOUT_MS = 5_000;
const WORD_PATTERN = /^[a-z]+(?:[-' ][a-z]+)*$/;
const SHARD_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'] as const;
type ShardLetter = typeof SHARD_LETTERS[number];
type Dictionary = Readonly<Record<string, string>>;
const shardPromises = new Map<string, Promise<Dictionary>>();

function normalizeLookupWord(word: string): string {
  return word.trim().toLowerCase().replace(/[‘’]/g, "'");
}

/** Validate one small local shard without constructing a second, full dictionary Map. */
export function parseWordMeaningDictionary(text: string, letter: string): Dictionary {
  const entries: unknown = JSON.parse(text);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('Meaning dictionary is invalid.');
  }
  const pairs = Object.entries(entries);
  if (!pairs.length || pairs.some(([word, meaning]) => (
    word.length > 80 || word[0] !== letter || !WORD_PATTERN.test(word)
    || typeof meaning !== 'string' || !meaning.trim() || meaning.length > 1_000
  ))) throw new Error('Meaning dictionary has invalid entries.');
  return entries as Dictionary;
}

function loadShard(letter: ShardLetter): Promise<Dictionary> {
  const existing = shardPromises.get(letter);
  if (existing) return existing;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Meaning dictionary load timed out.'));
    }, LOAD_TIMEOUT_MS);
  });
  const load = async () => {
    const url = browser.runtime.getURL(`/dictionaries/en-zh-ecdict/${letter}.json`);
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Meaning dictionary is unavailable.');
    return parseWordMeaningDictionary(await response.text(), letter);
  };
  const pending = Promise.race([load(), timeout])
    .finally(() => clearTimeout(timer))
    .catch((error: unknown) => {
      if (shardPromises.get(letter) === pending) shardPromises.delete(letter);
      throw error;
    });
  shardPromises.set(letter, pending);
  return pending;
}

/** Exact lookup of a real ECDICT translation; missing/unavailable entries return null. */
export async function lookupWordMeaning(word: string): Promise<string | null> {
  const normalized = normalizeLookupWord(word);
  if (normalized.length > 80 || !WORD_PATTERN.test(normalized)) return null;
  try {
    // WORD_PATTERN above guarantees an ASCII initial represented by a local shard.
    const entries = await loadShard(normalized[0] as ShardLetter);
    return Object.hasOwn(entries, normalized) ? entries[normalized]! : null;
  } catch {
    return null;
  }
}
