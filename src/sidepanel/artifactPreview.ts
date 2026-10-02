import { getFileType } from './fileTypes';
import type { AssistantArtifact } from './types';

export type PreviewKind = 'image' | 'markdown' | 'html' | 'spreadsheet' | 'csv' | 'json' | 'text';
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const TEXT_PAGE_SIZE = 20_000;

export function safeArtifactUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function artifactPreviewKind(artifact: Pick<AssistantArtifact, 'filename' | 'mime'>): PreviewKind | undefined {
  const kind = getFileType(artifact.filename, artifact.mime).kind;
  return ['image', 'markdown', 'html', 'spreadsheet', 'csv', 'json', 'text'].includes(kind)
    ? kind as PreviewKind : undefined;
}

/** Reads a bounded body, even when Content-Length is missing or misleading. */
export async function readPreviewBytes(response: Response, limit: number, signal: AbortSignal) {
  if (!response.ok) throw new Error(response.status === 403 || response.status === 404
    ? '文件链接已失效或无权访问，可以尝试下载。' : '文件读取失败，请重试。');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('文件过大，请下载后查看。');
  }
  if (!response.body) throw new Error('未能读取文件内容，请下载后查看。');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error('文件过大，请下载后查看。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function decodePreviewText(bytes: Uint8Array, contentType = '') {
  const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset, { fatal: true }).decode(bytes); }
  catch { throw new Error('无法识别文本编码，请下载后查看。'); }
}

export function formatPreviewJson(text: string) {
  try { return { text: JSON.stringify(JSON.parse(text), null, 2), valid: true }; }
  catch { return { text, valid: false }; }
}

/** Defense in depth: no scripts, navigation or embedded pages. */
export function staticReportDocument(source: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('script, iframe, frame, frameset, object, embed, base, link, meta[http-equiv], template').forEach((node) => node.remove());
  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'action', 'formaction', 'href', 'xlink:href', 'srcset', 'target', 'ping', 'autofocus'].includes(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.hasAttribute('src')) {
      const original = element.getAttribute('src')!;
      try {
        const url = new URL(original, sourceUrl);
        if (url.protocol === 'https:' && !url.username && !url.password
          || element.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(original)) {
          element.setAttribute('src', url.href);
        } else { element.removeAttribute('src'); }
      } catch { element.removeAttribute('src'); }
    }
    if (element.tagName === 'IMG') element.setAttribute('referrerpolicy', 'no-referrer');
  });
  doc.querySelectorAll('input, button, select, textarea').forEach((element) => element.setAttribute('disabled', ''));
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer'; referrer.content = 'no-referrer';
  doc.head.prepend(policy, referrer);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export interface ImageView { scale: number; x: number; y: number }
export function fitImageScale(width: number, height: number, viewWidth: number, viewHeight: number) {
  return Math.min(1, Math.max(1, viewWidth - 32) / width, Math.max(1, viewHeight - 32) / height);
}
export function clampImageView(view: ImageView, width: number, height: number, viewWidth: number, viewHeight: number): ImageView {
  const maxX = Math.max(0, (width * view.scale - viewWidth) / 2 + 16);
  const maxY = Math.max(0, (height * view.scale - viewHeight) / 2 + 16);
  return { ...view, x: maxX ? Math.min(maxX, Math.max(-maxX, view.x)) : 0, y: maxY ? Math.min(maxY, Math.max(-maxY, view.y)) : 0 };
}
export function zoomImageView(view: ImageView, scale: number, x = 0, y = 0): ImageView {
  const ratio = scale / view.scale;
  return { scale, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
