import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewHeader } from './PreviewHeader';

const props = { filename: '示例.html', downloadUrl: 'https://example.com/example.html', onClose() {}, closeLabel: '关闭预览' };

describe('PreviewHeader viewing controls', () => {
  it('offers expand in a sidebar without claiming fullscreen there', () => {
    const html = renderToStaticMarkup(<PreviewHeader {...props} onOpenTab={() => {}} />);
    expect(html).toContain('aria-label="展开查看"');
    expect(html).not.toContain('进入全屏');
    expect(html).toContain('aria-label="下载文件"');
  });

  it('shows enter or exit fullscreen only when supported by the host preview', () => {
    const enter = renderToStaticMarkup(<PreviewHeader {...props} onToggleFullscreen={() => {}} />);
    expect(enter).toContain('aria-label="进入全屏"');
    expect(enter).toContain('aria-pressed="false"');
    expect(enter).not.toContain('展开查看');
    const exit = renderToStaticMarkup(<PreviewHeader {...props} fullscreen onToggleFullscreen={() => {}} />);
    expect(exit).toContain('aria-label="退出全屏"');
    expect(exit).toContain('aria-pressed="true"');
  });

  it('prevents repeated expand clicks while the new tab is opening', () => {
    const html = renderToStaticMarkup(<PreviewHeader {...props} opening onOpenTab={() => {}} />);
    expect(html).toContain('disabled="" aria-label="展开查看"');
  });
});
