import { yemaiDatabase } from '../data/database';

export interface BackgroundTaskEvent {
  id: string;
  conversationId: string;
  messageId: string;
  kind: 'complete' | 'failed' | 'waiting-user-input' | 'connection-lost';
  createdAt: number;
}
const KEY = 'backgroundTaskEvents';

// Persisted independently from presentation. No notification permission or
// visual policy is chosen here; stable IDs prevent duplicate delivery later.
export async function recordBackgroundTaskEvents(events: BackgroundTaskEvent[]) {
  await yemaiDatabase.transaction('rw', yemaiDatabase.meta, async () => {
    const stored = (await yemaiDatabase.meta.get(KEY))?.value;
    const previous = Array.isArray(stored) ? stored as BackgroundTaskEvent[] : [];
    const merged = new Map(previous.map((event) => [event.id, event]));
    events.forEach((event) => { if (!merged.has(event.id)) merged.set(event.id, event); });
    await yemaiDatabase.meta.put({ key: KEY, value: [...merged.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-100) });
  });
}
