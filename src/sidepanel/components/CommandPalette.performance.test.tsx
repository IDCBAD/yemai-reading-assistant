import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSearchIndex } from '../../search/workspaceSearch';
import { INITIAL_WORKSPACE } from '../mockData';
import type { WorkspaceSearchSession } from '../searchSession';
import { CommandPalette } from './CommandPalette';

const emptyIndex: WorkspaceSearchIndex = {
  documentCount: 0,
  recent: () => [],
  search: () => [],
};

const session: WorkspaceSearchSession = {
  workspace: INITIAL_WORKSPACE,
  readingCards: [],
  initialScope: 'all',
};

describe('CommandPalette performance lifecycle', () => {
  it('commits the search input before building a cold index', async () => {
    const cache = {
      peek: vi.fn(() => null),
      getOrCreate: vi.fn(() => emptyIndex),
    };

    const html = renderToStaticMarkup(
      <CommandPalette
        session={session}
        maxTabs={10}
        onClose={() => undefined}
        onSelect={() => undefined}
        indexCache={cache}
      />,
    );

    expect(html).toContain('aria-label="搜索阅读历史"');
    expect(html).toContain('正在准备搜索');
    expect(cache.getOrCreate).not.toHaveBeenCalled();
  });

  it('uses a warm index during the first render', async () => {
    const cache = {
      peek: vi.fn(() => emptyIndex),
      getOrCreate: vi.fn(() => emptyIndex),
    };

    const html = renderToStaticMarkup(
      <CommandPalette
        session={session}
        maxTabs={10}
        onClose={() => undefined}
        onSelect={() => undefined}
        indexCache={cache}
      />,
    );

    expect(html).not.toContain('正在准备搜索');
    expect(cache.getOrCreate).not.toHaveBeenCalled();
  });

  it('only opts into entrance motion for pointer-opened search', () => {
    const cache = {
      peek: vi.fn(() => emptyIndex),
      getOrCreate: vi.fn(() => emptyIndex),
    };
    const pointerHtml = renderToStaticMarkup(
      <CommandPalette
        session={session}
        maxTabs={10}
        onClose={() => undefined}
        onSelect={() => undefined}
        indexCache={cache}
        animateEntrance
      />,
    );
    const keyboardHtml = renderToStaticMarkup(
      <CommandPalette
        session={session}
        maxTabs={10}
        onClose={() => undefined}
        onSelect={() => undefined}
        indexCache={cache}
      />,
    );

    expect(pointerHtml).toContain('command-palette-layer has-entrance');
    expect(keyboardHtml).not.toContain('has-entrance');
  });
});
