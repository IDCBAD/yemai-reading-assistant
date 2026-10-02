import { describe, expect, it } from 'vitest';
import { artifactPreviewKind, clampImageView, decodePreviewText, fitImageScale, formatPreviewJson, readPreviewBytes, safeArtifactUrl, zoomImageView } from './artifactPreview';

describe('artifact preview boundaries', () => {
  it('only opens HTTPS URLs without embedded credentials', () => {
    expect(safeArtifactUrl('https://files.example.com/a.md?signature=abc')).toContain('signature=abc');
    for (const value of ['javascript:alert(1)', 'http://files.example.com/a', 'https://user:password@example.com/a', '/a']) {
      expect(safeArtifactUrl(value)).toBeUndefined();
    }
  });
  it('offers supported previews and keeps other formats downloadable', () => {
    for (const extension of ['md', 'html', 'xls', 'xlsx', 'xlsm', 'csv', 'json', 'txt', 'png']) {
      expect(artifactPreviewKind({ filename: `report.${extension}` })).toBeDefined();
    }
    for (const extension of ['pdf', 'docx', 'pptx', 'zip']) expect(artifactPreviewKind({ filename: `report.${extension}` })).toBeUndefined();
  });
  it('rejects a streamed body that exceeds the limit without Content-Length', async () => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close();
    } }));
    await expect(readPreviewBytes(response, 3, new AbortController().signal)).rejects.toThrow('文件过大');
  });
  it('rejects oversized declared length before reading', async () => {
    await expect(readPreviewBytes(new Response('abc', { headers: { 'content-length': '100' } }), 3, new AbortController().signal)).rejects.toThrow('文件过大');
  });
  it('rejects unavailable files and preserves valid file bytes', async () => {
    await expect(readPreviewBytes(new Response('', { status: 403 }), 10, new AbortController().signal)).rejects.toThrow('失效');
    const bytes = await readPreviewBytes(new Response('页脉'), 10, new AbortController().signal);
    expect(decodePreviewText(bytes)).toBe('页脉');
  });
  it('does not read an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readPreviewBytes(new Response('abc'), 10, controller.signal)).rejects.toThrow();
  });
  it('cancels a stalled stream when the preview closes', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const pending = readPreviewBytes(response, 10, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
  it('honors declared encoding and reports undecodable content', () => {
    expect(decodePreviewText(new Uint8Array([0xff, 0xfe, 0x41, 0]), 'text/plain; charset="utf-16le"')).toBe('A');
    expect(() => decodePreviewText(new Uint8Array([0xff]))).toThrow('编码');
  });
  it('formats valid JSON but preserves malformed JSON exactly', () => {
    expect(formatPreviewJson('{"count":2}')).toEqual({ text: '{\n  "count": 2\n}', valid: true });
    expect(formatPreviewJson('{broken\n')).toEqual({ text: '{broken\n', valid: false });
  });
});

describe('image viewing geometry', () => {
  it('fits large images without enlarging small originals', () => {
    expect(fitImageScale(1200, 800, 632, 432)).toBe(0.5);
    expect(fitImageScale(100, 100, 632, 432)).toBe(1);
  });
  it('keeps the point under the cursor stationary while zooming', () => {
    const previous = { scale: 0.5, x: 20, y: -10 };
    const next = zoomImageView(previous, 1, 100, 50);
    expect((100 - next.x) / next.scale).toBe((100 - previous.x) / previous.scale);
    expect((50 - next.y) / next.scale).toBe((50 - previous.y) / previous.scale);
  });
  it('keeps a dragged image within reachable bounds', () => {
    expect(clampImageView({ scale: 1, x: 9999, y: -9999 }, 800, 600, 400, 300)).toEqual({ scale: 1, x: 216, y: -166 });
    expect(clampImageView({ scale: 0.1, x: 100, y: -100 }, 800, 600, 400, 300)).toEqual({ scale: 0.1, x: 0, y: 0 });
  });
});
