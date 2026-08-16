import type { PageContext } from '../sidepanel/types';

type PageIdentity = Pick<PageContext, 'title' | 'site' | 'url'>;

export function pageChangeSignature(page: PageIdentity) {
  return `${page.url}\n${page.title}\n${page.site}`;
}

export function shouldPublishPageChange(
  previousSignature: string,
  nextPage: PageIdentity,
  forcedByNavigation = false,
) {
  return forcedByNavigation || pageChangeSignature(nextPage) !== previousSignature;
}
