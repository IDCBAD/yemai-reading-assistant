/** Listen to browser changes too, including Escape and browser UI exits. */
export function observePreviewFullscreen(element: HTMLElement, onChange: (active: boolean) => void, owner: Document = element.ownerDocument) {
  const update = () => onChange(owner.fullscreenElement === element);
  owner.addEventListener('fullscreenchange', update);
  update();
  return () => owner.removeEventListener('fullscreenchange', update);
}

/** Request fullscreen on the existing element so the embedded page keeps its state. */
export async function togglePreviewFullscreen(element: HTMLElement, owner: Document = element.ownerDocument): Promise<void> {
  if (owner.fullscreenElement === element) {
    if (!owner.exitFullscreen) throw new Error('Fullscreen is unavailable');
    await owner.exitFullscreen();
  } else {
    if (!element.requestFullscreen) throw new Error('Fullscreen is unavailable');
    await element.requestFullscreen();
  }
}
