import { describe, expect, it } from 'vitest';
import type { CollectionMaterial } from './types';
import { INITIAL_WORKSPACE } from './mockData';
import { workspaceToRows, rowsToWorkspace } from '../data/workspaceRows';
import { createWorkspaceSnapshot, normalizeWorkspaceSnapshot } from '../services/workspaceState';
import { getMessageContextSources } from './answerContext';
import { isCollectionConversation } from './collectionConversation';
import { addCollectionReferences, collectionReferenceIncluded, removeCollectionReference, restoreCollectionQuestionDraft, snapshotIncludedCollections, retainCollectionsAfterSend } from './collectionReferences';
import { attachmentContextItem, selectionContextItem } from './contextItems';

const card = (cardId: string): CollectionMaterial => ({ cardId, title: `标题 ${cardId}`, kind: 'answer', question: '原问题',
  answer: '收藏正文', sources: [{ title: '原来源', url: 'https://example.com/article' }], savedAt: 1 });

describe('collections attached to a question', () => {
  it('restores all consumed inputs after a local rejection while preserving later draft edits', () => {
    const quote = selectionContextItem({ id: 'q', text: '原选区', pageTitle: '文章', pageUrl: 'https://example.com', createdAt: 1 });
    const file = attachmentContextItem({ id: 'f', filename: '笔记.txt', sizeLabel: '1 KB', status: 'ready', url: 'https://example.com/file' });
    const laterChoice = { ...card('a'), included: false };
    const restored = restoreCollectionQuestionDraft({ draftInput: '用户已经写了下一问', draftContextItems: [quote],
      draftCollectionMaterials: [laterChoice] }, { content: '原问题', contextItems: [quote, file], collectionMaterials: [card('a'), card('b')] });
    expect(restored.draftInput).toBe('用户已经写了下一问');
    expect(restored.draftContextItems.map((item) => item.id)).toEqual([quote.id, file.id]);
    expect(restored.draftCollectionMaterials[0]).toEqual(laterChoice);
    expect(restored.draftCollectionMaterials[1]).toMatchObject({ cardId: 'b', included: true });
  });
  it('deduplicates additions without replacing a frozen draft or its exclusion choice', () => {
    const draft = collectionReferenceIncluded(addCollectionReferences([], [card('a')]), 'a', false);
    const next = addCollectionReferences(draft, [{ ...card('a'), answer: '修改后的收藏' }, card('b'), card('b')]);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ answer: '收藏正文', included: false });
    expect(snapshotIncludedCollections(next).map((material) => material.cardId)).toEqual(['b']);
    expect(retainCollectionsAfterSend(next)).toEqual(draft);
    expect(removeCollectionReference(next, 'a')).toHaveLength(1);
  });

  it('freezes source metadata on addition and sending and treats legacy drafts as included', () => {
    const original = card('a');
    const draft = addCollectionReferences([], [original]);
    original.sources[0]!.title = '收藏修改';
    const sent = snapshotIncludedCollections(draft);
    draft[0]!.sources[0]!.title = '草稿修改';
    expect(sent[0]!.sources[0]!.title).toBe('原来源');
    expect(sent[0]).not.toHaveProperty('included');
    expect(snapshotIncludedCollections([card('old')])).toHaveLength(1);
  });

  it('persists drafts and sent snapshots separately through rows and backup snapshots', () => {
    const original = INITIAL_WORKSPACE.conversations[0]!;
    const draft = collectionReferenceIncluded(addCollectionReferences([], [card('a'), card('b')]), 'b', false);
    const message = { id: 'sent', role: 'user' as const, content: '结合网页有什么区别？', createdAt: 10,
      status: 'complete' as const, collectionMode: 'question' as const, collectionMaterials: snapshotIncludedCollections(draft) };
    const workspace = { ...INITIAL_WORKSPACE, conversations: [{ ...original, draftInput: '下一个问题',
      draftCollectionMaterials: retainCollectionsAfterSend(draft), messages: [message] }] };
    const rows = workspaceToRows(workspace, 11);
    const restored = rowsToWorkspace(rows, rows.ui, 12)!;
    const backup = normalizeWorkspaceSnapshot(createWorkspaceSnapshot(restored, 13), 14)!;
    expect(backup.conversations[0]!.draftCollectionMaterials).toEqual([draft[1]]);
    expect(backup.conversations[0]!.messages[0]!.collectionMaterials).toEqual([card('a')]);
    expect(backup.conversations[0]!.draftInput).toBe('下一个问题');
    expect(isCollectionConversation(backup.conversations[0]!)).toBe(false);
    expect(getMessageContextSources(message)).toEqual([{ kind: 'collection', id: 'collection-a', material: card('a') }]);
  });

  it('keeps an ordinary reading draft eligible for a page when the browser initially had no readable URL', () => {
    const blankPage = { title: '', site: '', url: '', status: 'not-read' as const };
    const conversation = { ...INITIAL_WORKSPACE.conversations[0]!, page: blankPage, pages: [blankPage],
      collectionOrigin: 'reading' as const, draftCollectionMaterials: [card('a')] };
    const workspace = { ...INITIAL_WORKSPACE, conversations: [conversation] };
    const rows = workspaceToRows(workspace, 10);
    const restored = rowsToWorkspace(rows, rows.ui, 11)!;
    expect(isCollectionConversation(restored.conversations[0]!)).toBe(false);
  });
});
