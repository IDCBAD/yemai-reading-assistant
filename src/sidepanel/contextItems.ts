import { isImageFile } from './fileTypes';
import type {
  ChatMessage,
  ContextItem,
  DraftAttachment,
  DraftPageReference,
  PageContext,
  QuoteReference,
} from './types';

function makeContextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pageStatus(page: PageContext, issue?: string): ContextItem['status'] {
  if (issue || !page.url) return 'failed';
  return page.status === 'reading' ? 'preparing' : 'ready';
}

function attachmentStatus(attachment: DraftAttachment): ContextItem['status'] {
  if (attachment.status === 'uploading') return 'preparing';
  return attachment.status;
}

export function pageContextItem(
  page: PageContext,
  included = true,
  issue?: string,
  options: { id?: string; createdAt?: number; role?: 'current' | 'referenced' } = {},
): ContextItem {
  return {
    id: options.id ?? makeContextId('context-page'),
    kind: 'page',
    included,
    status: pageStatus(page, issue),
    createdAt: options.createdAt ?? Date.now(),
    ...(issue ? { issue } : {}),
    page: { ...page },
    role: options.role ?? 'current',
  };
}

export function selectionContextItem(selection: QuoteReference, included = true): ContextItem {
  return {
    id: `context-${selection.id}`,
    kind: 'selection',
    included,
    status: 'ready',
    createdAt: selection.createdAt,
    selection: { ...selection },
  };
}

export function attachmentContextItem(attachment: DraftAttachment, included = true): ContextItem {
  return {
    id: `context-${attachment.id}`,
    kind: isImageFile(attachment.filename, attachment.mime) ? 'image' : 'file',
    included,
    status: attachmentStatus(attachment),
    createdAt: Date.now(),
    ...(attachment.errorMessage ? { issue: attachment.errorMessage } : {}),
    attachment: { ...attachment },
  };
}

export function legacyDraftContextItems(
  page: PageContext,
  reference: DraftPageReference | undefined,
  quotes: QuoteReference[] = [],
  attachments: DraftAttachment[] = [],
) {
  const pageIncluded = !reference || reference.url !== page.url || reference.mode === 'included';
  return [
    pageContextItem(page, pageIncluded),
    ...quotes.map((quote) => selectionContextItem(quote)),
    ...attachments.map((attachment) => attachmentContextItem(attachment)),
  ];
}

export function syncCurrentPageContextItem(
  items: ContextItem[],
  page: PageContext,
  issue?: string,
) {
  const current = items.find((item) => item.kind === 'page' && item.role === 'current');
  const nextPage = pageContextItem(
    page,
    current?.kind === 'page' && current.page.url === page.url ? current.included : true,
    issue,
    {
      id: current?.id,
      createdAt: current?.createdAt,
      role: 'current',
    },
  );
  return [nextPage, ...items.filter((item) => !(item.kind === 'page' && item.role === 'current'))];
}

export function contextItemIncluded(items: ContextItem[], id: string, included: boolean) {
  return items.map((item) => item.id === id ? { ...item, included } : item);
}

export function removeContextItem(items: ContextItem[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function updateAttachmentContextItem(
  items: ContextItem[],
  attachmentId: string,
  update: (attachment: DraftAttachment) => DraftAttachment,
) {
  return items.map((item) => {
    if ((item.kind !== 'file' && item.kind !== 'image') || item.attachment.id !== attachmentId) return item;
    const attachment = update(item.attachment);
    return {
      ...item,
      kind: isImageFile(attachment.filename, attachment.mime) ? 'image' as const : 'file' as const,
      status: attachmentStatus(attachment),
      issue: attachment.errorMessage,
      attachment,
    };
  });
}

export function updatePageContextSnapshot(
  items: ContextItem[],
  page: PageContext,
  issue?: string,
  delivery?: Extract<ContextItem, { kind: 'page' }>['delivery'],
) {
  return items.map((item) => item.kind === 'page'
    ? {
        ...pageContextItem(page, item.included, issue, {
          id: item.id,
          createdAt: item.createdAt,
          role: item.role,
        }),
        ...(delivery ? { delivery } : {}),
      }
    : item);
}

export function contextPage(items: ContextItem[]) {
  return items.find((item): item is Extract<ContextItem, { kind: 'page' }> => item.kind === 'page' && item.included);
}

export function contextSelections(items: ContextItem[]) {
  return items
    .filter((item): item is Extract<ContextItem, { kind: 'selection' }> =>
      item.kind === 'selection' && item.included && item.status === 'ready')
    .map((item) => item.selection);
}

export function contextAttachments(items: ContextItem[]) {
  return items
    .filter((item): item is Extract<ContextItem, { kind: 'file' | 'image' }> =>
      (item.kind === 'file' || item.kind === 'image') && item.included && item.status === 'ready')
    .map((item) => item.attachment);
}

export function contextItemsFromMessage(message: ChatMessage): ContextItem[] {
  if (message.contextItems) return message.contextItems;
  return [
    ...(message.pageContext ? [pageContextItem(message.pageContext, true, message.pageContextIssue, {
      id: `context-page-${message.id}`,
      createdAt: message.createdAt,
    })] : []),
    ...(message.references ?? []).map((selection) => selectionContextItem(selection)),
    ...(message.attachments ?? []).map((attachment) => attachmentContextItem(attachment)),
  ];
}

function snapshotItem(item: ContextItem): ContextItem {
  if (item.kind === 'page') return { ...item, page: { ...item.page } };
  if (item.kind === 'selection') return { ...item, selection: { ...item.selection } };
  if (item.kind === 'file' || item.kind === 'image') {
    const { previewUrl: _previewUrl, ...attachment } = item.attachment;
    return { ...item, attachment };
  }
  if (item.kind === 'memory') return { ...item, memory: { ...item.memory } };
  return { ...item, link: { ...item.link } };
}

export function createContextSnapshot(items: ContextItem[]) {
  return items
    .filter((item) => item.included)
    .filter((item) => {
      if (item.kind === 'page') return Boolean(item.page.url);
      if (item.kind === 'file' || item.kind === 'image') return item.status === 'ready';
      return item.status !== 'failed';
    })
    .map(snapshotItem);
}

export function cloneContextItems(items: ContextItem[], makeId: (prefix: string) => string = makeContextId) {
  return items.map((item) => {
    const clone = snapshotItem(item);
    return { ...clone, id: makeId('context') };
  });
}

export function retainContextAfterSend(items: ContextItem[]) {
  return items.filter((item) => item.kind === 'page' || !item.included || item.status === 'failed');
}
