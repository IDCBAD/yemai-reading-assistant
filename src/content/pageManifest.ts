import type {
  PageManifest,
  PageManifestHeading,
  PageManifestLink,
  YuemaiPageType,
} from '../shared/yuemaiContext';

export const PAGE_MANIFEST_LIMITS = {
  description: 300,
  outline: 12,
  leadingExcerpt: 800,
  relevantLinks: 10,
} as const;

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

export interface PageManifestInput {
  title: string;
  url: string;
  description?: string;
  headings?: PageManifestHeading[];
  leadingText?: string;
  links?: Array<Partial<Pick<PageManifestLink, 'relation'>> & Pick<PageManifestLink, 'title' | 'url'>>;
  hasArticle?: boolean;
  mainTextLength?: number;
  truncated?: boolean;
}

function compactInline(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function boundedText(value: string | undefined, maximum: number) {
  if (!value) return { value: undefined, truncated: false };
  const compact = compactInline(value);
  if (!compact) return { value: undefined, truncated: false };
  if (compact.length <= maximum) return { value: compact, truncated: false };
  return { value: `${compact.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`, truncated: true };
}

export function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith('utm_') || TRACKING_PARAMETERS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }

    const textFragmentIndex = url.hash.indexOf(':~:text=');
    if (textFragmentIndex >= 0) {
      const remainingHash = url.hash.slice(0, textFragmentIndex);
      url.hash = remainingHash === '#' ? '' : remainingHash;
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function inferPageType(input: PageManifestInput): YuemaiPageType {
  let url: URL | null = null;
  try {
    url = new URL(input.url);
  } catch {
    // Invalid or browser-only URLs remain unknown.
  }

  const path = url?.pathname.toLowerCase() ?? '';
  const host = url?.hostname.toLowerCase() ?? '';
  const queryKeys = new Set([...(url?.searchParams.keys() ?? [])].map((key) => key.toLowerCase()));

  if (/\/(?:search|results?)(?:\/|$)/u.test(path) || ['q', 'query', 'keyword'].some((key) => queryKeys.has(key))) {
    return 'search';
  }
  if (/\/(?:issues?|discussions?|threads?|forum|community)(?:\/|$)/u.test(path)
    || host.includes('reddit.com') || host.includes('stackoverflow.com')) {
    return 'discussion';
  }
  if (/\/(?:docs?|documentation|guide|manual|reference|book|modules?|chapters?|api)(?:\/|$)/u.test(path)) {
    return 'documentation';
  }
  if (input.hasArticle || (input.mainTextLength ?? 0) >= 1_000) return 'article';
  if ((input.links?.length ?? 0) >= 8 && (input.mainTextLength ?? 0) < 1_000) return 'index';
  if ((input.mainTextLength ?? 0) > 0) return 'application';
  return 'unknown';
}

export function buildPageManifest(input: PageManifestInput): PageManifest {
  const description = boundedText(input.description, PAGE_MANIFEST_LIMITS.description);
  const leadingExcerpt = boundedText(input.leadingText, PAGE_MANIFEST_LIMITS.leadingExcerpt);
  let truncated = Boolean(input.truncated || description.truncated || leadingExcerpt.truncated);

  const outline: PageManifestHeading[] = [];
  const seenHeadings = new Set<string>();
  for (const heading of input.headings ?? []) {
    const text = compactInline(heading.text);
    const level = heading.level;
    if (!text || ![1, 2, 3].includes(level) || seenHeadings.has(`${level}:${text}`)) continue;
    if (outline.length >= PAGE_MANIFEST_LIMITS.outline) {
      truncated = true;
      break;
    }
    seenHeadings.add(`${level}:${text}`);
    outline.push({ level, text });
  }

  const relevantLinks: PageManifestLink[] = [];
  const seenLinks = new Set<string>();
  const sourceUrl = normalizeSourceUrl(input.url);
  for (const link of input.links ?? []) {
    const title = compactInline(link.title);
    const url = normalizeSourceUrl(link.url);
    if (!title || !url || url === sourceUrl || seenLinks.has(url)) continue;
    if (relevantLinks.length >= PAGE_MANIFEST_LIMITS.relevantLinks) {
      truncated = true;
      break;
    }
    seenLinks.add(url);
    relevantLinks.push({
      title,
      url,
      relation: link.relation ?? 'unknown',
    });
  }

  return {
    ...(description.value ? { description: description.value } : {}),
    outline,
    ...(leadingExcerpt.value ? { leading_excerpt: leadingExcerpt.value } : {}),
    relevant_links: relevantLinks,
    truncated,
  };
}
