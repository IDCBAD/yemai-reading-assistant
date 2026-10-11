import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { conversationPreviewTop } from '../conversationRail';

export interface ConversationPreviewRailItem {
  id: string;
  label: string;
  createdAt: number;
  answerSummary?: string;
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

export function ConversationPreviewRail({ items, activeId, onSelect }: ConversationPreviewRailProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewTop, setPreviewTop] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewId = hoveredId ?? focusedId;
  const highlightedId = previewId ?? activeId;
  const highlightedIndex = items.findIndex((item) => item.id === highlightedId);
  const previewIndex = previewId ? items.findIndex((item) => item.id === previewId) : -1;
  const previewItem = previewIndex >= 0 ? items[previewIndex] : undefined;
  const rootStyle: RailStyle = { '--conversation-turn-count': items.length };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const popup = previewRef.current;
    const stage = root?.closest<HTMLElement>('.message-stage');
    const tick = root?.querySelectorAll<HTMLButtonElement>('.conversation-preview-rail__item')[previewIndex];
    if (!root || !popup || !stage || !tick) return;

    const placePreview = () => {
      const stageBounds = stage.getBoundingClientRect();
      // Constrain the card before measuring so a short message area cannot cover the composer.
      popup.style.setProperty('--conversation-preview-max-height', `${Math.max(0, stageBounds.height - 16)}px`);
      const rootBounds = root.getBoundingClientRect();
      const tickBounds = tick.getBoundingClientRect();
      const popupBounds = popup.getBoundingClientRect();
      setPreviewTop(conversationPreviewTop(
        tickBounds.top + tickBounds.height / 2,
        popupBounds.height,
        stageBounds.top,
        stageBounds.bottom,
      ) - rootBounds.top);
    };

    placePreview();
    const observer = new ResizeObserver(placePreview);
    observer.observe(root);
    observer.observe(popup);
    observer.observe(stage);
    window.addEventListener('resize', placePreview);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', placePreview);
    };
  }, [previewIndex, previewItem?.id, previewItem?.label, previewItem?.answerSummary, items.length, items[0]?.id]);

  const selectItem = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keyboardActivated = event.detail === 0;
    onSelect(id, reduceMotion || keyboardActivated ? 'auto' : 'smooth');
  };

  return (
    <nav
      ref={rootRef}
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
              key={item.id}
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
          ref={previewRef}
          className="conversation-preview-rail__preview"
          style={{ top: previewTop }}
          aria-hidden="true"
        >
          <div className="conversation-preview-rail__card">
            <strong>{previewItem.label}</strong>
            {previewItem.answerSummary && <p>{previewItem.answerSummary}</p>}
          </div>
        </div>
      )}
    </nav>
  );
}
