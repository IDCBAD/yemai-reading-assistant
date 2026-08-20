import { useState, type CSSProperties, type MouseEvent } from 'react';
import { formatMessageTimestamp } from '../messageTimestamp';

export interface ConversationPreviewRailItem {
  id: string;
  label: string;
  createdAt: number;
}

interface ConversationPreviewRailProps {
  items: ConversationPreviewRailItem[];
  activeId: string;
  onSelect: (id: string, behavior: ScrollBehavior) => void;
}

type RailStyle = CSSProperties & {
  '--conversation-turn-count': number;
};

type TickStyle = CSSProperties & {
  '--conversation-tick-scale': number;
};

type PreviewStyle = CSSProperties & {
  '--conversation-preview-ratio': number;
};

export function ConversationPreviewRail({ items, activeId, onSelect }: ConversationPreviewRailProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const previewId = hoveredId ?? focusedId;
  const highlightedId = previewId ?? activeId;
  const highlightedIndex = items.findIndex((item) => item.id === highlightedId);
  const previewIndex = previewId ? items.findIndex((item) => item.id === previewId) : -1;
  const previewItem = previewIndex >= 0 ? items[previewIndex] : undefined;
  const previewRatio = items.length <= 1 ? 0.5 : previewIndex / (items.length - 1);
  const rootStyle: RailStyle = { '--conversation-turn-count': items.length };

  const selectItem = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keyboardActivated = event.detail === 0;
    onSelect(id, reduceMotion || keyboardActivated ? 'auto' : 'smooth');
  };

  return (
    <nav
      className="conversation-preview-rail"
      style={rootStyle}
      aria-label="会话轮次导航"
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') setHoveredId(null);
      }}
    >
      <div className="conversation-preview-rail__ticks">
        {items.map((item, index) => {
          const selected = item.id === activeId;
          const highlighted = item.id === highlightedId;
          const distance = highlightedIndex < 0 ? Number.POSITIVE_INFINITY : Math.abs(index - highlightedIndex);
          const scale = highlighted ? 1 : distance === 1 ? 0.72 : distance === 2 ? 0.48 : 0.28;
          const tickStyle: TickStyle = { '--conversation-tick-scale': scale };
          return (
            <button
              className="conversation-preview-rail__item"
              type="button"
              style={tickStyle}
              aria-label={`跳转到第 ${index + 1} 轮：${item.label}`}
              aria-current={selected ? 'location' : undefined}
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') setHoveredId(item.id);
              }}
              onFocus={() => setFocusedId(item.id)}
              onBlur={() => setFocusedId(null)}
              onClick={(event) => selectItem(event, item.id)}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {previewItem && (
        <div
          className="conversation-preview-rail__preview"
          style={{ '--conversation-preview-ratio': previewRatio } as PreviewStyle}
          aria-hidden="true"
        >
          <div className="conversation-preview-rail__card">
            <span>第 {previewIndex + 1} 轮 · {formatMessageTimestamp(previewItem.createdAt).label}</span>
            <strong>{previewItem.label}</strong>
          </div>
        </div>
      )}
    </nav>
  );
}
