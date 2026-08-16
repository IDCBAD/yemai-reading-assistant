import type { Conversation } from './types';

export interface ConversationTreeNode {
  conversation: Conversation;
  children: ConversationTreeNode[];
  updatedAt: number;
}

/**
 * Builds a display-only conversation forest from persisted parent links.
 * Missing parents and malformed cycles are promoted to roots so history never
 * becomes inaccessible because of stale local metadata.
 */
export function buildConversationForest(conversations: Conversation[]) {
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const childrenByParent = new Map<string, Conversation[]>();
  const roots: Conversation[] = [];

  for (const conversation of conversations) {
    const parentId = conversation.branch?.parentConversationId;
    if (!parentId || parentId === conversation.id || !byId.has(parentId)) {
      roots.push(conversation);
      continue;
    }
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), conversation]);
  }

  const visited = new Set<string>();
  const buildNode = (conversation: Conversation, ancestors: Set<string>): ConversationTreeNode => {
    visited.add(conversation.id);
    const nextAncestors = new Set(ancestors).add(conversation.id);
    const children = (childrenByParent.get(conversation.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildNode(child, nextAncestors))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return {
      conversation,
      children,
      updatedAt: Math.max(conversation.updatedAt, ...children.map((child) => child.updatedAt)),
    };
  };

  const forest = roots.map((conversation) => buildNode(conversation, new Set()));
  for (const conversation of conversations) {
    if (!visited.has(conversation.id)) forest.push(buildNode(conversation, new Set()));
  }
  return forest.sort((left, right) => right.updatedAt - left.updatedAt);
}
