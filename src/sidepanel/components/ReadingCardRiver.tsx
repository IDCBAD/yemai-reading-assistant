import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ReadingCardRow } from '../../data/database';
import { formatMessageTimestamp } from '../messageTimestamp';
import {
  canLoopReadingCardRiver,
  clamp,
  clampRiverPosition,
  initialReadingCardRiverPosition,
  nearestReadingCardRiverPosition,
  readingCardRiverPose,
  readingCardRiverProgress,
  readingCardRiverRelative,
  readingCardRiverRenderCoordinate,
  readingCardRiverSpacing,
  readingCardRiverWindowIndices,
  READING_CARD_RIVER_SPACING,
  shouldActivateRiverDrag,
  shouldRepositionRiverOnFocus,
  shouldUpdateReadingCardRiverWindow,
  transitionRiverReaderPosition,
  wrapRiverIndex,
} from '../readingCardRiver';
import { readingCardKind } from '../readingCards';
import { PageFavicon } from './PageFavicon';

export type ReadingCardOpenModality = 'pointer' | 'keyboard' | 'programmatic';

interface ReadingCardRiverProps {
  cards: ReadingCardRow[];
  selectedCardId: string | null;
  paused?: boolean;
  onOpenCard: (cardId: string, modality: ReadingCardOpenModality) => void;
}

interface RiverRuntime {
  position: number;
  velocity: number;
  dragging: boolean;
  dragMoved: boolean;
  pressedCardId: string | null;
  pointerType: string;
  lastPointerY: number;
  lastPointerTime: number;
  lastFrameAt: number;
}

const RIVER_WINDOW_RADIUS = 8;

function cardKindLabel(card: ReadingCardRow) {
  return readingCardKind(card) === 'excerpt' ? '回答片段' : '完整回答';
}

