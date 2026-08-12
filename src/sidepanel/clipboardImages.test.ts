import { describe, expect, it } from 'vitest';
import { extractClipboardImages, namePastedImages } from './clipboardImages';

describe('clipboard images', () => {
  it('extracts image files without intercepting plain text clipboard content', () => {
    const image = new File(['image'], 'image.png', { type: 'image/png' });
    const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    expect(extractClipboardImages({ files: [image, document], items: [] })).toEqual([image]);
    expect(extractClipboardImages({ files: [], items: [] })).toEqual([]);
  });

  it('falls back to clipboard items when files are unavailable', () => {
    const image = new File(['image'], 'image.png', { type: 'image/png' });
    const item = {
      kind: 'file',
      type: 'image/png',
      getAsFile: () => image,
    };

    expect(extractClipboardImages({ files: [], items: [item] })).toEqual([image]);
  });

  it('gives generic clipboard images readable and collision-free names', () => {
    const first = new File(['first'], 'image.png', { type: 'image/png' });
    const second = new File(['second'], 'blob', { type: 'image/jpeg' });

    const renamed = namePastedImages([first, second], ['粘贴图片 1.png']);

    expect(renamed.map((file) => file.name)).toEqual(['粘贴图片 2.png', '粘贴图片 3.jpg']);
    expect(renamed.map((file) => file.type)).toEqual(['image/png', 'image/jpeg']);
  });

  it('preserves a meaningful filename copied from the system file browser', () => {
    const logo = new File(['logo'], 'yemai-logo.png', { type: 'image/png' });

    expect(namePastedImages([logo], [])[0]).toBe(logo);
  });
});
