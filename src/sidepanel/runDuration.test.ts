import { describe, expect, it } from 'vitest';
import { formatRunDuration } from './runDuration';

describe('formatRunDuration', () => {
  it('keeps long requests readable beyond one minute and one hour', () => {
    expect(formatRunDuration(1_000, 86_000)).toBe('1 分 25 秒');
    expect(formatRunDuration(1_000, 3_661_000)).toBe('1 小时 1 分');
  });

  it('does not invent a duration for older or invalid messages', () => {
    expect(formatRunDuration(undefined, 2_000)).toBeNull();
    expect(formatRunDuration(2_000, undefined)).toBeNull();
    expect(formatRunDuration(2_000, 1_000)).toBeNull();
  });
});
