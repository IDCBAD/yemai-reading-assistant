interface LocalTranslator {
  translate(input: string): Promise<string>;
}

interface TranslatorDownloadEvent extends Event {
  loaded: number;
}

interface LocalTranslatorFactory {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: {
      addEventListener(type: 'downloadprogress', listener: (event: TranslatorDownloadEvent) => void): void;
    }) => void;
  }): Promise<LocalTranslator>;
}

const LANGUAGE_PAIR = { sourceLanguage: 'en', targetLanguage: 'zh' } as const;
let translatorPromise: Promise<LocalTranslator> | null = null;

export class LocalTranslationError extends Error {
  constructor(public readonly code: 'setup-required' | 'unavailable', message: string) { super(message); }
}

function translatorFactory(): LocalTranslatorFactory | undefined {
  return (globalThis as typeof globalThis & { Translator?: LocalTranslatorFactory }).Translator;
}

export function canTranslateLocally(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && value.length <= 240 && /[a-z]/i.test(value) && !/^https?:\/\//i.test(value);
}

export async function localTranslationAvailability(): Promise<string> {
  const factory = translatorFactory();
  if (!factory) return 'unavailable';
  try {
    return await factory.availability(LANGUAGE_PAIR);
  } catch {
    return 'unavailable';
  }
}

// Reset the deadline on actual download progress, rather than limiting total download time.
const PREPARATION_STALL_MS = 75_000;
function getTranslator(onDownloadProgress?: (progress: number) => void): Promise<LocalTranslator> {
  const factory = translatorFactory();
  if (!factory) return Promise.reject(new LocalTranslationError('unavailable', '当前浏览器不支持本地翻译。'));
  if (!translatorPromise) {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    let rejectStalled: (error: Error) => void;
    const stalled = new Promise<never>((_, reject) => { rejectStalled = reject; });
    const resetDeadline = () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => rejectStalled(new Error('翻译准备长时间没有进展，请重试。')), PREPARATION_STALL_MS);
    };
    resetDeadline();
    let creation: Promise<LocalTranslator>;
    try {
      // Keep native creation synchronous with the click to retain user activation.
      creation = factory.create({
        ...LANGUAGE_PAIR,
        monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => {
          resetDeadline();
          onDownloadProgress?.(Math.round(event.loaded * 100));
        }),
      });
    } catch (error) { creation = Promise.reject(error); }
    translatorPromise = Promise.race([creation, stalled])
      .finally(() => { settled = true; clearTimeout(timer); })
      .catch((error: unknown) => { translatorPromise = null; throw error; });
  }
  return translatorPromise;
}

export function translateLocally(text: string, onDownloadProgress?: (progress: number) => void): Promise<string> {
  return getTranslator(onDownloadProgress).then((translator) => translator.translate(text));
}

/** Call directly from a click when Chrome needs permission to prepare the language pack. */
export function initializeLocalTranslation(onDownloadProgress?: (progress: number) => void): Promise<void> {
  return getTranslator(onDownloadProgress).then(() => undefined);
}

/** Automatic enrichment must not start a language-pack download without a click. */
export async function translateLocallyWhenReady(text: string): Promise<string> {
  if (!translatorPromise) {
    const status = await localTranslationAvailability();
    if (status === 'unavailable') throw new LocalTranslationError('unavailable', '当前浏览器不支持本地翻译。');
    if (status !== 'available') throw new LocalTranslationError('setup-required', '请先启用本地翻译。');
  }
  try { return await translateLocally(text); }
  catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') throw new LocalTranslationError('setup-required', '请先启用本地翻译。');
    throw error;
  }
}
