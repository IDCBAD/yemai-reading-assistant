import { describe, expect, it } from 'vitest';
import { readingHint } from './learningHints';
import type { ReadingFocusGroup } from '../../shared/readingFocus';
const group = (extra: Partial<ReadingFocusGroup> = {}): ReadingFocusGroup => ({
  text: 'even if the provider charges for processing', start: 0, end: 44,
  kind: 'detail', semantic: 'concession', isCore: false, ...extra,
});
describe('short learning hover hints', () => {
  it('uses a concrete cue and keeps sentence-specific detail separate', () => {
    expect(readingHint(group({ cue: { text: 'even if', meaning: '即使……也……' }, learningNote: '即使提供商收费，也不改变前面的免计费结论。' })))
      .toEqual({ title: 'even if · 即使……也……', detail: '即使提供商收费，也不改变前面的免计费结论。' });
  });
  it('provides stable connector meanings for cached results without repeating legacy role explanations', () => {
    expect(readingHint(group({ explanation: '让步：上游仍收费也不影响结论' })))
      .toEqual({ title: 'even if · 即使……也……' });
    expect(readingHint(group({ text: 'For audio requests', semantic: 'scope', kind: 'condition', explanation: '适用范围' })))
      .toEqual({ title: '适用范围' });
  });
  it('does not add a tooltip to every ordinary main statement or guess a connector inside a word', () => {
    expect(readingHint(group({ text: 'Token charges are waived', kind: 'core', semantic: 'statement', isCore: true }))).toBeNull();
    expect(readingHint(group({ text: 'whenever needed', semantic: 'background' }))).toEqual({ title: '背景' });
    expect(readingHint(group({ cue: { text: 'not present', meaning: '不存在' } }))).toBeNull();
  });
});
