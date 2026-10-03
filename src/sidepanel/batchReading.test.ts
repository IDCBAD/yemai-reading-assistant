import { describe, expect, it } from 'vitest';
import { addReadingLinks, contextLinks, parseReadingLinks } from './batchReading';
import { createContextSnapshot, pageContextItem, retainContextAfterSend, selectionContextItem, syncCurrentPageContextItem } from './contextItems';
import { buildAgentContent } from '../services/buildAgentContent';

const page = { title: '当前页', url: 'https://example.com/current', site: 'example.com', status: 'not-read' as const };
const link = (index: number) => ({ title: `材料 ${index}`, url: `https://example.com/${index}?lang=zh#part` });

describe('batch reading materials', () => {
  it('accepts numbered and Markdown links, deduplicates, and preserves query and fragment', () => {
    const result = parseReadingLinks('1. https://example.com/a?q=1#part\n[第二篇](https://example.com/b)\nhttps://example.com/a?q=1#part\n错误地址\nhttps://user:password@example.com/private');
    expect(result.links.map((item) => item.url)).toEqual(['https://example.com/a?q=1#part', 'https://example.com/b']);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(2);
    expect(parseReadingLinks('javascript:alert(1)\nfile:///private').links).toEqual([]);
  });

  it('preserves selected text, excludes the current page, and rejects overflow atomically', () => {
    const quote = selectionContextItem({ id: 'q', text: '原文', pageTitle: page.title, pageUrl: page.url, createdAt: 1 });
    const result = addReadingLinks([pageContextItem(page), quote], [link(1), link(2)], 10);
    expect(result.added).toBe(2);
    expect(result.items[0]).toMatchObject({ kind: 'page', included: false });
    expect(result.items[1]).toEqual(quote);
    const duplicate = addReadingLinks(result.items, [link(1)]);
    expect(duplicate.added).toBe(0);
    expect(duplicate.items).toBe(result.items);
    const overflow = addReadingLinks(result.items, [link(3), link(4), link(5), link(6)]);
    expect(overflow.error).toContain('最多 5');
    expect(overflow.items).toBe(result.items);
  });

  it('keeps link material for follow-up and preserves page exclusion after switching tabs', () => {
    const added = addReadingLinks([pageContextItem(page)], [link(1)], 10).items;
    const next = syncCurrentPageContextItem(added, { ...page, url: 'https://example.com/next' });
    expect(next[0]).toMatchObject({ included: false });
    expect(contextLinks(retainContextAfterSend(next))).toHaveLength(1);
    const snapshot = createContextSnapshot(added);
    const draftLink = contextLinks(added)[0]!;
    draftLink.link.title = '改名';
    draftLink.included = false;
    expect(contextLinks(snapshot)[0]?.link.title).toBe('材料 1');
  });

  it('delivers only included links with a portable reading instruction and explicit unread state', () => {
    const items = addReadingLinks([], [link(1), link(2)], 10).items;
    items[1]!.included = false;
    const rendered = buildAgentContent({ question: '比较观点', quotes: [], links: contextLinks(items) });
    expect(rendered).toContain('比较观点');
    expect(rendered).toContain('https://example.com/1?lang=zh#part');
    expect(rendered).not.toContain('https://example.com/2');
    expect(rendered).toContain('子智能体');
    expect(rendered).toContain('尚未提供正文');
    expect(rendered).not.toContain('当前页');
    expect(rendered).not.toContain('workos');
  });
});
