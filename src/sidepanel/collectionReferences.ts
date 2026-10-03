import type { ChatMessage, CollectionMaterial, Conversation } from './types';
import { createContextSnapshot } from './contextItems';

export function snapshotCollectionMaterial(material: CollectionMaterial): CollectionMaterial {
  return { ...material, sources: material.sources.map((source) => ({ ...source })) };
}

/** Keep the existing draft snapshot when the same card is selected again. */
export function addCollectionReferences(existing: CollectionMaterial[] = [], incoming: CollectionMaterial[]) {
  const next = [...existing];
  const ids = new Set(existing.map((material) => material.cardId));
  for (const material of incoming) {
    if (ids.has(material.cardId)) continue;
    next.push({ ...snapshotCollectionMaterial(material), included: true });
    ids.add(material.cardId);
  }
  return next;
}

export function collectionReferenceIncluded(materials: CollectionMaterial[] = [], cardId: string, included: boolean) {
  return materials.map((material) => material.cardId === cardId ? { ...material, included } : material);
}

export function removeCollectionReference(materials: CollectionMaterial[] = [], cardId: string) {
  return materials.filter((material) => material.cardId !== cardId);
}

export function snapshotIncludedCollections(materials: CollectionMaterial[] = []) {
  return materials.filter((material) => material.included !== false).map((material) => {
    const { included: _included, ...snapshot } = snapshotCollectionMaterial(material);
    return snapshot;
  });
}

export function retainCollectionsAfterSend(materials: CollectionMaterial[] = []) {
  return materials.filter((material) => material.included === false);
}

/** Only for a local rejection before the Agent request starts. Preserve newer draft edits. */
export function restoreCollectionQuestionDraft(
  draft: Pick<Conversation, 'draftInput' | 'draftContextItems' | 'draftCollectionMaterials'>,
  message: Pick<ChatMessage, 'content' | 'contextItems' | 'collectionMaterials'>,
) {
  const existingIds = new Set(draft.draftContextItems.map((item) => item.id));
  const restoredItems = createContextSnapshot(message.contextItems ?? [])
    .filter((item) => item.kind !== 'page' && !existingIds.has(item.id));
  return {
    draftInput: draft.draftInput || message.content,
    draftCollectionMaterials: addCollectionReferences(draft.draftCollectionMaterials, message.collectionMaterials ?? []),
    draftContextItems: [...draft.draftContextItems, ...restoredItems],
  };
}
