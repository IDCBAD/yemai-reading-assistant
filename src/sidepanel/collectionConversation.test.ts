import { describe, expect, it } from 'vitest';
import { workspaceToRows, rowsToWorkspace } from '../data/workspaceRows';
import { collectionMessagePrompt, collectionQuestionPrompt } from '../data/collectionPrompt';
import type { CollectionMaterial } from './types';
import { collectionDeliveryState, createCollectionConversation, isCollectionConversation } from './collectionConversation';

describe('collection conversation', () => {
  it('treats an answer received before a stream failure as delivered', () => {
    const answer = {
      id: 'answer-1', role: 'assistant' as const, content: '已有回答',
      createdAt: 1, status: 'failed' as const, collectionSend: true as const,
    };
    expect(collectionDeliveryState(answer)).toBe('received');
    expect(collectionDeliveryState({ ...answer, content: '' })).toBe('uncertain');
  });

  it('opens a draft with frozen materials and no sent message or current page', () => {
    const materials: CollectionMaterial[] = [{
      cardId: 'card-1', title: '结论', kind: 'excerpt', question: '为什么？', answer: '这段片段',
      sources: [{ title: '原文', url: 'https://example.com/article' }], savedAt: 10,
    }];
    const result = createCollectionConversation(materials, {
      conversationId: 'new-chat', tabId: 'tab-1',
    }, 100);
    expect(result.conversation.page.url).toBe('');
    expect(result.conversation.pages[0]?.url).toBe('');
    expect(result.conversation.messages).toEqual([]);
    expect(result.conversation.draftContextItems).toEqual([]);
    expect(result.conversation.draftCollectionMaterials).toEqual(materials);
    expect(isCollectionConversation(result.conversation)).toBe(true);
    expect(result.tab.conversationId).toBe('new-chat');

    const rows = workspaceToRows({
      conversations: [result.conversation], openTabs: [result.tab], activeOpenTabId: result.tab.id,
    }, 101);
    const restored = rowsToWorkspace(rows, rows.ui, 102);
    expect(restored?.conversations[0]?.draftCollectionMaterials).toEqual(materials);
    expect(restored?.conversations[0]?.messages).toEqual([]);
    expect(restored && isCollectionConversation(restored.conversations[0]!)).toBe(true);
  });

  it('uses the user question when the draft materials are sent', () => {
    const materials: CollectionMaterial[] = [{
      cardId: 'card-1', title: '结论', kind: 'answer', question: '原问题',
      answer: '原回答', sources: [], savedAt: 10,
    }];
    const prompt = collectionQuestionPrompt('这个结论有哪些边界？', materials);
    expect(prompt).toContain('这个结论有哪些边界？');
    expect(prompt).toContain('原回答');
    expect(prompt).not.toContain('综合整理共同点');
    expect(collectionMessagePrompt({ content: '这个结论有哪些边界？', collectionMaterials: materials, collectionMode: 'question' })).toBe(prompt);
    const draft = createCollectionConversation(materials, { conversationId: 'new-chat', tabId: 'tab-1' }, 100).conversation;
    expect(isCollectionConversation({
      ...draft,
      draftCollectionMaterials: undefined,
      messages: [{
        id: 'user-1', role: 'user', content: '这个结论有哪些边界？',
        createdAt: 101, status: 'complete', collectionMaterials: materials, collectionMode: 'question',
      }],
    })).toBe(true);
  });
});
