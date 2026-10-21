// Local preview only: this origin's IndexedDB is separate from the extension.
import { saveWordCardCapture, updateWordCardMeaning, updateWordCardSentenceTranslation, enrichWordCard, removeWordCard, restoreWordCard } from '../../src/services/wordCardStorage';
import type { ExtensionEvent, ExtensionRequest } from '../../src/shared/extensionMessages';
import { WORD_COLLECTION_ENABLED_KEY } from '../../src/shared/wordCards';

type Listener = (message: { type?: string }) => unknown;
const listeners = new Set<Listener>();
export const previewControls = { saveFailure: false, importInProgress: false, quoteCount: 0 };
export function announceWordChange() { for (const listener of listeners) listener({ type: 'wordcards:changed' }); }
type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type StorageListener = (changes: StorageChanges, area: string) => void;
const storageListeners = new Set<StorageListener>();
function announceStorageChanges(changes: StorageChanges) {
  for (const listener of storageListeners) listener(changes, 'local');
}
const storage = {
  async get(keys?: string | string[] | null) {
    const values = JSON.parse(localStorage.getItem('word-collection-preview-settings') || '{}');
    if (keys == null) return values;
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]));
  },
  async set(patch: Record<string, unknown>) {
    const current = await storage.get();
    localStorage.setItem('word-collection-preview-settings', JSON.stringify({ ...current, ...patch }));
    announceStorageChanges(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: current[key], newValue }])));
  },
  async remove(keys: string | string[]) {
    const values = await storage.get();
    const changes: StorageChanges = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) { changes[key] = { oldValue: values[key] }; delete values[key]; }
    localStorage.setItem('word-collection-preview-settings', JSON.stringify(values));
    announceStorageChanges(changes);
  },
};

export const browser = {
  runtime: {
    onMessage: { addListener(listener: Listener) { listeners.add(listener); }, removeListener(listener: Listener) { listeners.delete(listener); } },
    getManifest: () => ({ version: '0.6.1-preview' }),
    getURL: (path: string) => `/${path.replace(/^\/+/, '')}`,
    async sendMessage(request: ExtensionRequest | ExtensionEvent) {
      if (request.type === 'panel:status') return {
        open: true, bubbleEnabled: true,
        wordCollectionEnabled: (await storage.get(WORD_COLLECTION_ENABLED_KEY))[WORD_COLLECTION_ENABLED_KEY] !== false,
      };
      if (request.type === 'selection:commit') {
        previewControls.quoteCount++;
        for (const listener of listeners) listener({ type: 'preview:quote-count' });
        return { ok: true };
      }
      if (request.type === 'page:changed') return { ok: true };
      if (previewControls.importInProgress) return { ok: false, error: '正在导入备份，请稍后再收藏或修改单词。（模拟）' };
      if (previewControls.saveFailure) return { ok: false, error: '模拟保存失败：未写入本地数据库，请关闭失败开关后重试。' };
      try {
        let response;
        switch (request.type) {
          case 'word:save': response = { ok: true, ...await saveWordCardCapture(request.capture) }; break;
          case 'word:update-meaning': response = { ok: true, card: await updateWordCardMeaning(request.id, request.meaning, request.meaningSource, request.expectedUpdatedAt, request.expectedField) }; break;
          case 'word:update-sentence-translation': response = { ok: true, card: await updateWordCardSentenceTranslation(request.id, request.translation, request.expectedUpdatedAt, request.expectedField) }; break;
          case 'word:enrich': response = { ok: true, card: await enrichWordCard(request.id, request.captureKey, request.patch) }; break;
          case 'word:remove': await removeWordCard(request.id); response = { ok: true }; break;
          case 'word:restore': response = { ok: true, card: await restoreWordCard(request.card) }; break;
          default: return { ok: false, error: '验证页未实现此消息。' };
        }
        announceWordChange();
        return response;
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '保存失败' }; }
    },
  },
  storage: { local: storage, session: storage, onChanged: {
    addListener(listener: StorageListener) { storageListeners.add(listener); },
    removeListener(listener: StorageListener) { storageListeners.delete(listener); },
  } },
};
