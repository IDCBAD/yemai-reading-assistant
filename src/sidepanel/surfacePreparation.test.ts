import { describe, expect, it, vi } from 'vitest';
import { runPreparedSurfaceOpen } from './surfacePreparation';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('prepared surface opening', () => {
  it('does not commit the surface until feedback, code and first-view data are ready', async () => {
    const feedback = deferred();
    const code = deferred();
    const prepareData = vi.fn();
    const commit = vi.fn();

    const opening = runPreparedSurfaceOpen({
      load: () => code.promise,
      afterFeedback: () => feedback.promise,
      prepareData,
      shouldCommit: () => true,
      commit,
    });

    code.resolve();
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();

    feedback.resolve();
    await opening;
    expect(prepareData).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('drops a prepared surface when its request was cancelled', async () => {
    const prepareData = vi.fn();
    const commit = vi.fn();

    const committed = await runPreparedSurfaceOpen({
      load: async () => undefined,
      afterFeedback: async () => undefined,
      prepareData,
      shouldCommit: () => false,
      commit,
    });

    expect(committed).toBe(false);
    expect(prepareData).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
