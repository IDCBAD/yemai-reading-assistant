import { describe, expect, it } from 'vitest';
import { translationContextAroundSelection } from './translationContext';

describe('translation context around a selection', () => {
  it('finds the selected word in a code block line without including surrounding lines', () => {
    const content = '## Existing Memories\nThe primary source is the user.\n## Last Messages';
    const offset = content.indexOf('primary source');
    expect(translationContextAroundSelection(content, offset, 'primary source', 14, true)).toEqual({
      text: 'The primary source is the user.',
      highlightStart: 4,
      highlightEnd: 18,
    });
  });

  it('does not duplicate a whole selected sentence as context', () => {
    const selected = 'Memories currently in the system relevant to this conversation.';
    const content = `## Existing Memories\n${selected}\n## Last Messages`;
    expect(translationContextAroundSelection(content, content.indexOf(selected), selected, selected.length, true)).toBeNull();
  });
});
