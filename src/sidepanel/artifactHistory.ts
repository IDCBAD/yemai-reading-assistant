import type { AssistantArtifact, ChatMessage } from './types';

export interface ArtifactHistoryGroup {
  current: AssistantArtifact[];
  replayed: AssistantArtifact[];
}

/** A presentation-only repair: keep persisted references and let users expand them. */
export function replayedArtifactGroups(messages: ChatMessage[]) {
  const owners = new Map<string, ChatMessage>();
  const groups = new Map<string, ArtifactHistoryGroup>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const group: ArtifactHistoryGroup = { current: [], replayed: [] };
    for (const artifact of message.artifacts ?? []) {
      const key = artifact.url ? JSON.stringify([artifact.id, artifact.url]) : undefined;
      const owner = key ? owners.get(key) : undefined;
      const replayed = owner && message.runStartedAt && (message.activities ?? []).some((activity) =>
        activity.completedAt !== undefined && activity.completedAt < message.runStartedAt!
        && (owner.activities ?? []).some((previous) => previous.id === activity.id));
      (replayed ? group.replayed : group.current).push(artifact);
      if (key && !owner) owners.set(key, message);
    }
    if (group.replayed.length) groups.set(message.id, group);
  }
  return groups;
}
