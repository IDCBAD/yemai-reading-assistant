import type { ChatMessage, CollectionMaterial, Conversation, OpenConversationTab, PageContext } from './types';

export function createCollectionConversation(
  materials: CollectionMaterial[],
  ids: { conversationId: string; tabId: string },
  now: number,
) {
  const page: PageContext = { title: '', site: '', url: '', status: 'not-read' };
  const conversation: Conversation = {
    id: ids.conversationId, title: `收藏问答 · ${materials.length} 条`, subtitle: `已加入 ${materials.length} 条收藏 · 尚未提问`,
    updatedAt: now, isDraft: true, page, pages: [page], messages: [],
    draftInput: '', draftContextItems: [], draftCollectionMaterials: materials,
  };
  const tab: OpenConversationTab = { id: ids.tabId, conversationId: ids.conversationId, openedAt: now };
  return { conversation, tab };
}

export function collectionDeliveryState(message?: ChatMessage): 'pending' | 'received' | 'uncertain' {
  if (message?.content.trim() || message?.artifacts?.length) return 'received';
  if (message?.status === 'failed' || message?.status === 'stopped') return 'uncertain';
  return 'pending';
}

export function isCollectionConversation(conversation: Conversation) {
  return Boolean(conversation.draftCollectionMaterials?.length
    || conversation.messages.some((message) => message.role === 'user' && message.collectionMode === 'question'));
}
