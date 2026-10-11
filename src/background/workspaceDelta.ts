import type { ChatMessage, Conversation, WorkspaceState } from '../sidepanel/types';

export interface FieldPatch { set: Record<string, unknown>; unset: string[] }
export interface WorkspaceDelta {
  added: Conversation[];
  removed: string[];
  changed: { id: string; fields: FieldPatch; addedMessages: ChatMessage[]; removedMessages: string[]; messages: { id: string; fields: FieldPatch }[] }[];
  ui: FieldPatch;
}

function fields(before: object, after: object, excluded: string[] = []): FieldPatch {
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  const patch: FieldPatch = { set: {}, unset: [] };
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (excluded.includes(key) || JSON.stringify(left[key]) === JSON.stringify(right[key])) continue;
    if (right[key] === undefined) patch.unset.push(key);
    else patch.set[key] = right[key];
  }
  return patch;
}

export function workspaceDelta(before: WorkspaceState, after: WorkspaceState): WorkspaceDelta {
  const old = new Map(before.conversations.map((c) => [c.id, c]));
  const current = new Set(after.conversations.map((c) => c.id));
  return {
    added: after.conversations.filter((c) => !old.has(c.id)),
    removed: before.conversations.filter((c) => !current.has(c.id)).map((c) => c.id),
    changed: after.conversations.filter((c) => old.has(c.id)).map((c) => {
      const previous = old.get(c.id)!;
      const messages = new Map(previous.messages.map((m) => [m.id, m]));
      const ids = new Set(c.messages.map((m) => m.id));
      return { id: c.id, fields: fields(previous, c, ['messages', 'id']),
        addedMessages: c.messages.filter((m) => !messages.has(m.id)),
        removedMessages: previous.messages.filter((m) => !ids.has(m.id)).map((m) => m.id),
        messages: c.messages.filter((m) => messages.has(m.id)).map((m) => ({ id: m.id, fields: fields(messages.get(m.id)!, m, ['id']) })),
      };
    }).filter((c) => Object.keys(c.fields.set).length || c.fields.unset.length || c.addedMessages.length || c.removedMessages.length || c.messages.some((m) => Object.keys(m.fields.set).length || m.fields.unset.length)),
    ui: fields(before, after, ['conversations']),
  };
}

const UI_CONVERSATION_FIELDS = new Set(['title', 'subtitle', 'updatedAt', 'isDraft', 'archivedAt', 'draftInput', 'draftContextItems', 'draftCollectionMaterials']);
// Existing messages are owned by the executor. UI can append frozen inputs and
// request retries, but cannot write an old stream, remote identity or source ledger.
function patch<T extends object>(target: T, change: FieldPatch, allowed?: Set<string>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(change.set)) if (!allowed || allowed.has(key)) result[key] = value;
  for (const key of change.unset) if (!allowed || allowed.has(key)) delete result[key];
  return result as T;
}

export function applyWorkspaceDelta(state: WorkspaceState, delta: WorkspaceDelta, authoritative = false): WorkspaceState {
  let conversations = state.conversations.filter((c) => !delta.removed.includes(c.id));
  const ids = new Set(conversations.map((c) => c.id));
  conversations = [...delta.added.filter((c) => !ids.has(c.id)), ...conversations];
  conversations = conversations.map((c) => {
    const change = delta.changed.find((item) => item.id === c.id);
    if (!change) return c;
    const existing = new Set(c.messages.map((m) => m.id));
    const messages = authoritative ? c.messages : c.messages.filter((m) => !change.removedMessages.includes(m.id)).map((m) => {
      const changeMessage = change.messages.find((item) => item.id === m.id);
      return changeMessage ? patch(m, changeMessage.fields) : m;
    });
    return { ...patch(c, change.fields, authoritative ? UI_CONVERSATION_FIELDS : undefined),
      messages: [...messages, ...change.addedMessages.filter((m) => !existing.has(m.id))] };
  });
  return { ...patch(state, delta.ui, new Set(['openTabs', 'activeOpenTabId'])), conversations };
}

export function hasWorkspaceDelta(delta: WorkspaceDelta) {
  return Boolean(delta.added.length || delta.removed.length || delta.changed.length || Object.keys(delta.ui.set).length || delta.ui.unset.length);
}
