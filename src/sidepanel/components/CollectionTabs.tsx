import type { ReactNode } from 'react';
import { KoboyoIcon } from './KoboyoIcon';
import '../collectionTabs.css';

interface CollectionTabsProps {
  active: 'answers' | 'words';
  count: number;
  onChange?: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/** The same collection navigation stays in place in both surfaces. */
export function CollectionTabs({ active, count, onChange, onClose, children }: CollectionTabsProps) {
  return <header className="collection-header">
    <div className="collection-tabs" role="group" aria-label="收藏类型">
      {(['answers', 'words'] as const).map((kind) => <button
        type="button" key={kind} aria-pressed={active === kind}
        disabled={kind !== active && !onChange}
        onClick={kind === active ? undefined : onChange}
      >{kind === 'answers' ? '问答收藏' : '单词收藏'}<span aria-hidden={active !== kind}>{active === kind ? count : ''}</span></button>)}
    </div>
    <div className="collection-header-actions">{children}<button className="collection-close pressable" type="button" aria-label="关闭收藏" onClick={onClose}><KoboyoIcon name="cross" size={15} /></button></div>
  </header>;
}
