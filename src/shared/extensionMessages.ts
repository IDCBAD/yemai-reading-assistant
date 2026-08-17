import type { PageContext, QuoteReference } from '../sidepanel/types';
import type { WorkosCredentialsResponse } from './workosCredentials';

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
  | { type: 'selection:smart-active'; tabId?: number }
  | { type: 'selection:smart-cancel-active'; tabId?: number }
  | { type: 'workos:import-login-credentials' }
  | {
      type: 'selection:smart-finish';
      outcome: 'committed' | 'cancelled';
      reopenPanel: boolean;
      quote?: QuoteReference;
    }
  | { type: 'page:get-active-metadata'; tabId?: number }
  | { type: 'page:extract-active'; tabId?: number; expectedUrl?: string };

export type ContentRequest =
  | { type: 'page:get-metadata' }
  | { type: 'page:extract' }
  | { type: 'selection:smart-start' }
  | { type: 'selection:smart-cancel' }
  | { type: 'workos:read-login-credentials' };

export type ExtensionEvent =
  | { type: 'selection:available' }
  | { type: 'selection:smart-finished'; outcome: 'committed' | 'cancelled' }
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

export interface CommandResponse {
  ok: boolean;
  error?: string;
}

export type { WorkosCredentialsResponse };
