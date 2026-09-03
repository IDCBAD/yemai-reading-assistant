import { describe, expect, it } from 'vitest';
import {
  canLoopReadingCardRiver,
  clampRiverPosition,
  nearestReadingCardRiverPosition,
  readingCardRiverPose,
  readingCardRiverProgress,
  readingCardRiverRelative,
  readingCardRiverRenderCoordinate,
  readingCardRiverSpacing,
  readingCardRiverWindow,
  readingCardRiverWindowIndices,
  wrapRiverIndex,
  initialReadingCardRiverPosition,
  shouldRepositionRiverOnFocus,
  shouldActivateRiverDrag,
  transitionRiverReaderPosition,
  shouldUpdateReadingCardRiverWindow,
} from './readingCardRiver';

describe('reading card river interaction', () => {
  it('keeps ordinary pointer jitter as a click', () => {
    expect(shouldActivateRiverDrag(2, 'mouse')).toBe(false);
    expect(shouldActivateRiverDrag(5.9, 'pen')).toBe(false);
    expect(shouldActivateRiverDrag(7.9, 'touch')).toBe(false);
  });

  it('activates a drag at the deliberate movement threshold', () => {
    expect(shouldActivateRiverDrag(6, 'mouse')).toBe(true);
    expect(shouldActivateRiverDrag(-8, 'touch')).toBe(true);
    expect(shouldActivateRiverDrag(1, 'mouse', true)).toBe(true);
  });

  it('does not move a card between pointer down and pointer up when focus came from a click', () => {
    expect(shouldRepositionRiverOnFocus(false)).toBe(false);
    expect(shouldRepositionRiverOnFocus(true)).toBe(true);
  });

  it('does not reposition when Escape returns visible focus from the reader', () => {
    expect(shouldRepositionRiverOnFocus(true, true)).toBe(false);
  });

  it('restores the exact river position after opening and closing a card', () => {
    const beforeOpen = { position: 1.35, velocity: 0.18, returnPosition: null };
    const whileReading = transitionRiverReaderPosition(beforeOpen, 4, 6);
    const afterClose = transitionRiverReaderPosition(whileReading, null, 6);

    expect(whileReading.position).toBe(4);
    expect(afterClose.position).toBe(beforeOpen.position);
    expect(afterClose.velocity).toBe(0);
    expect(afterClose.returnPosition).toBeNull();
  });

  it('opens a looping card on its nearest visual occurrence and restores the exact position', () => {
    const beforeOpen = { position: 9.6, velocity: 0.18, returnPosition: null };
    const whileReading = transitionRiverReaderPosition(beforeOpen, 0, 10);
    const afterClose = transitionRiverReaderPosition(whileReading, null, 10);

    expect(whileReading.position).toBeCloseTo(10);
    expect(afterClose.position).toBe(beforeOpen.position);
  });

  it('clamps normal and overscrolled positions without invalid single-card values', () => {
    expect(clampRiverPosition(4, 3)).toBe(2);
    expect(clampRiverPosition(-0.4, 3, true)).toBe(-0.4);
    expect(clampRiverPosition(99, 1, true)).toBe(0);
  });

  it('returns stable progress for empty and single-card collections', () => {
    expect(readingCardRiverProgress(0, 0)).toBe(1);
    expect(readingCardRiverProgress(0, 1)).toBe(1);
    expect(readingCardRiverProgress(1, 3)).toBe(0.5);
  });

  it('windows large collections to a bounded set of rendered cards', () => {
    expect(readingCardRiverWindow(50, 200)).toEqual({ start: 42, end: 59 });
    expect(readingCardRiverWindow(0, 200)).toEqual({ start: 0, end: 9 });
    expect(readingCardRiverWindow(199, 200)).toEqual({ start: 191, end: 200 });
  });

  it('loops only collections large enough to feel intentional', () => {
    expect(canLoopReadingCardRiver(4)).toBe(false);
    expect(canLoopReadingCardRiver(5)).toBe(true);
    expect(wrapRiverIndex(-1, 10)).toBe(9);
    expect(readingCardRiverRelative(0, 9.6, 10)).toBeCloseTo(0.4);
    expect(readingCardRiverRelative(9, 0.3, 10)).toBeCloseTo(-1.3);
    expect(nearestReadingCardRiverPosition(9.6, 0, 10)).toBeCloseTo(10);
  });

  it('renders a bounded cyclic window without duplicate cards', () => {
    expect(readingCardRiverWindowIndices(9, 10, 2)).toEqual([0, 1, 7, 8, 9]);
    expect(readingCardRiverWindowIndices(0, 4, 2)).toEqual([0, 1, 2]);
    expect(new Set(readingCardRiverWindowIndices(50, 200)).size).toBe(17);
  });

  it('keeps a fully rendered loop in a stable DOM order while its position changes', () => {
    expect(readingCardRiverWindowIndices(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(readingCardRiverWindowIndices(1, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('preserves subpixel travel while moving and snaps to a physical pixel at rest', () => {
    expect(readingCardRiverRenderCoordinate(10.375, true, 2)).toBe(10.375);
    expect(readingCardRiverRenderCoordinate(10.375, false, 2)).toBe(10.5);
  });

  it('does not schedule React window updates when every card is already rendered', () => {
    expect(shouldUpdateReadingCardRiverWindow(0, 1, 6)).toBe(false);
    expect(shouldUpdateReadingCardRiverWindow(0, 1, 200)).toBe(true);
    expect(shouldUpdateReadingCardRiverWindow(1, 1, 200)).toBe(false);
  });

  it('keeps a compact rhythm while spreading small loops across the viewport', () => {
    expect(readingCardRiverSpacing(940, 6)).toBe(132);
    expect(readingCardRiverSpacing(940, 10)).toBeCloseTo(86.67, 1);
    expect(readingCardRiverSpacing(940, 30)).toBe(86);
    expect(readingCardRiverSpacing(940, 4)).toBe(86);
  });

  it('places the focused card in the visible river and fades distant cards', () => {
    const focused = readingCardRiverPose({ index: 2, position: 2, width: 440, height: 640 });
    const distant = readingCardRiverPose({ index: 6, position: 2, width: 440, height: 640 });
    expect(initialReadingCardRiverPosition(200)).toBe(0);
    expect(focused.y).toBeGreaterThanOrEqual(80);
    expect(focused.y).toBeLessThanOrEqual(126);
    expect(focused.opacity).toBe(1);
    expect(focused.rotate).toBe(0);
    expect(focused.scale).toBe(1);
    expect(focused.x).toBeGreaterThan(150);
    expect(focused.x).toBeLessThan(290);
    expect(distant.opacity).toBe(1);
  });

  it('centres the active looping card and softly fades cards at the viewport edge', () => {
    const focused = readingCardRiverPose({
      index: 0,
      position: 0,
      width: 440,
      height: 640,
      cardCount: 10,
    });
    const edge = readingCardRiverPose({
      index: 3,
      position: 0,
      width: 440,
      height: 640,
      cardCount: 10,
    });

    expect(focused.y).toBe(320);
    expect(focused.rotate).toBe(0);
    expect(focused.scale).toBe(1);
    expect(edge.opacity).toBeLessThan(1);
  });
});
