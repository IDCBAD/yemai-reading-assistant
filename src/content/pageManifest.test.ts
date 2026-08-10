import { describe, expect, it } from 'vitest';
import { buildPageManifest, inferPageType, normalizeSourceUrl, PAGE_MANIFEST_LIMITS } from './pageManifest';

describe('page manifest', () => {
  it('removes known tracking parameters without collapsing meaningful routes', () => {
    expect(normalizeSourceUrl('https://example.com/article?id=12&utm_source=test#part')).toBe(
      'https://example.com/article?id=12#part',
    );
    expect(normalizeSourceUrl('https://example.com/#/article/12')).toBe('https://example.com/#/article/12');
    expect(normalizeSourceUrl('https://example.com/a#:~:text=hello')).toBe('https://example.com/a');
  });

  it('builds a bounded, deduplicated manifest', () => {
    const headings = Array.from({ length: 20 }, (_, index) => ({
      level: 2 as const,
      text: ` Chapter ${index + 1} `,
    }));
    const links = Array.from({ length: 14 }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      url: `https://example.com/chapter/${index + 1}?utm_medium=test`,
      relation: 'chapter' as const,
    }));
    const manifest = buildPageManifest({
      title: 'Book',
      url: 'https://example.com/',
      description: 'a'.repeat(500),
      leadingText: 'b'.repeat(1_000),
      headings,
      links,
    });

    expect(manifest.description?.length).toBe(PAGE_MANIFEST_LIMITS.description);
    expect(manifest.leading_excerpt?.length).toBe(PAGE_MANIFEST_LIMITS.leadingExcerpt);
    expect(manifest.outline).toHaveLength(PAGE_MANIFEST_LIMITS.outline);
    expect(manifest.relevant_links).toHaveLength(PAGE_MANIFEST_LIMITS.relevantLinks);
    expect(manifest.relevant_links[0]?.url).toBe('https://example.com/chapter/1');
    expect(manifest.truncated).toBe(true);
  });

  it('uses conservative deterministic page type rules', () => {
    expect(inferPageType({ title: 'Docs', url: 'https://example.com/docs/start' })).toBe('documentation');
    expect(inferPageType({ title: 'Search', url: 'https://example.com/?q=agent' })).toBe('search');
    expect(inferPageType({ title: 'Post', url: 'https://example.com/post', hasArticle: true })).toBe('article');
  });
});
