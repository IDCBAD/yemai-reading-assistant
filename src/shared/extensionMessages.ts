import type { PageContext, QuoteReference } from '../sidepanel/types';

export interface PageSnapshot extends PageContext {
  pageId: string;
  sourceId: string;
  markdown: string;
  contentHash: string;
  extractedAt: number;
  quality: 'high' | 'partial' | 'fallback';
  truncated: boolean;
}

export type ExtensionRequest =
  | { type: 'panel:status' }
  | { type: 'selection:commit'; quote: QuoteReference; openPanel: boolean }
  | { type: 'selection:consume' }
  | { type: 'page:get-active-metadata'; tabId?: number }
  | { type: 'page:extract-active'; tabId?: number; expectedUrl?: string };

export type ContentRequest =
  | { type: 'page:get-metadata' }
  | { type: 'page:extract' };

export type ExtensionEvent =
  | { type: 'selection:available' }
  | { type: 'page:changed'; page: PageContext };

export interface PanelStatusResponse {
  open: boolean;
  bubbleEnabled: boolean;
}

export interface SelectionConsumeResponse {
  quotes: QuoteReference[];
}

export interface PageResponse {
  page: PageContext | PageSnapshot | null;
  error?: string;
}
