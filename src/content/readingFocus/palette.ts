import type { ReadingFocusGroupKind as ReadingFocusKind } from '../../shared/readingFocus';

type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];
export type ReadingPalette = Record<ReadingFocusKind, string | null>;
export const READING_KINDS = ['core', 'condition', 'reason', 'detail'] as const;

export function composite(foreground: RGBA, background: RGB): RGB {
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index]! * (1 - foreground[3])) as unknown as RGB;
}
export function luminance(color: RGB) {
  const channels = color.map((value) => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
export function contrast(first: RGB, second: RGB) {
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

/** CSSOM normally supplies rgb(); a canvas adapter can resolve modern CSS colors. */
export function parseColor(value: string, resolve?: (value: string) => RGBA | null): RGBA | null {
  if (value === 'transparent') return [0, 0, 0, 0];
  const rgb = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.trim().split(/[\s,/]+/);
    if (parts.length === 3 || parts.length === 4) {
      const channels = parts.slice(0, 3).map((part) => parseFloat(part) * (part.endsWith('%') ? 2.55 : 1));
      const alpha = parts[3] ? parseFloat(parts[3]) * (parts[3].endsWith('%') ? .01 : 1) : 1;
      if (channels.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255.001) && Number.isFinite(alpha) && alpha >= 0 && alpha <= 1) return [...channels, alpha] as unknown as RGBA;
    }
  }
  return resolve?.(value) ?? null;
}

/** Preserve text contrast first; visibility is selected among safe strengths. */
export function readingPalette(background: RGB, foreground: RGBA): ReadingPalette {
  const originalText = composite(foreground, background);
  const originalContrast = contrast(originalText, background);
  const minimumContrast = originalContrast >= 4.5 ? 4.5 : originalContrast * .97;
  const dark = luminance(background) < .12;
  const pigments: Record<ReadingFocusKind, RGB> = dark
    ? { core: [105, 176, 255], condition: [190, 145, 255], reason: [90, 207, 157], detail: [255, 183, 101] }
    : { core: [49, 121, 211], condition: [129, 79, 191], reason: [30, 139, 91], detail: [202, 126, 32] };
  const maximum = dark ? .4 : luminance(background) < .5 ? .3 : .18;
  return Object.fromEntries(READING_KINDS.map((kind) => {
    const pigment = pigments[kind];
    for (let step = 0; step < 18; step++) {
      const alpha = Number((maximum - step * .02).toFixed(2));
      if (alpha < .06) break;
      const painted = composite([...pigment, alpha], background);
      const paintedText = composite(foreground, painted);
      const difference = Math.sqrt(painted.reduce((sum, channel, index) => sum + (channel - background[index]!) ** 2, 0) / 3);
      if (difference >= 12 && contrast(paintedText, painted) >= minimumContrast) return [kind, `rgba(${pigment.join(',')},${alpha})`];
    }
    return [kind, null];
  })) as ReadingPalette;
}

/** Read only the current paragraph's ancestor chain; never alter site styles. */
export function paragraphPalette(element: HTMLElement, win: Window): ReadingPalette {
  const none = Object.fromEntries(READING_KINDS.map((kind) => [kind, null])) as ReadingPalette;
  let context: CanvasRenderingContext2D | null | undefined;
  const resolve = (value: string): RGBA | null => {
    try {
      if (context === undefined) context = element.ownerDocument?.createElement('canvas').getContext?.('2d', { willReadFrequently: true }) ?? null;
      if (!context) return null;
      // A rejected fillStyle retains its previous value. Two sentinels distinguish rejection.
      context.fillStyle = '#010203'; context.fillStyle = value; const first = context.fillStyle;
      context.fillStyle = '#040506'; context.fillStyle = value;
      if (first !== context.fillStyle) return null;
      context.clearRect(0, 0, 1, 1); context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
    } catch { return null; }
  };
  const own = win.getComputedStyle(element);
  const foreground = parseColor(own.color || 'rgb(32,32,32)', resolve);
  if (!foreground) return none;
  const layers: RGBA[] = [];
  let scheme = '';
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent);
    scheme = style.colorScheme || scheme;
    // Images and gradients cannot be represented faithfully by a single surface color.
    if (style.backgroundImage && style.backgroundImage !== 'none') return none;
    const layer = parseColor(style.backgroundColor || 'transparent', resolve);
    if (!layer) return none;
    layers.push(layer);
    if (layer[3] === 1) break;
  }
  const textSuggestsDark = luminance([foreground[0], foreground[1], foreground[2]]) > .5;
  const darkCanvas = scheme.trim() === 'dark' || (scheme.trim() !== 'light' && textSuggestsDark);
  let background: RGB = darkCanvas ? [18, 18, 18] : [255, 255, 255];
  for (const layer of layers.reverse()) background = composite(layer, background);
  return readingPalette(background, foreground);
}
