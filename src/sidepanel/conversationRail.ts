export interface ConversationTurnAnchor {
  id: string;
  top: number;
}

export const MIN_CONVERSATION_RAIL_TURNS = 4;
export const MAX_CONVERSATION_TURN_LABEL_LENGTH = 72;

export function compactConversationTurnLabel(value: string, fallback: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return fallback;
  if (normalized.length <= MAX_CONVERSATION_TURN_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_CONVERSATION_TURN_LABEL_LENGTH - 1).trimEnd()}…`;
}

export function activeConversationTurnId(anchors: ConversationTurnAnchor[], viewportLine: number) {
  if (anchors.length === 0) return '';
  let activeId = anchors[0]!.id;
  for (const anchor of anchors) {
    if (anchor.top > viewportLine) break;
    activeId = anchor.id;
  }
  return activeId;
}
