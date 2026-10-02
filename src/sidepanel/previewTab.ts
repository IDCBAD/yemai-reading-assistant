import { artifactPreviewKind, safeArtifactUrl } from './artifactPreview';
import type { AssistantArtifact } from './types';

const PREFIX = 'artifact-preview:';
interface PreviewRecord { artifact: AssistantArtifact; expiresAt: number }

function validRecord(value: unknown): value is PreviewRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as PreviewRecord;
  return typeof record.expiresAt === 'number' && record.expiresAt > Date.now()
    && typeof record.artifact?.filename === 'string' && record.artifact.status === 'available'
    && Boolean(safeArtifactUrl(record.artifact.url)) && Boolean(artifactPreviewKind(record.artifact));
}

/** The address contains a random ID, never the signed file URL. */
export async function openPreviewTab(artifact: AssistantArtifact) {
  const key = `${PREFIX}${crypto.randomUUID()}`;
  const record: PreviewRecord = { artifact, expiresAt: Date.now() + 60 * 60 * 1000 };
  if (location.protocol === 'chrome-extension:') {
    const { browser } = await import('wxt/browser');
    const stored = await browser.storage.session.get(null);
    const stale = Object.keys(stored).filter((name) => name.startsWith(PREFIX) && !validRecord(stored[name]));
    if (stale.length) await browser.storage.session.remove(stale);
    await browser.storage.session.set({ [key]: record });
    try { await browser.tabs.create({ url: `${browser.runtime.getURL('/artifact-preview.html')}#${key}` }); }
    catch (error) { await browser.storage.session.remove(key); throw error; }
  } else if (import.meta.env.DEV) {
    localStorage.setItem(key, JSON.stringify(record));
    const tab = window.open(`/artifact-preview.html#${key}`, '_blank');
    if (!tab) { localStorage.removeItem(key); throw new Error('浏览器阻止了新标签页，请允许后重试。'); }
    tab.opener = null;
  }
}

export async function readPreviewTab(): Promise<AssistantArtifact | null> {
  const key = location.hash.slice(1);
  if (!/^artifact-preview:[a-f0-9-]{36}$/.test(key)) return null;
  let record: unknown;
  const cached = sessionStorage.getItem(key);
  if (cached) { try { record = JSON.parse(cached); } catch { return null; } }
  else if (location.protocol === 'chrome-extension:') {
    const { browser } = await import('wxt/browser');
    record = (await browser.storage.session.get(key))[key];
    await browser.storage.session.remove(key);
  } else if (import.meta.env.DEV) {
    try { record = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
    localStorage.removeItem(key);
  }
  if (!validRecord(record)) { sessionStorage.removeItem(key); return null; }
  sessionStorage.setItem(key, JSON.stringify(record));
  return record.artifact;
}
