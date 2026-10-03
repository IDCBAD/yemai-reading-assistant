import type { CollectionMaterial } from '../types';
import { CollectionReferenceDialog } from './CollectionReferenceDialog';
import { CollectionMaterialDetails } from './CollectionMaterialDetails';

export function CollectionMaterialDialog({ material, onClose }: { material: CollectionMaterial; onClose: () => void }) {
  return <CollectionReferenceDialog label="收藏引用详情" onClose={onClose}>
    <CollectionMaterialDetails material={material} onClose={onClose} />
  </CollectionReferenceDialog>;
}
