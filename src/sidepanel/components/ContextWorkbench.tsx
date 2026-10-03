import { lazy, Suspense, useEffect, useState } from 'react';
import type { CollectionMaterial, ContextItem } from '../types';
import { attachmentFormatLabel, uploadChannelLabel } from '../fileTypes';
import { FileTypeIcon } from './FileTypeIcon';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';

const CollectionMaterialDialog = lazy(() => import('./CollectionMaterialDialog').then((module) => ({ default: module.CollectionMaterialDialog })));

interface ContextWorkbenchProps {
  items: ContextItem[];
  onIncludedChange: (id: string, included: boolean) => void;
  onRemove: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  collectionMaterials?: CollectionMaterial[];
  onCollectionIncludedChange?: (id: string, included: boolean) => void;
  onRemoveCollectionMaterial?: (id: string) => void;
}

const KIND_LABEL: Record<ContextItem['kind'], string> = {
  page: '当前页',
  selection: '划词',
  file: '文件',
  image: '图片',
  memory: '历史',
  link: '链接',
};

function itemTitle(item: ContextItem) {
  if (item.kind === 'page') return item.page.title || item.page.site || item.page.url;
  if (item.kind === 'selection') return item.selection.pageTitle || item.selection.text;
  if (item.kind === 'file' || item.kind === 'image') return item.attachment.filename;
  if (item.kind === 'memory') return item.memory.title;
  return item.link.title || item.link.url;
}

function itemKindLabel(item: ContextItem) {
  if (item.kind === 'selection' && item.selection.origin === 'assistant') return '回答';
  return KIND_LABEL[item.kind];
}

function itemDetail(item: ContextItem) {
  if (item.issue) return item.issue;
  if (item.kind === 'page') return item.page.url;
  if (item.kind === 'selection') return item.selection.text;
  if (item.kind === 'file' || item.kind === 'image') {
    const channel = item.attachment.status === 'ready'
      ? ` · 已通过${uploadChannelLabel(item.attachment.uploadTransport)}上传`
      : '';
    return `${attachmentFormatLabel(item.attachment.filename, item.attachment.mime)} · ${item.attachment.sizeLabel}${channel}`;
  }
  if (item.kind === 'memory') return item.memory.excerpt;
  return item.link.url;
}

function ContextImageIcon({ item }: { item: Extract<ContextItem, { kind: 'image' }> }) {
  const source = item.attachment.previewUrl ?? item.attachment.url;
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [source]);

  if (!source || previewFailed) {
    return (
      <FileTypeIcon
        filename={item.attachment.filename}
        mime={item.attachment.mime}
        variant="token"
        className="context-token-file"
      />
    );
  }

  return (
    <span className="context-token-image" aria-hidden="true">
      <img
        src={source}
        alt=""
        width="24"
        height="24"
        draggable={false}
        onError={() => setPreviewFailed(true)}
      />
    </span>
  );
}

function ContextItemIcon({ item }: { item: ContextItem }) {
  if (item.kind === 'page') {
    return <PageFavicon url={item.page.url} title={item.page.title} site={item.page.site} size={18} />;
  }
  if (item.kind === 'selection') {
    return <span className="context-token-glyph"><KoboyoIcon name="quote" size={13} /></span>;
  }
  if (item.kind === 'file' || item.kind === 'image') {
    if (item.kind === 'image') return <ContextImageIcon item={item} />;
    return (
      <FileTypeIcon
        filename={item.attachment.filename}
        mime={item.attachment.mime}
        variant="token"
        className="context-token-file"
      />
    );
  }
  return (
    <span className="context-token-glyph">
      <KoboyoIcon name={item.kind === 'link' ? 'link' : 'archive'} size={13} />
    </span>
  );
}

function ContextToken({
  item,
  inspecting,
  onInspect,
  onIncludedChange,
  onRemove,
  onRetryAttachment,
}: {
  item: ContextItem;
  inspecting: boolean;
  onInspect: () => void;
  onIncludedChange: (included: boolean) => void;
  onRemove: () => void;
  onRetryAttachment: () => void;
}) {
  const removable = item.kind !== 'page' || item.role !== 'current';
  const retryable = (item.kind === 'file' || item.kind === 'image') && item.status === 'failed';
  const statusLabel = item.status === 'preparing'
    ? '正在准备'
    : item.status === 'failed'
      ? '准备失败'
      : item.included ? '已包含' : '已排除';

  return (
    <div className={`context-token is-${item.kind} is-${item.status}${item.included ? '' : ' is-excluded'}${inspecting ? ' is-inspecting' : ''}${retryable ? ' is-retryable' : ''}`}>
      <ContextItemIcon item={item} />
      <button
        className="context-token-main"
        type="button"
        onClick={onInspect}
        aria-expanded={inspecting}
        title={`查看详情：${itemTitle(item)}`}
      >
        <span className="context-token-title">
          <small>{itemKindLabel(item)}</small>
          <strong>{itemTitle(item)}</strong>
        </span>
        {inspecting && <span className="context-token-detail">{itemDetail(item)}</span>}
      </button>
      <span className={`context-token-status is-${item.status}`} aria-label={statusLabel} title={statusLabel}>
        {item.status === 'preparing' && <i aria-hidden="true" />}
        {item.status === 'failed' && <b aria-hidden="true">!</b>}
      </span>
      {retryable && (
        <button
          className="context-token-retry pressable"
          type="button"
          onClick={onRetryAttachment}
          aria-label={`重试上传：${itemTitle(item)}`}
        >
          <KoboyoIcon name="cycle" size={12} />
          <span>重试</span>
        </button>
      )}
      <IconTooltipButton
        className="context-token-action pressable"
        type="button"
        onClick={() => onIncludedChange(!item.included)}
        aria-label={item.included ? `排除：${itemTitle(item)}` : `包含：${itemTitle(item)}`}
        aria-pressed={item.included}
        tooltip={item.included ? '本次不引用' : '重新引用'}
      >
        <KoboyoIcon name={item.included ? 'link' : 'link-off'} size={13} />
      </IconTooltipButton>
      {removable && (
        <IconTooltipButton
          className="context-token-action context-token-remove pressable"
          type="button"
          onClick={onRemove}
          aria-label={`删除：${itemTitle(item)}`}
          tooltip="移除引用"
        >
          <KoboyoIcon name="cross" size={10} />
        </IconTooltipButton>
      )}
    </div>
  );
}

