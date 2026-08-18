import { describe, expect, it } from 'vitest';
import { isNearMessageBottom, messageDistanceFromBottom } from './messageScroll';

describe('message scroll state', () => {
  it('recognizes the bottom and tolerates small layout rounding', () => {
    expect(isNearMessageBottom({ scrollTop: 700, scrollHeight: 1_000, clientHeight: 300 })).toBe(true);
    expect(isNearMessageBottom({ scrollTop: 680, scrollHeight: 1_000, clientHeight: 300 })).toBe(true);
  });

  it('detaches after the reader moves meaningfully above the latest content', () => {
    expect(isNearMessageBottom({ scrollTop: 640, scrollHeight: 1_000, clientHeight: 300 })).toBe(false);
  });

  it('clamps overscroll instead of reporting a negative distance', () => {
    expect(messageDistanceFromBottom({ scrollTop: 720, scrollHeight: 1_000, clientHeight: 300 })).toBe(0);
  });
});
