import { describe, expect, it } from 'vitest';
import {
  attachmentContextItem,
  contextAttachments,
  contextItemIncluded,
  contextSelections,
  createContextSnapshot,
  legacyDraftContextItems,
  retainContextAfterSend,
  selectionContextItem,
  syncCurrentPageContextItem,
} from './contextItems';
import type { PageContext } from './types';

const page: PageContext = {
  title: '引言',
  site: 'example.com',
  url: 'https://example.com/introduction',
  status: 'not-read',
};

describe('unified context items', () => {
  it('preserves the current-page inclusion choice while metadata changes', () => {
    const initial = legacyDraftContextItems(page, { url: page.url, mode: 'excluded' });
    const synced = syncCurrentPageContextItem(initial, { ...page, title: '新的标题', status: 'ready' });

    expect(synced[0]).toMatchObject({
      kind: 'page',
      included: false,
      page: { title: '新的标题' },
    });
  });

  it('automatically includes a newly activated browser page', () => {
    const initial = legacyDraftContextItems(page, { url: page.url, mode: 'excluded' });
    const synced = syncCurrentPageContextItem(initial, {
      ...page,
      title: '下一章',
      url: 'https://example.com/chapter-2',
    });

    expect(synced[0]).toMatchObject({ kind: 'page', included: true });
  });

  it('creates an immutable send snapshot from included and ready items only', () => {
    const quote = selectionContextItem({
      id: 'quote-1',
      text: 'Agent Loop 是核心循环。',
      pageTitle: 'Agent Loop',
      pageUrl: page.url,
      createdAt: 10,
    });
    const readyFile = attachmentContextItem({
      id: 'file-1',
      filename: 'notes.md',
      sizeLabel: '8 KB',
      status: 'ready',
      url: 'https://example.com/notes.md',
    });
    const failedFile = attachmentContextItem({
      id: 'file-2',
      filename: 'broken.pdf',
      sizeLabel: '1 MB',
      status: 'failed',
      errorMessage: '上传失败',
    });
    const items = contextItemIncluded([
      ...legacyDraftContextItems(page, undefined),
      quote,
      readyFile,
      failedFile,
    ], quote.id, false);

    const snapshot = createContextSnapshot(items);
    expect(snapshot.map((item) => item.kind)).toEqual(['page', 'file']);
    expect(contextSelections(snapshot)).toEqual([]);
    expect(contextAttachments(snapshot).map((attachment) => attachment.filename)).toEqual(['notes.md']);
  });

  it('keeps a failed current page as a URL-only source for the next send attempt', () => {
    const items = syncCurrentPageContextItem(
      legacyDraftContextItems(page, undefined),
      page,
      '正文暂时无法读取',
    );

    expect(createContextSnapshot(items)[0]).toMatchObject({
      kind: 'page',
      issue: '正文暂时无法读取',
      page: { url: page.url },
    });
  });

  it('keeps the current page and failed items after a successful send', () => {
    const excludedQuote = contextItemIncluded([
      selectionContextItem({
        id: 'quote-excluded',
        text: '暂时不发送',
        pageTitle: '引言',
        pageUrl: page.url,
        createdAt: 15,
      }),
    ], 'context-quote-excluded', false)[0]!;
    const items = [
      ...legacyDraftContextItems(page, undefined),
      attachmentContextItem({
        id: 'failed-file',
        filename: 'broken.pdf',
        sizeLabel: '1 MB',
        status: 'failed',
      }),
      selectionContextItem({
        id: 'quote-2',
        text: '临时引用',
        pageTitle: '引言',
        pageUrl: page.url,
        createdAt: 20,
      }),
      excludedQuote,
    ];

    expect(retainContextAfterSend(items).map((item) => item.kind)).toEqual(['page', 'file', 'selection']);
  });
});
