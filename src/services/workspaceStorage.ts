import { browser } from 'wxt/browser';
import type { WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot, normalizeWorkspaceSnapshot } from './workspaceState';

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
