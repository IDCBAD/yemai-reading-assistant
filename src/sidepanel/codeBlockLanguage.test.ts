import { describe, expect, it } from 'vitest';
import { describeCodeBlock } from './codeBlockLanguage';

describe('code block format', () => {
  it('recognizes common language tags and aliases without guessing plain text', () => {
    expect(describeCodeBlock('py', 'print(1)')).toEqual({ label: 'Python', language: 'python', tone: 'code' });
    expect(describeCodeBlock('md', '# Heading')).toEqual({ label: 'Markdown', language: 'markdown', tone: 'markdown' });
    expect(describeCodeBlock('text', 'just text')).toEqual({ label: 'Text', language: null, tone: 'plain' });
    expect(describeCodeBlock(undefined, 'just text')).toEqual({ label: 'Text', language: null, tone: 'plain' });
    expect(describeCodeBlock('toml', 'name = "x"')).toEqual({ label: 'toml', language: null, tone: 'plain' });
  });

  it('only infers unmarked JSON when it parses', () => {
    expect(describeCodeBlock(undefined, '{"ok": true}')).toEqual({ label: 'JSON', language: 'json', tone: 'code' });
    expect(describeCodeBlock(undefined, '{not json}').language).toBeNull();
  });
});
