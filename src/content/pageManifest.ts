import type {
  PageManifest,
  PageManifestHeading,
  PageManifestLink,
  YemaiAccessHint,
  YemaiPageType,
} from '../shared/yemaiContext';

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

/**
 * Normalizes a URL for document identity rather than navigation position.
 * Ordinary fragments point into one document, while #/ and #!/ commonly
 * represent distinct routes in hash-based applications and must be retained.
 */
export function normalizeSourceIdentityUrl(value: string) {
  const normalized = normalizeSourceUrl(value);
  try {
    const url = new URL(normalized);
    if (url.hash && !url.hash.startsWith('#/') && !url.hash.startsWith('#!/')) {
      url.hash = '';
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

export function createStableSourceId(value: string) {
  const normalized = normalizeSourceIdentityUrl(value);
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `src_${(second >>> 0).toString(16).padStart(8, '0')}${(first >>> 0).toString(16).padStart(8, '0')}`;
}

export function inferAccessHint(value: string): YemaiAccessHint {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return 'local_document';
    if (!['http:', 'https:'].includes(url.protocol)) return 'browser_only';
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^10\./u.test(host)
      || /^192\.168\./u.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host);
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local') || privateIpv4) {
      return 'browser_only';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function inferPageType(input: PageManifestInput): YemaiPageType {
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
  if ((input.links?.length ?? 0) >= 8 && (input.mainTextLength ?? 0) < 5_000) return 'index';
  if (input.hasArticle || (input.mainTextLength ?? 0) >= 1_000) return 'article';
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
