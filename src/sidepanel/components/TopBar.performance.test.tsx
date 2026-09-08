import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';

const handlers = {
  onOpenSearch: () => undefined,
  onPrepareSearch: () => undefined,
  onOpenReadingCards: () => undefined,
  onPrepareReadingCards: () => undefined,
  onOpenSettings: () => undefined,
  onPrepareSettings: () => undefined,
};

describe('TopBar surface preparation feedback', () => {
  it('acknowledges search preparation without opening an intermediate panel', () => {
    const html = renderToStaticMarkup(<TopBar {...handlers} searchPreparing />);

    expect(html).toContain('aria-label="正在准备搜索"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('is-preparing');
  });

  it('keeps the collection trigger pressed while its final surface is prepared', () => {
    const html = renderToStaticMarkup(<TopBar {...handlers} readingCardsPreparing />);

    expect(html).toContain('aria-label="正在准备收藏"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-busy="true"');
  });
});
