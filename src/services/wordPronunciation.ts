import { browser } from 'wxt/browser';

const DICTIONARY_PATH = '/dictionaries/en-US-ipa.txt';
const LOAD_TIMEOUT_MS = 5_000;
let dictionaryPromise: Promise<string> | null = null;

function normalizeLookupWord(word: string): string {
  return word.trim().toLowerCase().replace(/[‘’]/g, "'");
}

/** Parse ipa-dict's tab-separated entries without changing their IPA notation. */
export function parseWordPronunciationDictionary(text: string): Map<string, string> {
  const entries = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('\t');
    if (separator < 1) continue;
    const word = normalizeLookupWord(line.slice(0, separator));
    const pronunciation = line.slice(separator + 1).trim();
    if (!word || !pronunciation.startsWith('/') || !pronunciation.endsWith('/')) continue;
    let variants = entries.get(word);
    if (!variants) { variants = new Set(); entries.set(word, variants); }
    variants.add(pronunciation);
  }
  return new Map(Array.from(entries, ([word, variants]) => [word, Array.from(variants).join(', ')]));
}

function loadDictionary(): Promise<string> {
  if (dictionaryPromise) return dictionaryPromise;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Pronunciation dictionary load timed out.'));
    }, LOAD_TIMEOUT_MS);
  });
  const load = async () => {
    const response = await fetch(browser.runtime.getURL(DICTIONARY_PATH), {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Pronunciation dictionary is unavailable.');
    const text = await response.text();
    // Check that this is dictionary text, without allocating 100,000+ entries
    // while the collection surface is opening.
    if (!/^[^\t\r\n]+\t\/[^\r\n]*\/[ \t]*\r?$/m.test(text)) {
      throw new Error('Pronunciation dictionary has no valid entries.');
    }
    return text;
  };
  dictionaryPromise = Promise.race([load(), timeout])
    .finally(() => clearTimeout(timer))
    .catch((error: unknown) => { dictionaryPromise = null; throw error; });
  return dictionaryPromise;
}

function findWordPronunciation(text: string, word: string): string | null {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['‘’]");
  const linePattern = new RegExp(`^${escaped}\\t([^\\r\\n]*)\\r?$`, 'gimu');
  const variants = new Set<string>();
  for (const match of text.matchAll(linePattern)) {
    const pronunciation = match[1]?.trim();
    if (pronunciation?.startsWith('/') && pronunciation.endsWith('/')) variants.add(pronunciation);
  }
  return variants.size ? Array.from(variants).join(', ') : null;
}

/** Exact lookup in the packaged US dictionary; unavailable or missing entries return null. */
export async function lookupWordPronunciation(word: string): Promise<string | null> {
  const normalized = normalizeLookupWord(word);
  if (!normalized || /[\r\n\t]/.test(normalized)) return null;
  try {
    return findWordPronunciation(await loadDictionary(), normalized);
  } catch {
    return null;
  }
}
