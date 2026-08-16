import { describe, expect, it } from 'vitest';
import { formatMessageTimestamp } from './messageTimestamp';

describe('formatMessageTimestamp', () => {
  const now = new Date(2026, 7, 11, 22, 30, 0).getTime();

  it('uses time only for messages from today', () => {
    expect(formatMessageTimestamp(new Date(2026, 7, 11, 9, 5, 7).getTime(), now).label).toBe('09:05');
  });

  it('labels yesterday without repeating the date', () => {
    expect(formatMessageTimestamp(new Date(2026, 7, 10, 23, 8).getTime(), now).label).toBe('昨天 23:08');
  });

  it('includes the date for older messages', () => {
    expect(formatMessageTimestamp(new Date(2026, 6, 3, 8, 2).getTime(), now).label).toBe('7月3日 08:02');
    expect(formatMessageTimestamp(new Date(2025, 11, 1, 8, 2).getTime(), now).label).toBe('2025年12月1日 08:02');
  });
});