export function ContextWorkbench({ items, onIncludedChange, onRemove, onRetryAttachment,
  collectionMaterials = [], onCollectionIncludedChange, onRemoveCollectionMaterial }: ContextWorkbenchProps) {
  const [expanded, setExpanded] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [inspectingCollectionId, setInspectingCollectionId] = useState<string | null>(null);
  const inspectingCollection = collectionMaterials.find((material) => material.cardId === inspectingCollectionId);
  const count = items.length + collectionMaterials.length;
  const includedCount = items.filter((item) => item.included).length
    + collectionMaterials.filter((material) => material.included !== false).length;
  const currentPage = items.find((item) => item.kind === 'page' && item.role === 'current');
  const latestOther = [...items].reverse().find((item) => item.id !== currentPage?.id);
  const collapsedItems = [currentPage, collectionMaterials.length ? undefined : latestOther].filter((item): item is ContextItem => Boolean(item));
  const visibleItems = expanded || count <= 2 ? items : collapsedItems;
  const visibleCollections = expanded || count <= 2 ? collectionMaterials : collectionMaterials.slice(-1);

  useEffect(() => {
    if (count <= 2) setExpanded(false);
    if (inspectingId && !items.some((item) => item.id === inspectingId)) setInspectingId(null);
  }, [count, inspectingId, items]);

  if (!count) return null;

  return (
    <section className={`context-workbench${expanded ? ' is-expanded' : ''}`} aria-label="本次问题的上下文">
      {count > 2 && (
        <div className="context-workbench-header">
          <span>
            上下文
            <b>{includedCount}/{count}</b>
          </span>
          <button
            className="context-workbench-toggle pressable"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '收起' : `查看全部 ${count}`}
          </button>
        </div>
      )}
      <div className="context-token-list">
        {visibleItems.map((item) => (
          <ContextToken
            item={item}
            inspecting={inspectingId === item.id}
            onInspect={() => setInspectingId((current) => current === item.id ? null : item.id)}
            onIncludedChange={(included) => onIncludedChange(item.id, included)}
            onRemove={() => onRemove(item.id)}
            onRetryAttachment={() => onRetryAttachment(item.id)}
            key={item.id}
          />
        ))}
        {visibleCollections.map((material) => {
          const included = material.included !== false;
          return <div className={`context-token is-collection is-ready${included ? '' : ' is-excluded'}`} key={material.cardId}>
            <span className="context-token-glyph"><KoboyoIcon name="archive" size={13} /></span>
            <button className="context-token-main" type="button" onClick={() => setInspectingCollectionId(material.cardId)}
              aria-label={`查看收藏引用：${material.title}`} aria-haspopup="dialog">
              <span className="context-token-title"><small>收藏</small><strong>{material.title}</strong></span>
            </button>
            <span className="context-token-status is-ready" aria-label={included ? '已包含' : '已排除'} />
            <IconTooltipButton className="context-token-action pressable" type="button"
              onClick={() => onCollectionIncludedChange?.(material.cardId, !included)} aria-pressed={included}
              aria-label={`${included ? '排除' : '包含'}：${material.title}`} tooltip={included ? '本次不引用' : '重新引用'}>
              <KoboyoIcon name={included ? 'link' : 'link-off'} size={13} />
            </IconTooltipButton>
            <IconTooltipButton className="context-token-action context-token-remove pressable" type="button"
              onClick={() => onRemoveCollectionMaterial?.(material.cardId)} aria-label={`删除：${material.title}`} tooltip="移除引用">
              <KoboyoIcon name="cross" size={10} />
            </IconTooltipButton>
          </div>;
        })}
      </div>
      {inspectingCollection && <Suspense fallback={null}><CollectionMaterialDialog
        material={inspectingCollection} onClose={() => setInspectingCollectionId(null)} /></Suspense>}
    </section>
  );
}
