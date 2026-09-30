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

export function translateLocally(
  text: string,
  onDownloadProgress?: (progress: number) => void,
): Promise<string> {
  const factory = translatorFactory();
  if (!factory) return Promise.reject(new Error('unsupported'));

  // Create from the click handler so Chrome still has the required user activation.
  if (!translatorPromise) {
    translatorPromise = factory.create({
      ...LANGUAGE_PAIR,
      monitor: (monitor) => {
        monitor.addEventListener('downloadprogress', (event) => {
          onDownloadProgress?.(Math.round(event.loaded * 100));
        });
      },
    }).catch((error: unknown) => {
      translatorPromise = null;
      throw error;
    });
  }
  return translatorPromise.then((translator) => translator.translate(text));
}
