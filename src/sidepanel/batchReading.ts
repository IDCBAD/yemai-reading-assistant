import type { ContextItem, LinkContextItem } from './types';

export const MAX_BATCH_LINKS = 5;
export const DEFAULT_BATCH_QUESTION = '分别提炼核心内容，再说明这些材料之间的联系。';

export function safeReadingUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2_000) return;
    return url.href;
  } catch { return; }
}

export function parseReadingLinks(input: string) {
  const links: Array<{ title: string; url: string; site: string }> = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let invalid = 0;
  for (const line of input.split(/\r?\n/).filter((value) => value.trim())) {
    const candidates = line.match(/https?:\/\/[^\s<>"'，。；、]+/gi) ?? [];
    if (!candidates.length) { invalid++; continue; }
    for (let candidate of candidates) {
      candidate = candidate.replace(/[）】\]]+$/, '');
      while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length ?? 0) > (candidate.match(/\(/g)?.length ?? 0)) candidate = candidate.slice(0, -1);
      const url = safeReadingUrl(candidate);
      if (!url) { invalid++; continue; }
      if (seen.has(url)) { duplicates++; continue; }
      seen.add(url);
      const parsed = new URL(url);
      links.push({ title: `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 160), url, site: parsed.hostname });
    }
  }
  return { links, duplicates, invalid };
}

export function contextLinks(items: ContextItem[]): LinkContextItem[] {
  return items.filter((item): item is LinkContextItem => item.kind === 'link' && item.included && item.status === 'ready' && Boolean(safeReadingUrl(item.link.url)));
}

/** Adding links changes only the draft; page inclusion is an explicit choice afterwards. */
export function addReadingLinks(items: ContextItem[], incoming: Array<LinkContextItem['link']>, now = Date.now()) {
  const existing = items.filter((item): item is LinkContextItem => item.kind === 'link');
  const urls = new Set(existing.map((item) => safeReadingUrl(item.link.url)));
  const added: LinkContextItem[] = [];
  for (const link of incoming) {
    const url = safeReadingUrl(link.url);
    if (!url || urls.has(url)) continue;
    urls.add(url);
    added.push({ id: `context-link-${crypto.randomUUID()}`, kind: 'link', included: true, status: 'ready', createdAt: now,
      link: { ...link, title: link.title.trim().slice(0, 160) || new URL(url).hostname, url } });
  }
  if (existing.length + added.length > MAX_BATCH_LINKS) return { items, added: 0, error: `每组最多 ${MAX_BATCH_LINKS} 个网页，请减少选择。` };
  return { items: added.length ? [...items.map((item) => item.kind === 'page' && item.role === 'current' ? { ...item, included: false } : item), ...added] : items,
    added: added.length, error: undefined };
}
