// @ts-expect-error Vitest runs this source-contract test in Node; the extension bundle intentionally omits Node types.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest runs this source-contract test in Node; the extension bundle intentionally omits Node types.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const readingCardsPanelSource = readFileSync(
  fileURLToPath(new URL('./components/ReadingCardsPanel.tsx', import.meta.url)),
  'utf8',
);

function rule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

describe('message layout CSS', () => {
  it('keeps conversation content clear of the scrollbar and preview rail', () => {
    const messages = rule('.messages');

    expect(messages).toContain('scrollbar-gutter: stable');
    expect(messages).toMatch(/padding:\s*24px\s+(?:3[4-9]|[4-9]\d)px\s+32px\s+22px/);
    expect(styles).toContain('.messages { padding: 24px 34px 32px 12px; }');
    expect(styles).not.toContain('.messages { padding-inline: 12px; }');
  });

  it('uses deterministic wrapping for long CJK user questions', () => {
    expect(rule('.user-message-text')).toContain('text-wrap: wrap');
  });

  it('keeps the inline Agent run state visible with reduced motion', () => {
    expect(rule('.message-run-note--running::before')).toContain('animation: message-run-pulse');
    expect(styles).toMatch(/prefers-reduced-motion[\s\S]*\.message-run-note--running::before\s*\{[\s\S]*animation:\s*none/);
  });

  it('contains reading-card Markdown within the detail panel instead of clipping its right edge', () => {
    expect(rule('.reading-card-detail')).toContain('min-width: 0');
    expect(rule('.reading-card-detail')).toContain('max-width: 100%');
    expect(rule('.reading-card-markdown')).toContain('min-width: 0');
    expect(rule('.reading-card-markdown')).toContain('max-width: 100%');
    expect(rule('.reading-card-markdown')).toContain('overflow-wrap: anywhere');
    expect(rule('.reading-card-markdown > *')).toContain('max-width: 100%');
    expect(rule('.reading-card-markdown pre,\n.reading-card-markdown table')).toContain('overflow-x: auto');
  });

  it('keeps both answer-selection actions large enough to target without adding entrance motion', () => {
    expect(rule('.assistant-selection-action__button')).toContain('min-height: 40px');
    expect(rule('.assistant-selection-action')).not.toContain('animation:');
  });

  it('keeps a long excerpt title from widening the reading-card grid and clipping its body', () => {
    expect(rule('.reading-cards-panel')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule('.reading-cards-header')).toContain('min-width: 0');
    expect(rule('.reading-cards-header')).toContain('max-width: 100%');
    expect(rule('.reading-cards-header > div:first-child')).toContain('flex: 1 1 auto');
  });

  it('keeps the collection river in the flexible panel row when no issue is present', () => {
    expect(readingCardsPanelSource).toContain('<div className="reading-cards-notice">');
    expect(rule('.reading-cards-stage')).toContain('grid-row: 3');
  });
});
