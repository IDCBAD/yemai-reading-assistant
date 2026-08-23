import { describe, expect, it } from 'vitest';
import { findSearchTextMatches } from '../search/searchTextMatches';

describe('findSearchTextMatches', () => {
  it('highlights only the semantic query token inside a longer Chinese word', () => {
    expect(findSearchTextMatches('人类与人类学', '人类', ['人类', '人类学'])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  it('highlights separate semantic terms when the query omits a particle', () => {
    expect(findSearchTextMatches('智能体的可靠性', '智能体可靠性', ['智能', '体', '可靠性'])).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it('returns no range when neither the query nor an indexed term is visible', () => {
    expect(findSearchTextMatches('这是页面来源命中的消息', '附件名称', ['evaluation.xlsx'])).toEqual([]);
  });

  it('does not mark adjacent characters that cross Chinese word boundaries', () => {
    expect(findSearchTextMatches('根据达人类型自动分路，人类活动仍需判断。', '人类', ['人类']))
      .toEqual([{ start: 11, end: 13 }]);
  });

  it('keeps a structured date as one exact highlight range', () => {
    expect(findSearchTextMatches('计划日期：2026-08-31。', '2026-08-31', ['2026', '08', '31']))
      .toEqual([{ start: 5, end: 15 }]);
  });

  it('keeps highlight offsets stable after a normalized ellipsis', () => {
    expect(findSearchTextMatches('…，但不能替代“意义判断型”的工作', '意义', ['意义']))
      .toEqual([{ start: 8, end: 10 }]);
  });
});
