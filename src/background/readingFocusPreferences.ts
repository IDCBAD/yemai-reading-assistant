import { normalizeReadingFocusPreferences, type ReadingFocusPreferences } from '../shared/readingFocusPreferences';
import type { PageReadingSender } from './pageReadingRuntime';

interface Dependencies {
  extensionId: string;
  load(): Promise<unknown>;
  save(value: ReadingFocusPreferences): Promise<void>;
}

/** A narrow preferences bridge; content scripts cannot read the trusted local storage area. */
export function createReadingFocusPreferencesHandler(deps: Dependencies) {
  return (message: unknown, sender: PageReadingSender, respond: (value: unknown) => void) => {
    if (!message || typeof message !== 'object') return false;
    const request = message as Record<string, unknown>;
    if (!['reading-focus:preferences-get', 'reading-focus:preferences-set'].includes(String(request.type))) return false;
    if (sender.id !== deps.extensionId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || sender.tab!.id! < 0 || !/^https?:\/\//i.test(sender.url ?? '')) {
      respond({ ok: false, error: '阅读设置只能由当前网页中的扩展修改。' }); return false;
    }
    void (async () => {
      if (request.type === 'reading-focus:preferences-get') return normalizeReadingFocusPreferences(await deps.load());
      const value = normalizeReadingFocusPreferences(request.preferences);
      await deps.save(value);
      return value;
    })().then(preferences => respond({ ok: true, preferences }), () => respond({ ok: false, error: '阅读设置未能保存或读取，请重试。' }));
    return true;
  };
}
