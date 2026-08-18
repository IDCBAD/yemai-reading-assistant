import { browser } from 'wxt/browser';
import type { WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot, normalizeWorkspaceSnapshot } from './workspaceState';
import {
  DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
  type LocalStorageUsage,
} from './storageUsage';

const WORKSPACE_STORAGE_KEY = 'workspaceState';

export async function loadWorkspaceState() {
  const stored = await browser.storage.local.get(WORKSPACE_STORAGE_KEY);
  return normalizeWorkspaceSnapshot(stored[WORKSPACE_STORAGE_KEY]);
}

export async function saveWorkspaceState(workspace: WorkspaceState) {
  await browser.storage.local.set({
    [WORKSPACE_STORAGE_KEY]: createWorkspaceSnapshot(workspace),
  });
}

export async function loadLocalStorageUsage(): Promise<LocalStorageUsage> {
  const [historyBytes, totalBytes] = await Promise.all([
    browser.storage.local.getBytesInUse(WORKSPACE_STORAGE_KEY),
    browser.storage.local.getBytesInUse(null),
  ]);
  return {
    historyBytes,
    totalBytes,
    quotaBytes: browser.storage.local.QUOTA_BYTES ?? DEFAULT_LOCAL_STORAGE_QUOTA_BYTES,
  };
}