export function ReadingCardRiver({ cards, selectedCardId, paused = false, onOpenCard }: ReadingCardRiverProps) {
  const initialPosition = initialReadingCardRiverPosition(cards.length);
  const initialCenter = Math.round(initialPosition);
  const looping = canLoopReadingCardRiver(cards.length);
  const [windowCenter, setWindowCenter] = useState(initialCenter);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const positionControlRef = useRef<HTMLDivElement>(null);
  const positionLabelRef = useRef<HTMLSpanElement>(null);
  const cardNodesRef = useRef(new Map<string, HTMLElement>());
  const avoidanceRef = useRef(new Map<string, { value: number; velocity: number }>());
  const cardsRef = useRef(cards);
  const selectedIdRef = useRef(selectedCardId);
  const pausedRef = useRef(paused);
  const hoveredIdRef = useRef<string | null>(null);
  const onOpenCardRef = useRef(onOpenCard);
  const pointerOpenedCardIdRef = useRef<string | null>(null);
  const readerReturnPositionRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const spacingRef = useRef(READING_CARD_RIVER_SPACING);
  const windowCenterRef = useRef(initialCenter);
  const renderedWindowCenterRef = useRef(initialCenter);
  const visibleIndicesRef = useRef(readingCardRiverWindowIndices(
    initialCenter,
    cards.length,
    RIVER_WINDOW_RADIUS,
  ));
  const runtimeRef = useRef<RiverRuntime>({
    position: initialPosition,
    velocity: 0,
    dragging: false,
    dragMoved: false,
    pressedCardId: null,
    pointerType: 'mouse',
    lastPointerY: 0,
    lastPointerTime: 0,
    lastFrameAt: performance.now(),
  });

  cardsRef.current = cards;
  selectedIdRef.current = selectedCardId;
  pausedRef.current = paused;
  onOpenCardRef.current = onOpenCard;
  const visibleIndices = readingCardRiverWindowIndices(
    windowCenter,
    cards.length,
    RIVER_WINDOW_RADIUS,
  );
  visibleIndicesRef.current = visibleIndices;

  const commitWindowCenter = (nextCenter: number, cardCount: number) => {
    windowCenterRef.current = nextCenter;
    if (shouldUpdateReadingCardRiverWindow(
      renderedWindowCenterRef.current,
      nextCenter,
      cardCount,
      RIVER_WINDOW_RADIUS,
    )) {
      renderedWindowCenterRef.current = nextCenter;
      setWindowCenter(nextCenter);
    }
  };

  useEffect(() => {
    if (!paused) return;
    const runtime = runtimeRef.current;
    runtime.velocity = 0;
    runtime.dragging = false;
    runtime.dragMoved = false;
    runtime.pressedCardId = null;
    hoveredIdRef.current = null;
  }, [paused]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime.position = canLoopReadingCardRiver(cards.length)
      ? wrapRiverIndex(runtime.position, cards.length)
      : clampRiverPosition(runtime.position, cards.length);
    const nextCenter = canLoopReadingCardRiver(cards.length)
      ? Math.round(runtime.position)
      : clamp(Math.round(runtime.position), 0, Math.max(cards.length - 1, 0));
    commitWindowCenter(nextCenter, cards.length);
    const ids = new Set(cards.map((card) => card.id));
    for (const id of avoidanceRef.current.keys()) {
      if (!ids.has(id)) avoidanceRef.current.delete(id);
    }
  }, [cards]);

  useEffect(() => {
    const selectedIndex = selectedCardId
      ? cards.findIndex((card) => card.id === selectedCardId)
      : null;
    if (selectedIndex !== null && selectedIndex < 0) return;
    const runtime = runtimeRef.current;
    const nextState = transitionRiverReaderPosition({
      position: runtime.position,
      velocity: runtime.velocity,
      returnPosition: readerReturnPositionRef.current,
    }, selectedIndex, cards.length);
    runtime.position = nextState.position;
    runtime.velocity = nextState.velocity;
    readerReturnPositionRef.current = nextState.returnPosition;
    const nextCenter = canLoopReadingCardRiver(cards.length)
      ? Math.round(nextState.position)
      : clamp(Math.round(nextState.position), 0, Math.max(cards.length - 1, 0));
    commitWindowCenter(nextCenter, cards.length);
  }, [cards, selectedCardId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => { reducedMotionRef.current = motionQuery.matches; };
    syncMotionPreference();
    motionQuery.addEventListener('change', syncMotionPreference);

    const initialBounds = viewport.getBoundingClientRect();
    const viewportSize = { width: initialBounds.width, height: initialBounds.height };
    const pathLayout = { width: -1, height: -1, cardCount: -1, spacing: -1 };
    let lastPositionLabel = '';

    const updatePath = (width: number, height: number, spacing: number, cardCount: number) => {
      if (!pathRef.current) return;
      if (
        pathLayout.width === width
        && pathLayout.height === height
        && pathLayout.cardCount === cardCount
        && pathLayout.spacing === spacing
      ) return;
      pathLayout.width = width;
      pathLayout.height = height;
      pathLayout.cardCount = cardCount;
      pathLayout.spacing = spacing;
      const points: string[] = [];
      for (let step = 0; step <= 20; step += 1) {
        const y = (height / 20) * step;
        const isLooping = canLoopReadingCardRiver(cardCount);
        const amplitude = isLooping ? clamp(width * 0.07, 18, 34) : clamp(width * 0.135, 24, 56);
        const phase = isLooping
          ? ((y - height / 2) / spacing) * 0.72
          : (y / Math.max(height, 1)) * Math.PI * 1.62 - 0.82;
        const x = width / 2 + Math.sin(phase) * amplitude;
        points.push(`${step === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      pathRef.current.setAttribute('d', points.join(' '));
    };

    const layoutCards = (deltaFactor = 1) => {
      const activeCards = cardsRef.current;
      const runtime = runtimeRef.current;
      const { width, height } = viewportSize;
      if (width <= 0 || height <= 0) return;
      const selectedId = selectedIdRef.current;
      const hoveredId = hoveredIdRef.current;
      const focusedId = selectedId ?? hoveredId;
      const focusedIndex = activeCards.findIndex((card) => card.id === focusedId);
      const spacing = readingCardRiverSpacing(height, activeCards.length);
      spacingRef.current = spacing;
      updatePath(width, height, spacing, activeCards.length);

      const isLooping = canLoopReadingCardRiver(activeCards.length);
      for (const index of visibleIndicesRef.current) {
        const card = activeCards[index];
        if (!card) continue;
        const node = cardNodesRef.current.get(card.id);
        if (!node) continue;
        const pose = readingCardRiverPose({
          index,
          position: runtime.position,
          width,
          height,
          cardCount: activeCards.length,
          looping: isLooping,
          spacing,
        });
        const avoidance = avoidanceRef.current.get(card.id) ?? { value: 0, velocity: 0 };
        avoidanceRef.current.set(card.id, avoidance);
        let targetAvoidance = 0;
        if (hoveredId && !selectedId && focusedIndex >= 0 && focusedIndex !== index) {
          const difference = readingCardRiverRelative(
            index,
            focusedIndex,
            activeCards.length,
            isLooping,
          );
          const strength = Math.exp(-(difference * difference) / (2 * 1.12 * 1.12));
          targetAvoidance = Math.sign(difference) * strength * 24;
        }
        if (reducedMotionRef.current) {
          avoidance.value = targetAvoidance;
          avoidance.velocity = 0;
        } else {
          const acceleration = (targetAvoidance - avoidance.value) * 0.14 * deltaFactor;
          avoidance.velocity = (avoidance.velocity + acceleration) * Math.pow(0.7, deltaFactor);
          avoidance.value += avoidance.velocity * deltaFactor;
        }

        const cardWidth = Math.min(390, Math.max(width - 76, 0));
        const cardHeight = 98;
        let x = pose.x;
        let y = pose.y + avoidance.value;
        let scale = pose.scale;
        let opacity = pose.opacity;

        if (selectedId) {
          x = width >= 560 ? 42 : 26;
          y = height / 2 + pose.relative * 50;
          scale = 0.34;
          opacity = card.id === selectedId ? 0.07 : 0.22;
        } else if (card.id === hoveredId) {
          y -= 3;
          scale = Math.max(scale, 1.012);
        }

        const outside = pose.outside;
        node.style.opacity = outside ? '0' : opacity.toFixed(3);
        node.style.pointerEvents = outside || selectedId || Math.abs(runtime.velocity) > 0.08 ? 'none' : 'auto';
        node.style.zIndex = String(card.id === focusedId ? 19 : Math.max(2, 15 - Math.round(Math.abs(pose.relative))));
        const moving = runtime.dragging
          || Math.abs(runtime.velocity) > 0.0015
          || Math.abs(avoidance.velocity) > 0.001;
        const translatedX = readingCardRiverRenderCoordinate(
          x - cardWidth / 2,
          moving,
          window.devicePixelRatio,
        );
        const translatedY = readingCardRiverRenderCoordinate(
          y - cardHeight / 2,
          moving,
          window.devicePixelRatio,
        );
        const translation = moving
          ? `translate3d(${translatedX.toFixed(3)}px, ${translatedY.toFixed(3)}px, 0)`
          : `translate(${translatedX.toFixed(3)}px, ${translatedY.toFixed(3)}px)`;
        if (selectedId) {
          node.style.transform = `${translation} scale(${scale.toFixed(3)})`;
        } else if (pose.rotate === 0 && scale === 1) {
          node.style.transform = translation;
        } else {
          node.style.transform = `${translation} rotate(${pose.rotate.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        }
        node.classList.toggle('is-river-hovered', card.id === hoveredId && !selectedId);
        node.inert = Boolean(outside || selectedId);
      }

      if (progressRef.current) {
        const progress = readingCardRiverProgress(runtime.position, activeCards.length);
        progressRef.current.style.transform = `scaleY(${Math.max(0.1, progress).toFixed(3)})`;
      }
      if (isLooping && positionLabelRef.current) {
        const currentPosition = wrapRiverIndex(Math.round(runtime.position), activeCards.length) + 1;
        const nextPositionLabel = `${currentPosition}/${activeCards.length}`;
        if (nextPositionLabel !== lastPositionLabel) {
          lastPositionLabel = nextPositionLabel;
          positionLabelRef.current.textContent = nextPositionLabel;
          positionControlRef.current?.setAttribute(
            'aria-label',
            `当前位置 ${currentPosition}，共 ${activeCards.length} 张收藏`,
          );
        }
      }
    };

    let frameId = 0;
    const lastLayout = {
      position: Number.NaN,
      cardCount: -1,
      selectedId: null as string | null,
      hoveredId: null as string | null,
      visibleIndices: '',
    };
    const tick = (now: number) => {
      const runtime = runtimeRef.current;
      const deltaFactor = clamp((now - runtime.lastFrameAt) / 16.667, 0.25, 2.25);
      runtime.lastFrameAt = now;
      const cardCount = cardsRef.current.length;
      const isLooping = canLoopReadingCardRiver(cardCount);

      if (!pausedRef.current && !runtime.dragging && !selectedIdRef.current && !reducedMotionRef.current && cardCount > 1) {
        runtime.position += runtime.velocity * deltaFactor;
        runtime.velocity *= Math.pow(0.895, deltaFactor);
        if (!isLooping && runtime.position < 0) {
          runtime.velocity += (0 - runtime.position) * 0.065 * deltaFactor;
          runtime.velocity *= Math.pow(0.78, deltaFactor);
        } else if (!isLooping && runtime.position > cardCount - 1) {
          runtime.velocity -= (runtime.position - (cardCount - 1)) * 0.065 * deltaFactor;
          runtime.velocity *= Math.pow(0.78, deltaFactor);
        }
        if (!isLooping) runtime.position = clampRiverPosition(runtime.position, cardCount, true);
        if (isLooping && Math.abs(runtime.position) > cardCount * 100) {
          runtime.position = wrapRiverIndex(runtime.position, cardCount);
        }
        if (Math.abs(runtime.velocity) < 0.0015 && (isLooping || (runtime.position >= 0 && runtime.position <= cardCount - 1))) {
          runtime.velocity = 0;
        }
      }
      const nextCenter = isLooping
        ? Math.round(runtime.position)
        : clamp(Math.round(runtime.position), 0, Math.max(cardCount - 1, 0));
      if (nextCenter !== windowCenterRef.current) {
        commitWindowCenter(nextCenter, cardCount);
      }
      const avoidanceMoving = [...avoidanceRef.current.values()]
        .some((motion) => Math.abs(motion.velocity) > 0.001);
      const selectedId = selectedIdRef.current;
      const hoveredId = hoveredIdRef.current;
      const visibleIndicesKey = visibleIndicesRef.current.join(',');
      const shouldLayout = runtime.dragging
        || avoidanceMoving
        || Math.abs(runtime.position - lastLayout.position) > 0.0001
        || cardCount !== lastLayout.cardCount
        || selectedId !== lastLayout.selectedId
        || hoveredId !== lastLayout.hoveredId
        || visibleIndicesKey !== lastLayout.visibleIndices;
      if (shouldLayout) {
        layoutCards(deltaFactor);
        lastLayout.position = runtime.position;
        lastLayout.cardCount = cardCount;
        lastLayout.selectedId = selectedId;
        lastLayout.hoveredId = hoveredId;
        lastLayout.visibleIndices = visibleIndicesKey;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    const onWheel = (event: WheelEvent) => {
      if (pausedRef.current || selectedIdRef.current || cardsRef.current.length <= 1) return;
      event.preventDefault();
      hoveredIdRef.current = null;
      const runtime = runtimeRef.current;
      if (reducedMotionRef.current) {
        const nextPosition = runtime.position + event.deltaY * 0.0045;
        runtime.position = canLoopReadingCardRiver(cardsRef.current.length)
          ? nextPosition
          : clampRiverPosition(nextPosition, cardsRef.current.length);
        runtime.velocity = 0;
      } else {
        runtime.velocity += clamp(event.deltaY, -120, 120) * 0.00145;
        runtime.velocity = clamp(runtime.velocity, -0.72, 0.72);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const runtime = runtimeRef.current;
      if ((event.target as Element).closest('.reading-card-river__position')) return;
      if (pausedRef.current || selectedIdRef.current || event.button !== 0 || runtime.dragging) return;
      runtime.dragging = true;
      runtime.dragMoved = false;
      runtime.pressedCardId = (event.target as Element).closest<HTMLElement>('[data-reading-card-id]')?.dataset.readingCardId ?? null;
      runtime.pointerType = event.pointerType;
      runtime.lastPointerY = event.clientY;
      runtime.lastPointerTime = performance.now();
      runtime.velocity = 0;
      viewport.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const runtime = runtimeRef.current;
      if (!runtime.dragging) return;
      const deltaY = runtime.lastPointerY - event.clientY;
      if (!shouldActivateRiverDrag(deltaY, runtime.pointerType, runtime.dragMoved) || deltaY === 0) return;
      event.preventDefault();
      const now = performance.now();
      const elapsed = Math.max(8, now - runtime.lastPointerTime);
      runtime.dragMoved = true;
      hoveredIdRef.current = null;
      const nextPosition = runtime.position + deltaY / spacingRef.current;
      runtime.position = canLoopReadingCardRiver(cardsRef.current.length)
        ? nextPosition
        : clampRiverPosition(nextPosition, cardsRef.current.length, true);
      runtime.velocity = reducedMotionRef.current
        ? 0
        : clamp((deltaY / spacingRef.current) * (16.667 / elapsed), -0.62, 0.62);
      runtime.lastPointerY = event.clientY;
      runtime.lastPointerTime = now;
    };

    const endDrag = (event: PointerEvent) => {
      const runtime = runtimeRef.current;
      if (!runtime.dragging) return;
      const releasedCardId = event.type === 'pointerup'
        ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-reading-card-id]')?.dataset.readingCardId
        : null;
      const cardIdToOpen = !runtime.dragMoved && releasedCardId === runtime.pressedCardId
        ? runtime.pressedCardId
        : null;
      runtime.dragging = false;
      runtime.pressedCardId = null;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (cardIdToOpen) {
        pointerOpenedCardIdRef.current = cardIdToOpen;
        onOpenCardRef.current(cardIdToOpen, 'pointer');
      }
      window.setTimeout(() => {
        runtime.dragMoved = false;
        pointerOpenedCardIdRef.current = null;
      }, 0);
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove, { passive: false });
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    const resizeObserver = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (bounds) {
        viewportSize.width = bounds.width;
        viewportSize.height = bounds.height;
      } else {
        const fallbackBounds = viewport.getBoundingClientRect();
        viewportSize.width = fallbackBounds.width;
        viewportSize.height = fallbackBounds.height;
      }
      layoutCards(1);
    });
    resizeObserver.observe(viewport);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      motionQuery.removeEventListener('change', syncMotionPreference);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', endDrag);
      viewport.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  const moveKeyboardFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = canLoopReadingCardRiver(cards.length)
      ? wrapRiverIndex(index + direction, cards.length)
      : clamp(index + direction, 0, cards.length - 1);
    const nextCard = cards[nextIndex];
    if (!nextCard) return;
    const runtime = runtimeRef.current;
    runtime.position = nearestReadingCardRiverPosition(runtime.position, nextIndex, cards.length);
    runtime.velocity = 0;
    const nextCenter = Math.round(runtime.position);
    commitWindowCenter(nextCenter, cards.length);
    window.requestAnimationFrame(() => {
      cardNodesRef.current.get(nextCard.id)?.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };

  return (
    <div
      className={`reading-card-river${looping ? ' is-looping' : ''}${selectedCardId ? ' has-reading-layer' : ''}`}
      ref={viewportRef}
      role="region"
      aria-label="收藏卡片河流，可使用滚轮或上下方向键浏览"
    >
      <svg className="reading-card-river__path" aria-hidden="true"><path ref={pathRef} /></svg>
      {!looping && <div className="reading-card-river__progress" aria-hidden="true"><span ref={progressRef} /></div>}
      {looping && (
        <div
          className="reading-card-river__position"
          ref={positionControlRef}
          aria-label={`当前位置 ${wrapRiverIndex(Math.round(windowCenter), cards.length) + 1}，共 ${cards.length} 张收藏`}
        >
          <span ref={positionLabelRef}>{wrapRiverIndex(Math.round(windowCenter), cards.length) + 1}/{cards.length}</span>
          <button
            type="button"
            onClick={() => {
              const runtime = runtimeRef.current;
              runtime.position = nearestReadingCardRiverPosition(runtime.position, 0, cards.length);
              runtime.velocity = 0;
              const nextCenter = Math.round(runtime.position);
              commitWindowCenter(nextCenter, cards.length);
            }}
          >回到最新</button>
        </div>
      )}
      <div className="reading-card-river__cards" role="list">
        {visibleIndices.map((index) => {
          const card = cards[index];
          if (!card) return null;
          return (
          <article
            className="reading-card-river__card"
            role="listitem"
            aria-posinset={index + 1}
            aria-setsize={cards.length}
            data-reading-card-id={card.id}
            key={card.id}
            ref={(node) => {
              if (node) cardNodesRef.current.set(card.id, node);
              else cardNodesRef.current.delete(card.id);
            }}
            style={{
              '--river-card-accent': readingCardKind(card) === 'excerpt' ? '#5579a8' : '#6d6595',
              '--river-card-soft': readingCardKind(card) === 'excerpt' ? '#eaf0f8' : '#efedf7',
            } as CSSProperties}
          >
            <span className="reading-card-river__accent" aria-hidden="true" />
            <button
              className="reading-card-river__open"
              type="button"
              aria-label={`阅读收藏：${card.title}`}
              onPointerEnter={() => {
                if (!selectedIdRef.current && Math.abs(runtimeRef.current.velocity) <= 0.045) hoveredIdRef.current = card.id;
              }}
              onPointerLeave={() => {
                if (hoveredIdRef.current === card.id) hoveredIdRef.current = null;
              }}
              onFocus={(event) => {
                const returningFromReader = event.currentTarget.dataset.riverFocusReturn === 'true';
                if (!shouldRepositionRiverOnFocus(
                  event.currentTarget.matches(':focus-visible'),
                  returningFromReader,
                )) return;
                runtimeRef.current.position = nearestReadingCardRiverPosition(
                  runtimeRef.current.position,
                  index,
                  cards.length,
                );
                runtimeRef.current.velocity = 0;
              }}
              onKeyDown={(event) => moveKeyboardFocus(event, index)}
              onClick={(event) => {
                if (pointerOpenedCardIdRef.current === card.id) {
                  pointerOpenedCardIdRef.current = null;
                  return;
                }
                onOpenCard(card.id, event.detail === 0 ? 'keyboard' : 'pointer');
              }}
            >
              <span className="reading-card-river__topline">
                <span className="reading-card-river__kind">{cardKindLabel(card)}</span>
                <span className="reading-card-river__source">{card.sources[0]?.title || '页脉回答'}</span>
                {looping && index === 0 && <span className="reading-card-river__latest">最新</span>}
              </span>
              <strong>{card.title}</strong>
              <span className="reading-card-river__excerpt">{card.excerpt}</span>
              <span className="reading-card-river__meta">
                <PageFavicon
                  className="reading-card-river__favicon"
                  url={card.sources[0]?.url ?? ''}
                  title={card.sources[0]?.title || '页脉回答'}
                  site={card.sources[0]?.site}
                  size={13}
                />
                <span>{card.sources[0]?.site || card.sources[0]?.title || '当前会话'}</span>
                <time dateTime={new Date(card.createdAt).toISOString()}>{formatMessageTimestamp(card.createdAt).label}</time>
              </span>
            </button>
          </article>
          );
        })}
      </div>
    </div>
  );
}
