export interface BrowserTabChange {
  status?: string;
  url?: string;
  title?: string;
}

export function shouldRefreshPageMetadataForTab(
  updatedTabId: number,
  activeTabId: number | undefined,
  change: BrowserTabChange,
) {
  if (activeTabId === undefined || updatedTabId !== activeTabId) return false;
  return change.status === 'complete' || Boolean(change.url || change.title);
}

export function shouldApplyContentPageChange(
  senderTabId: number | undefined,
  activeTabId: number | undefined,
) {
  return senderTabId !== undefined && senderTabId === activeTabId;
}
