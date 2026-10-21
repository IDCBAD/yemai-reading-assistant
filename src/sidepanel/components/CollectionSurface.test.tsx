import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectionHeaderActions, CollectionSurface } from './CollectionSurface';
import { ReadingCardsPanel } from './ReadingCardsPanel';

const noop = () => undefined;

function answerPanel(open: boolean) {
  return <ReadingCardsPanel embedded open={open} cards={[]} conversations={[]} removalUndo={null}
    onClose={noop} onRemove={noop} onUndoRemove={noop} onOpenSource={noop}
    onExportCard={async () => undefined} onExportAll={async () => undefined}
    onStartConversation={() => undefined} onSaveSelected={async () => []} />;
}

describe('the shared collection surface', () => {
  it('owns one dialog and one navigation header when answers are embedded', () => {
    const html = renderToStaticMarkup(<CollectionSurface open active="answers" answerCount={0} wordCount={2}
      onChange={noop} onClose={noop}>{answerPanel(true)}</CollectionSurface>);
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html.match(/aria-label="收藏类型"/g)).toHaveLength(1);
    expect(html).not.toContain('class="reading-cards-header"');
    expect(html).not.toContain('class="reading-cards-scrim"');
  });

  it('retains embedded content when it is inactive instead of returning an empty tree', () => {
    const html = renderToStaticMarkup(<CollectionSurface open active="words" answerCount={0} wordCount={2}
      onChange={noop} onClose={noop}><div hidden>{answerPanel(false)}</div><div>词卡</div></CollectionSurface>);
    expect(html).not.toContain('class="reading-cards-header"');
    expect(html).toContain('reading-cards-panel--embedded');
    expect(html).toContain('词卡');
  });

  it('shows the fixed header even before a cold content module is ready', () => {
    const html = renderToStaticMarkup(<CollectionSurface open busy active="words" answerCount={0} wordCount={0}
      onChange={noop} onClose={noop}><div role="status">正在打开收藏…</div></CollectionSurface>);
    expect(html).toContain('aria-label="收藏类型"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('正在打开收藏…');
  });

  it('keeps header actions inert outside a shared surface', () => {
    expect(renderToStaticMarkup(<CollectionHeaderActions><button>朗读</button></CollectionHeaderActions>)).toBe('');
  });

  it('places compact view controls inside the standalone navigation header', () => {
    const html = renderToStaticMarkup(<ReadingCardsPanel open cards={[]} conversations={[]} removalUndo={null}
      onClose={noop} onRemove={noop} onUndoRemove={noop} onOpenSource={noop}
      onExportCard={async () => undefined} onExportAll={async () => undefined}
      onStartConversation={() => undefined} onSaveSelected={async () => []} />);
    expect(html.match(/aria-label="收藏类型"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="瀑布流视图"');
    expect(html).toContain('aria-label="列表视图"');
    expect(html).not.toContain('class="reading-cards-header"');
    expect(html).not.toContain('collection-quick-menu');
  });
});
