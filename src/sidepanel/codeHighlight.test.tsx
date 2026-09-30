import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { highlightCode } from './codeHighlight';

describe('local code highlighting', () => {
  it('colors Python and JSON using safe React text nodes', () => {
    const python = renderToStaticMarkup(<code>{highlightCode('def greet(name):\n    return "hi"', 'python')}</code>);
    const json = renderToStaticMarkup(<code>{highlightCode('{"ok": true}', 'json')}</code>);
    expect(python).toContain('hljs-keyword');
    expect(json).toContain('hljs-attr');
  });

  it('escapes untrusted source instead of inserting HTML', () => {
    const html = renderToStaticMarkup(<code>{highlightCode('<script>alert(1)</script>', 'xml')}</code>);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
  });
});
