import { describe, expect, it } from 'vitest';
import { learningEntries, representativeLocation } from './expressionList';
import type { ReadingExpression } from '../../shared/readingExpressions';

const expression = (id: string, text: string, category: ReadingExpression['category'], paragraphId = 'p0'): ReadingExpression => ({
  id, text, category, meaning: '保护……免于……', occurrences: [{ paragraphId, text: 'protect users from fees', start: 0, end: 23,
    sentence: 'We protect users from fees.', highlightStart: 3, highlightEnd: 26 }],
});
describe('learning list identities and examples', () => {
  it('groups equivalent template names across categories while retaining exact source references', () => {
    const entries = learningEntries([
      expression('a', 'Protect...from...', 'term'),
      expression('b', 'protect … from …', 'pattern', 'p1'),
      expression('c', 'protect … from …', 'pattern'),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.expression.category).toBe('pattern');
    expect(entries[0]!.locations.map(item => [item.expression.id, item.index, item.occurrence.paragraphId]))
      .toEqual([['a', 0, 'p0'], ['b', 0, 'p1']]);
  });
  it('places terms after reusable expressions and preserves original ordering otherwise', () => {
    const entries = learningEntries([expression('t', 'HTTP 429', 'term'), expression('a', 'based on', 'expression'), expression('b', 'at least', 'collocation')]);
    expect(entries.map(item => item.expression.id)).toEqual(['a', 'b', 't']);
  });
  it('chooses a short complete example rather than assuming the first occurrence is best', () => {
    const locations = ['a clipped example', 'This is a clear original example.', 'This is a much longer original example that repeats unnecessary context.']
      .map(sentence => ({ occurrence: { ...expression('a', 'based on', 'expression').occurrences[0]!, sentence } }));
    expect(representativeLocation(locations)).toBe(1);
  });
});
