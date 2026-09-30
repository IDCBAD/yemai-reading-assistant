export function formatRunDuration(startedAt?: number, finishedAt?: number): string | null {
  if (typeof startedAt !== 'number' || typeof finishedAt !== 'number'
    || !Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return null;
  const elapsed = finishedAt - startedAt;
  if (elapsed < 0) return null;
  if (elapsed < 1_000) return '<1 秒';

  const seconds = Math.floor(elapsed / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${remainingSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} 小时 ${remainingMinutes} 分`;
}
