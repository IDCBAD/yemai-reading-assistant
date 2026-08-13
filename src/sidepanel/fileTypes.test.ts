import { describe, expect, it } from 'vitest';
import {
  attachmentAcceptForChannel,
  attachmentFormatLabel,
  getFileExtension,
  getFileType,
  isImageFile,
  isFileUploadSupported,
  isSupportedDocument,
  uploadChannelCapabilities,
  uploadChannelLabel,
} from './fileTypes';

describe('fileTypes', () => {
  it.each([
    ['report.PDF', 'pdf'],
    ['proposal.docx', 'word'],
    ['reading-log.xlsx', 'spreadsheet'],
    ['macro-log.xlsm', 'spreadsheet'],
    ['records.csv', 'csv'],
    ['AGENT.md', 'markdown'],
    ['saved-page.html', 'html'],
    ['notes.txt', 'text'],
    ['review.pptx', 'presentation'],
    ['manifest.json', 'json'],
  ])('classifies %s as %s', (filename, kind) => {
    expect(getFileType(filename).kind).toBe(kind);
  });

  it('uses the MIME type when a filename has no extension', () => {
    expect(getFileType('download', 'application/vnd.ms-excel').kind).toBe('spreadsheet');
    expect(getFileType('clipboard-image', 'image/png').kind).toBe('image');
  });

  it('recognizes images even when the browser omits their MIME type', () => {
    expect(isImageFile('screenshot.PNG')).toBe(true);
    expect(getFileType('screenshot.PNG').kind).toBe('image');
  });

  it('falls back safely for unknown files', () => {
    expect(getFileType('archive.bin', 'application/octet-stream').kind).toBe('generic');
    expect(isSupportedDocument('archive.bin', 'application/octet-stream')).toBe(false);
  });

  it('keeps public v1 validation and its file input accept list aligned', () => {
    const accept = attachmentAcceptForChannel('public-v1').split(',');
    for (const extension of ['pdf', 'docx', 'xlsx', 'xlsm', 'csv', 'md', 'txt', 'json', 'png']) {
      expect(isFileUploadSupported(`sample.${extension}`, undefined, 'public-v1')).toBe(true);
      expect(accept).toContain(`.${extension}`);
    }
    expect(isFileUploadSupported('page.html', 'text/html', 'public-v1')).toBe(false);
    expect(isFileUploadSupported('slides.pptx', undefined, 'public-v1')).toBe(false);
  });

  it('adds HTML only to the internal web upload channel', () => {
    const accept = attachmentAcceptForChannel('internal-v2').split(',');
    expect(accept).toContain('.html');
    expect(accept).toContain('.htm');
    expect(isFileUploadSupported('page.html', 'text/html', 'internal-v2')).toBe(true);
    expect(isFileUploadSupported('slides.pptx', undefined, 'internal-v2')).toBe(false);
  });

  it('formats extension labels without losing uncommon extension lengths', () => {
    expect(getFileExtension('README.markdown')).toBe('markdown');
    expect(attachmentFormatLabel('README.markdown')).toBe('MARKDOWN');
    expect(attachmentFormatLabel('clipboard-image', 'image/png')).toBe('图片');
  });

  it('describes upload channels in user-facing product language', () => {
    expect(uploadChannelLabel('internal-v2')).toBe('内部实时连接');
    expect(uploadChannelLabel('public-v1')).toBe('官方 API');
    expect(uploadChannelCapabilities('internal-v2')).toContain('HTML');
    expect(uploadChannelCapabilities('public-v1')).not.toContain('HTML');
    expect(uploadChannelCapabilities('public-v1')).toContain('图片');
  });
});
