import { useEffect, useState } from 'react';
import type { ContextItem } from '../types';
import { attachmentFormatLabel } from '../fileTypes';
import { FileTypeIcon } from './FileTypeIcon';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';

interface ContextWorkbenchProps {
  items: ContextItem[];
  onIncludedChange: (id: string, included: boolean) => void;
  onRemove: (id: string) => void;
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

function itemDetail(item: ContextItem) {
  if (item.issue) return item.issue;
  if (item.kind === 'page') return item.page.url;
  if (item.kind === 'selection') return item.selection.text;
  if (item.kind === 'file' || item.kind === 'image') {
    return `${attachmentFormatLabel(item.attachment.filename, item.attachment.mime)} · ${item.attachment.sizeLabel}`;
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
}: {
  item: ContextItem;
  inspecting: boolean;
  onInspect: () => void;
  onIncludedChange: (included: boolean) => void;
  onRemove: () => void;
}) {
  const removable = item.kind !== 'page' || item.role !== 'current';
  const statusLabel = item.status === 'preparing'
    ? '正在准备'
    : item.status === 'failed'
      ? '准备失败'
      : item.included ? '已包含' : '已排除';

  return (
    <div className={`context-token is-${item.kind} is-${item.status}${item.included ? '' : ' is-excluded'}${inspecting ? ' is-inspecting' : ''}`}>
      <ContextItemIcon item={item} />
      <button
        className="context-token-main"
        type="button"
        onClick={onInspect}
        aria-expanded={inspecting}
        title={`查看详情：${itemTitle(item)}`}
      >
        <span className="context-token-title">
          <small>{KIND_LABEL[item.kind]}</small>
          <strong>{itemTitle(item)}</strong>
        </span>
        {inspecting && <span className="context-token-detail">{itemDetail(item)}</span>}
      </button>
      <span className={`context-token-status is-${item.status}`} aria-label={statusLabel} title={statusLabel}>
        {item.status === 'preparing' && <i aria-hidden="true" />}
        {item.status === 'failed' && <b aria-hidden="true">!</b>}
      </span>
      <button
        className="context-token-action pressable"
        type="button"
        onClick={() => onIncludedChange(!item.included)}
        aria-label={item.included ? `排除：${itemTitle(item)}` : `包含：${itemTitle(item)}`}
        aria-pressed={item.included}
        title={item.included ? '从本次问题中排除' : '重新加入本次问题'}
      >
        <KoboyoIcon name={item.included ? 'link' : 'link-off'} size={13} />
      </button>
      {removable && (
        <button
          className="context-token-action context-token-remove pressable"
          type="button"
          onClick={onRemove}
          aria-label={`删除：${itemTitle(item)}`}
          title="删除上下文"
        >
          <KoboyoIcon name="cross" size={10} />
        </button>
      )}
    </div>
  );
}

export function ContextWorkbench({ items, onIncludedChange, onRemove }: ContextWorkbenchProps) {
  const [expanded, setExpanded] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const includedCount = items.filter((item) => item.included).length;
  const currentPage = items.find((item) => item.kind === 'page' && item.role === 'current');
  const latestOther = [...items].reverse().find((item) => item.id !== currentPage?.id);
  const collapsedItems = [currentPage, latestOther].filter((item): item is ContextItem => Boolean(item));
  const visibleItems = expanded ? items : collapsedItems;

  useEffect(() => {
    if (items.length <= 2) setExpanded(false);
    if (inspectingId && !items.some((item) => item.id === inspectingId)) setInspectingId(null);
  }, [inspectingId, items]);

  if (!items.length) return null;

  return (
    <section className={`context-workbench${expanded ? ' is-expanded' : ''}`} aria-label="本次问题的上下文">
      {items.length > 2 && (
        <div className="context-workbench-header">
          <span>
            上下文
            <b>{includedCount}/{items.length}</b>
          </span>
          <button
            className="context-workbench-toggle pressable"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '收起' : `查看全部 ${items.length}`}
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
            key={item.id}
          />
        ))}
      </div>
    </section>
  );
}
