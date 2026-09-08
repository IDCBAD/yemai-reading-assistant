interface PreparedSurfaceOpenOptions {
  load: () => Promise<unknown>;
  afterFeedback?: () => Promise<void>;
  prepareData?: () => Promise<unknown> | unknown;
  shouldCommit: () => boolean;
  commit: () => void;
}

function afterUiFeedbackPaint() {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

export async function runPreparedSurfaceOpen({
  load,
  afterFeedback = afterUiFeedbackPaint,
  prepareData,
  shouldCommit,
  commit,
}: PreparedSurfaceOpenOptions) {
  const resource = load();
  await afterFeedback();
  await resource;
  if (!shouldCommit()) return false;
  await prepareData?.();
  if (!shouldCommit()) return false;
  commit();
  return true;
}
