import { describe, expect, it, vi } from 'vitest';
import { observePreviewFullscreen, togglePreviewFullscreen } from './fullscreen';

function fixture() {
  const owner = Object.assign(new EventTarget(), {
    fullscreenElement: null as HTMLElement | null,
    exitFullscreen: vi.fn(async () => { owner.fullscreenElement = null; owner.dispatchEvent(new Event('fullscreenchange')); }),
  });
  const element = {
    ownerDocument: owner,
    requestFullscreen: vi.fn(async () => { owner.fullscreenElement = element as unknown as HTMLElement; owner.dispatchEvent(new Event('fullscreenchange')); }),
  };
  return { owner: owner as unknown as Document & typeof owner, element: element as unknown as HTMLElement & typeof element };
}

describe('preview fullscreen', () => {
  it('enters and exits on the same existing preview element', async () => {
    const { owner, element } = fixture();
    const changes = vi.fn();
    const stop = observePreviewFullscreen(element, changes, owner);
    await togglePreviewFullscreen(element, owner);
    expect(element.requestFullscreen).toHaveBeenCalledOnce();
    expect(owner.fullscreenElement).toBe(element);
    expect(changes.mock.calls.map(([active]) => active)).toEqual([false, true]);
    await togglePreviewFullscreen(element, owner);
    expect(owner.exitFullscreen).toHaveBeenCalledOnce();
    expect(changes.mock.calls.map(([active]) => active)).toEqual([false, true, false]);
    stop();
  });

  it('observes browser Escape exits and removes the listener when disposed', async () => {
    const { owner, element } = fixture();
    const changes = vi.fn();
    const stop = observePreviewFullscreen(element, changes, owner);
    await togglePreviewFullscreen(element, owner);
    owner.fullscreenElement = null;
    owner.dispatchEvent(new Event('fullscreenchange'));
    expect(changes).toHaveBeenLastCalledWith(false);
    stop();
    owner.fullscreenElement = element;
    owner.dispatchEvent(new Event('fullscreenchange'));
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('does not report another element as the preview fullscreen state', () => {
    const { owner, element } = fixture();
    owner.fullscreenElement = {} as HTMLElement;
    const changes = vi.fn();
    const stop = observePreviewFullscreen(element, changes, owner);
    expect(changes).toHaveBeenCalledWith(false);
    stop();
  });

  it('reports unsupported or rejected requests to the caller', async () => {
    const { owner, element } = fixture();
    element.requestFullscreen.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(togglePreviewFullscreen(element, owner)).rejects.toThrow('Permission denied');
    expect(owner.fullscreenElement).toBeNull();
    await expect(togglePreviewFullscreen({ ownerDocument: owner } as unknown as HTMLElement, owner)).rejects.toThrow('Fullscreen is unavailable');
  });
});
