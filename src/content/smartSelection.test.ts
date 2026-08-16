import { describe, expect, it } from 'vitest';
import {
  candidateFitsViewport,
  isSmartSelectionCancelKey,
  normalizeSmartSelectionText,
  transitionSmartSelectionPhase,
} from './smartSelection';

describe('smart DOM selection rules', () => {
  it('normalizes selected block text without pretending to preserve pixel geometry', () => {
    expect(normalizeSmartSelectionText('  第一行\n 第二行   ')).toBe('第一行 第二行');
    expect(normalizeSmartSelectionText('123456', 4)).toBe('1234');
  });

  it('rejects invisible, tiny, offscreen, and page-sized wrappers', () => {
    const viewport = { width: 1000, height: 800 };
    expect(candidateFitsViewport({ left: 20, top: 20, right: 520, bottom: 220, width: 500, height: 200 }, viewport)).toBe(true);
    expect(candidateFitsViewport({ left: 20, top: 20, right: 25, bottom: 25, width: 5, height: 5 }, viewport)).toBe(false);
    expect(candidateFitsViewport({ left: 1200, top: 20, right: 1400, bottom: 220, width: 200, height: 200 }, viewport)).toBe(false);
    expect(candidateFitsViewport({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }, viewport)).toBe(false);
  });

  it('recognizes both modern and legacy Escape key values', () => {
    expect(isSmartSelectionCancelKey('Escape')).toBe(true);
    expect(isSmartSelectionCancelKey('Esc')).toBe(true);
    expect(isSmartSelectionCancelKey('Enter')).toBe(false);
  });

  it('requires an explicit page-focus step before content can be committed', () => {
    const awaitingFocus = transitionSmartSelectionPhase('inactive', 'start');
    expect(awaitingFocus).toBe('awaiting-focus');
    expect(transitionSmartSelectionPhase(awaitingFocus, 'commit')).toBe('awaiting-focus');

    const selecting = transitionSmartSelectionPhase(awaitingFocus, 'focus');
    expect(selecting).toBe('selecting');
    expect(transitionSmartSelectionPhase(selecting, 'commit')).toBe('committing');
    expect(transitionSmartSelectionPhase('committing', 'finish')).toBe('inactive');
  });
});
