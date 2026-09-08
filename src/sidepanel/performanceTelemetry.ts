export type UiPerformanceMetric =
  | 'sidepanel-shell'
  | 'search-shell'
  | 'search-index'
  | 'reading-cards-shell'
  | 'tab-switch-feedback'
  | 'tab-switch-content';

type PerformanceDetails = Record<string, number | string | boolean | undefined>;

function startMark(metric: UiPerformanceMetric) {
  return `yemai:${metric}:start`;
}

function endMark(metric: UiPerformanceMetric) {
  return `yemai:${metric}:end`;
}

export function startUiPerformanceMeasure(metric: UiPerformanceMetric) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return;
  const mark = startMark(metric);
  performance.clearMarks(mark);
  performance.mark(mark);
}

export function finishUiPerformanceMeasure(metric: UiPerformanceMetric, details: PerformanceDetails = {}) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return undefined;
  const start = startMark(metric);
  if (performance.getEntriesByName(start, 'mark').length === 0) return undefined;
  const end = endMark(metric);
  const measureName = `yemai:${metric}`;
  performance.mark(end);
  performance.clearMeasures(measureName);
  const measure = performance.measure(measureName, start, end);
  performance.clearMarks(start);
  performance.clearMarks(end);
  console.debug('[yemai:perf]', metric, {
    durationMs: Number(measure.duration.toFixed(2)),
    ...details,
  });
  return measure.duration;
}
