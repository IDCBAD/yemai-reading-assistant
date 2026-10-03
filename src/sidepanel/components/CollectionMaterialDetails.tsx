import { useLayoutEffect, useRef } from 'react';
import type { CollectionMaterial } from '../types';
import { AssistantMarkdown } from './AssistantMarkdown';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

function sourceUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}

export function CollectionMaterialDetails({ material, onBack, onClose, onAdd, alreadyAdded = false }: {
  material: CollectionMaterial;
  onBack?: () => void;
  onClose: () => void;
  onAdd?: () => void;
  alreadyAdded?: boolean;
}) {
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { headerRef.current?.querySelector<HTMLElement>('[data-collection-initial-focus]')?.focus(); }, []);
  return <>
    <header className="collection-reference-header" ref={headerRef}>
      {onBack && <button className="collection-reference-back" type="button" data-collection-initial-focus
        aria-label="返回收藏搜索" onClick={onBack}>←</button>}
      <strong>收藏问答</strong>
      <IconTooltipButton className="preview-icon-button" type="button" aria-label="关闭收藏详情" tooltip="关闭"
        data-collection-initial-focus={onBack ? undefined : true} onClick={onClose}>
        <KoboyoIcon name="cross" size={13} />
      </IconTooltipButton>
    </header>
    <article className="collection-reference-detail">
      <h2>{material.title}</h2>
      <section><h3>原始问题</h3><p>{material.question || '原始问题缺失（旧收藏）'}</p></section>
      <section><h3>{material.kind === 'excerpt' ? '收藏的回答片段' : '完整回答'}</h3>
        {material.answer ? <div className="markdown-body"><AssistantMarkdown content={material.answer} streaming={false} /></div>
          : <p>此收藏只有产物记录，本次引用不包含文件本体。</p>}
      </section>
      <section><h3>来源</h3>
        {material.sources.length ? <ul>{material.sources.map((source, index) => {
          const url = sourceUrl(source.url);
          return <li key={`${source.url}:${index}`}>{url
            ? <a href={url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
            : <span>{source.title || '未记录网址'}</span>}</li>;
        })}</ul> : <p>未记录来源</p>}
      </section>
    </article>
    <footer className="collection-reference-footer">
      {!onAdd && <small>本次引用快照</small>}
      {onAdd && <button className="collection-reference-add" type="button" disabled={alreadyAdded} onClick={onAdd}>
        {alreadyAdded ? '已加入当前问题' : '加入当前问题'}
      </button>}
    </footer>
  </>;
}
