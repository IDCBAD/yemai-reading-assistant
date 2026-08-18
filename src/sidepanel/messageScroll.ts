export interface MessageScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const MESSAGE_BOTTOM_THRESHOLD = 24;

export function messageDistanceFromBottom(metrics: MessageScrollMetrics) {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
}

export function isNearMessageBottom(
  metrics: MessageScrollMetrics,
  threshold = MESSAGE_BOTTOM_THRESHOLD,
) {
  return messageDistanceFromBottom(metrics) <= threshold;
}
