import type { ChatMessage } from './types';

export interface ConversationTurnAnchor {
  id: string;
  top: number;
}

export const MIN_CONVERSATION_RAIL_TURNS = 4;
export const MAX_CONVERSATION_TURN_LABEL_LENGTH = 72;
const MAX_CONVERSATION_ANSWER_PREVIEW_LENGTH = 240;
const MAX_PREVIEW_SOURCE_LENGTH = 4000;

export function compactConversationTurnLabel(value: string, fallback: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) return fallback;
  if (normalized.length <= MAX_CONVERSATION_TURN_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_CONVERSATION_TURN_LABEL_LENGTH - 1).trimEnd()}…`;
}

/** A short display excerpt; the original Markdown remains on the message. */
function compactAnswerPreview(value: string) {
  const text = value
    .slice(0, MAX_PREVIEW_SOURCE_LENGTH)
    .replace(/```[^\n]*\n?/gu, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/gu, '$1')
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gu, '$1')
    .replace(/[*`~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length <= MAX_CONVERSATION_ANSWER_PREVIEW_LENGTH
    ? text
    : `${text.slice(0, MAX_CONVERSATION_ANSWER_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

/** Uses the same nearest preceding question convention as buildAnswerContextMap. */
export function buildConversationTurnAnswerPreviews(messages: ChatMessage[]) {
  const turns = new Map<string, { content: string; latestAnswer?: ChatMessage }>();
  let turnId: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      turnId = message.id;
      turns.set(turnId, { content: '' });
      continue;
    }
    if (!turnId) continue;
    const turn = turns.get(turnId)!;
    turn.latestAnswer = message;
    if (message.content && turn.content.length < MAX_PREVIEW_SOURCE_LENGTH) {
      const remaining = MAX_PREVIEW_SOURCE_LENGTH - turn.content.length;
      turn.content = `${turn.content} ${message.content.slice(0, remaining)}`.slice(0, MAX_PREVIEW_SOURCE_LENGTH);
    }
  }
  const previews = new Map<string, string>();
  for (const [id, turn] of turns) {
    const excerpt = compactAnswerPreview(turn.content);
    if (excerpt) {
      previews.set(id, excerpt);
      continue;
    }
    const answer = turn.latestAnswer;
    const fallback = answer?.status === 'queued' ? '排队中…'
      : answer?.status === 'running' || answer?.status === 'streaming' ? '正在回答…'
        : answer?.status === 'failed' ? '回答失败'
          : answer?.status === 'stopped' ? '已停止'
            : answer?.artifacts?.length ? `已生成文件：${answer.artifacts[0]!.filename}` : '';
    previews.set(id, compactAnswerPreview(fallback));
  }
  return previews;
}

/** Global card top, constrained to the message area rather than the short rail. */
export function conversationPreviewTop(
  anchorCenter: number,
  previewHeight: number,
  containerTop: number,
  containerBottom: number,
  margin = 8,
) {
  const minimum = containerTop + margin;
  const maximum = Math.max(minimum, containerBottom - margin - previewHeight);
  return Math.max(minimum, Math.min(anchorCenter - previewHeight / 2, maximum));
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
