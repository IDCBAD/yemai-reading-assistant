import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { PageSnapshot } from '../shared/extensionMessages';
import type { PageContext } from '../sidepanel/types';

export const MAX_PAGE_MARKDOWN_LENGTH = 40_000;

function getSiteName() {
  const declared = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content.trim();
  return declared || window.location.hostname.replace(/^www\./, '');
}

export function getPageMetadata(): PageContext {
  return {
    title: document.title.trim() || window.location.hostname,
    site: getSiteName(),
    url: window.location.href,
    status: 'not-read',
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeMarkdown(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export async function extractPageSnapshot(): Promise<PageSnapshot> {
  const metadata = getPageMetadata();
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll('script, style, noscript, iframe, nav, form').forEach((element) => element.remove());

  let markdown = '';
  let quality: PageSnapshot['quality'] = 'fallback';
  try {
    const article = new Readability(clone, { charThreshold: 180 }).parse();
    const articleText = article?.textContent?.trim() ?? '';
    if (article?.content && articleText.length >= 180) {
      const turndown = new TurndownService({
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
      });
      turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'img']);
      markdown = normalizeMarkdown(turndown.turndown(article.content));
      quality = articleText.length >= 500 ? 'high' : 'partial';
    }
  } catch {
    // Readability is best-effort; the visible-text fallback below remains available.
  }

  if (!markdown) {
    markdown = normalizeMarkdown(document.body?.innerText ?? '');
    quality = 'fallback';
  }
  if (!markdown) throw new Error('当前页面没有可读取的正文。');

  const truncated = markdown.length > MAX_PAGE_MARKDOWN_LENGTH;
  const boundedMarkdown = truncated ? `${markdown.slice(0, MAX_PAGE_MARKDOWN_LENGTH)}\n\n[页面内容已截断]` : markdown;
  const contentHash = await sha256(markdown);
  const pageId = (await sha256(metadata.url)).slice(0, 20);
  return {
    ...metadata,
    status: 'read',
    pageId,
    markdown: boundedMarkdown,
    contentHash,
    extractedAt: Date.now(),
    quality,
    truncated,
  };
}
