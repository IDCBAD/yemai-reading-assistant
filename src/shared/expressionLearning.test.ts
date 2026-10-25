import { describe, expect, it } from 'vitest';
import { isLearningExpressionName, normalizeLearningExpressionName } from './expressionLearning';

describe('learning expression names', () => {
  it('accepts a reusable display template independently from a concrete occurrence', () => {
    for (const text of ['protect … from …', 'protect...from...', 'be charged for', 'C++', 'GPT-4', 'top-k']) {
      expect(isLearningExpressionName(text), text).toBe(true);
    }
    expect(normalizeLearningExpressionName('  Protect... FROM … ')).toBe('protect … from …');
    expect(normalizeLearningExpressionName('User’s  choice')).toBe("user's choice");
  });
  it('rejects unrelated page content, markup, links and unlimited placeholders', () => {
    for (const text of ['保护 … 免于 …', '<b>even if</b>', 'https://example.com', 'example.com … foo',
      'even\nif', 'even\tif', '… from …', 'protect … … from', 'x'.repeat(241), Array(17).fill('word').join(' '),
      'a … b … c … d … e']) expect(isLearningExpressionName(text), text).toBe(false);
  });
});
