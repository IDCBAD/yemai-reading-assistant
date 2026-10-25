import { describe, expect, it } from 'vitest';
import { composite, contrast, paragraphPalette, parseColor, readingPalette, READING_KINDS } from './palette';

const black = [0, 0, 0] as const;
const white = [255, 255, 255] as const;

describe('readable highlight palettes', () => {
  it('makes marks visible on black while keeping white text readable, and remains softer on white', () => {
    const dark = readingPalette(black, [...white, 1]);
    const light = readingPalette(white, [...black, 1]);
    for (const kind of READING_KINDS) {
      const darkInk = parseColor(dark[kind]!)!;
      const lightInk = parseColor(light[kind]!)!;
      expect(darkInk[3]).toBeGreaterThan(lightInk[3]);
      expect(contrast(white, composite(darkInk, black))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(black, composite(lightInk, white))).toBeGreaterThanOrEqual(4.5);
      expect(Math.max(...composite(darkInk, black))).toBeGreaterThan(65);
    }
  });
  it('does not trade readable text for stronger color on middle gray or low contrast text', () => {
    for (const background of [[128, 128, 128], [110, 110, 110], [180, 180, 180]] as const) {
      for (const text of [[255, 255, 255, 1], [0, 0, 0, 1], [230, 230, 230, .7]] as const) {
        const originalContrast = contrast(composite(text, background), background);
        const minimum = originalContrast >= 4.5 ? 4.5 : originalContrast * .97;
        for (const color of Object.values(readingPalette(background, text))) {
          if (!color) continue;
          const painted = composite(parseColor(color)!, background);
          expect(contrast(composite(text, painted), painted)).toBeGreaterThanOrEqual(minimum - .00001);
        }
      }
    }
  });
  it('omits marks when a visible tint would worsen already weak gray text on white', () => {
    expect(Object.values(readingPalette(white, [136, 136, 136, 1]))).toEqual([null, null, null, null]);
  });
  it('parses computed modern rgb syntax, percentages, alpha and transparent', () => {
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, .5]);
    expect(parseColor('rgba(10,20,30,0.2)')).toEqual([10, 20, 30, .2]);
    expect(parseColor('rgb(100% 0% 0%)')![0]).toBeCloseTo(255);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('color(display-p3 1 0 0)', () => [255, 0, 0, 1])).toEqual([255, 0, 0, 1]);
    expect(parseColor('rgb(NaN 0 0)')).toBeNull();
  });
});

function surface(layers: Array<{ backgroundColor: string; color?: string; backgroundImage?: string; colorScheme?: string }>) {
  const elements = layers.map(() => ({ parentElement: null as unknown, ownerDocument: { createElement: () => ({}) } }));
  elements.forEach((element, index) => { element.parentElement = elements[index + 1] ?? null; });
  return { element: elements[0] as unknown as HTMLElement,
    win: { getComputedStyle: (element: unknown) => ({ color: 'rgb(255,255,255)', ...layers[elements.indexOf(element as typeof elements[number])] }) } as unknown as Window };
}
describe('actual paragraph surfaces', () => {
  it('composes transparent paragraph and ancestor surfaces over the opaque page', () => {
    const page = surface([{ backgroundColor: 'transparent' }, { backgroundColor: 'rgba(40,60,80,.5)' }, { backgroundColor: 'rgb(0,0,0)' }]);
    expect(paragraphPalette(page.element, page.win)).toEqual(readingPalette([20, 30, 40], [255, 255, 255, 1]));
  });
  it('uses the local panel background even if the enclosing page is a different theme', () => {
    const page = surface([{ backgroundColor: 'rgb(255,255,255)', color: 'rgb(0,0,0)' }, { backgroundColor: 'rgb(0,0,0)' }]);
    expect(paragraphPalette(page.element, page.win)).toEqual(readingPalette(white, [...black, 1]));
  });
  it('uses text as the canvas fallback when a transparent page supports both color schemes', () => {
    const page = surface([{ backgroundColor: 'transparent', colorScheme: 'light dark' }]);
    expect(paragraphPalette(page.element, page.win)).toEqual(readingPalette([18, 18, 18], [255, 255, 255, 1]));
  });
  it('falls back to focus for an image or unresolvable background, without throwing on an absent canvas', () => {
    const image = surface([{ backgroundColor: 'transparent', backgroundImage: 'linear-gradient(red, blue)' }]);
    const modern = surface([{ backgroundColor: 'color(display-p3 1 0 0)' }]);
    expect(Object.values(paragraphPalette(image.element, image.win))).toEqual([null, null, null, null]);
    expect(Object.values(paragraphPalette(modern.element, modern.win))).toEqual([null, null, null, null]);
  });
});
