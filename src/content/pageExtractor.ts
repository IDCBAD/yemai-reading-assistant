import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import {
  buildPageManifest,
  createStableSourceId,
  inferAccessHint,
  inferPageType,
  normalizeSourceUrl,
  type PageManifestInput,
} from './pageManifest';
import type { PageSnapshot } from '../shared/extensionMessages';
import type { PageContext } from '../sidepanel/types';

export const MAX_PAGE_MARKDOWN_LENGTH = 40_000;

function getSiteName() {
  const declared = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content.trim();
  return declared || window.location.hostname.replace(/^www\./, '');
}

function getPageDescription() {
  return document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content.trim()
    || document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content.trim()
    || undefined;
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

function headingCandidates(root: ParentNode): NonNullable<PageManifestInput['headings']> {
  return [...root.querySelectorAll('h1, h2, h3')].map((heading) => ({
    level: Number(heading.tagName.slice(1)) as 1 | 2 | 3,
    text: heading.textContent ?? '',
  }));
}

function linkRelation(anchor: HTMLAnchorElement): NonNullable<PageManifestInput['links']>[number]['relation'] {
  const declared = anchor.rel.toLowerCase().split(/\s+/u);
  if (declared.includes('next')) return 'next';
  if (declared.includes('prev') || declared.includes('previous')) return 'previous';
  const label = `${anchor.textContent ?? ''} ${anchor.getAttribute('aria-label') ?? ''}`.trim();
  if (/(?:第\s*\d+\s*章|chapter|module|章节)/iu.test(label)) return 'chapter';
  return 'reference';
}

function linkCandidates(root: ParentNode, baseUrl: string): NonNullable<PageManifestInput['links']> {
  const links: NonNullable<PageManifestInput['links']> = [];
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    try {
      const url = new URL(anchor.getAttribute('href') ?? '', baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      links.push({
        title: anchor.textContent ?? anchor.getAttribute('aria-label') ?? '',
        url: url.toString(),
        relation: linkRelation(anchor),
      });
    } catch {
      // Ignore malformed links; the page itself remains readable.
    }
  });
  return links;
}

export async function extractPageSnapshot(): Promise<PageSnapshot> {
  const metadata = getPageMetadata();
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll('script, style, noscript, iframe, nav, form').forEach((element) => element.remove());

  let markdown = '';
  let mainText = '';
  let manifestRoot: ParentNode = clone;
  let hasArticle = false;
  let description = getPageDescription();
  let quality: PageSnapshot['quality'] = 'fallback';
  try {
    const article = new Readability(clone, { charThreshold: 180 }).parse();
    const articleText = article?.textContent?.trim() ?? '';
    if (article?.content && articleText.length >= 180) {
      const articleDocument = new DOMParser().parseFromString(article.content, 'text/html');
      const turndown = new TurndownService({
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
      });
      turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'img']);
      markdown = normalizeMarkdown(turndown.turndown(article.content));
      mainText = articleText;
      manifestRoot = articleDocument.body;
      hasArticle = true;
      description = article.excerpt?.trim() || description;
      quality = articleText.length >= 500 ? 'high' : 'partial';
    }
  } catch {
    // Readability is best-effort; the visible-text fallback below remains available.
  }

  if (!markdown) {
    mainText = document.body?.innerText ?? '';
    markdown = normalizeMarkdown(mainText);
    manifestRoot = document.body ?? document;
    quality = 'fallback';
  }
  if (!markdown) throw new Error('当前页面没有可读取的正文。');

  const truncated = markdown.length > MAX_PAGE_MARKDOWN_LENGTH;
  const boundedMarkdown = truncated ? `${markdown.slice(0, MAX_PAGE_MARKDOWN_LENGTH)}\n\n[页面内容已截断]` : markdown;
  const contentHash = await sha256(markdown);
  const normalizedUrl = normalizeSourceUrl(metadata.url);
  const pageId = (await sha256(normalizedUrl)).slice(0, 20);
  const sourceId = createStableSourceId(normalizedUrl);
  const manifestInput: PageManifestInput = {
    title: metadata.title,
    url: metadata.url,
    description,
    headings: headingCandidates(manifestRoot),
    leadingText: mainText,
    links: linkCandidates(manifestRoot, metadata.url),
    hasArticle,
    mainTextLength: mainText.length,
    truncated,
  };
  const manifest = buildPageManifest(manifestInput);
  return {
    ...metadata,
    status: 'read',
    pageId,
    sourceId,
    markdown: boundedMarkdown,
    contentHash,
    pageType: inferPageType(manifestInput),
    accessHint: inferAccessHint(metadata.url),
    manifest,
    extractedAt: Date.now(),
    quality,
    truncated,
  };
}
