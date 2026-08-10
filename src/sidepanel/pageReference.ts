import type { DraftPageReference, PageContext } from './types';

export function includedPageReference(page: Pick<PageContext, 'url'>): DraftPageReference {
  return { url: page.url, mode: 'included' };
}

export function isPageReferenceIncluded(reference: DraftPageReference, page: Pick<PageContext, 'url'>) {
  if (!page.url) return false;
  return reference.url !== page.url || reference.mode === 'included';
}

export function setPageReferenceIncluded(
  page: Pick<PageContext, 'url'>,
  included: boolean,
): DraftPageReference {
  return { url: page.url, mode: included ? 'included' : 'excluded' };
}

export function shouldPreparePageReference(included: boolean, page: Pick<PageContext, 'url'>) {
  return included && Boolean(page.url);
}
