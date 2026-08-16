export interface CandidateMetrics {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportMetrics {
  width: number;
  height: number;
}

export type SmartSelectionPhase = 'inactive' | 'awaiting-focus' | 'selecting' | 'committing';
export type SmartSelectionEvent = 'start' | 'focus' | 'commit' | 'finish';

export function normalizeSmartSelectionText(value: string, maximumLength = 8_000) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}

export function isSmartSelectionCancelKey(key: string) {
  return key === 'Escape' || key === 'Esc';
}

export function transitionSmartSelectionPhase(
  phase: SmartSelectionPhase,
  event: SmartSelectionEvent,
): SmartSelectionPhase {
  if (event === 'finish') return 'inactive';
  if (event === 'start') return phase === 'inactive' ? 'awaiting-focus' : phase;
  if (event === 'focus') return phase === 'awaiting-focus' ? 'selecting' : phase;
  if (event === 'commit') return phase === 'selecting' ? 'committing' : phase;
  return phase;
}

export function candidateFitsViewport(
  rect: CandidateMetrics,
  viewport: ViewportMetrics,
  maximumAreaRatio = 0.72,
) {
  if (rect.width < 12 || rect.height < 12) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height) return false;
  return rect.width * rect.height <= viewport.width * viewport.height * maximumAreaRatio;
}
