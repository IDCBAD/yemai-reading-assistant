export const MOUSE_RIVER_DRAG_DISTANCE = 6;
export const TOUCH_RIVER_DRAG_DISTANCE = 8;
export const READING_CARD_RIVER_SPACING = 86;
export const MIN_LOOPING_RIVER_CARD_COUNT = 5;

export function initialReadingCardRiverPosition(_cardCount: number) {
  return 0;
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export interface RiverReaderPositionState {
  position: number;
  velocity: number;
  returnPosition: number | null;
}

export function canLoopReadingCardRiver(cardCount: number) {
  return cardCount >= MIN_LOOPING_RIVER_CARD_COUNT;
}

export function wrapRiverIndex(index: number, cardCount: number) {
  if (cardCount <= 0) return 0;
  return ((index % cardCount) + cardCount) % cardCount;
}

export function readingCardRiverRelative(
  index: number,
  position: number,
  cardCount: number,
  looping = canLoopReadingCardRiver(cardCount),
) {
  if (!looping || cardCount <= 1) return index - position;
  const rawRelative = index - wrapRiverIndex(position, cardCount);
  return wrapRiverIndex(rawRelative + cardCount / 2, cardCount) - cardCount / 2;
}

export function nearestReadingCardRiverPosition(
  position: number,
  index: number,
  cardCount: number,
) {
  if (!canLoopReadingCardRiver(cardCount)) return clampRiverPosition(index, cardCount);
  return position + readingCardRiverRelative(index, position, cardCount, true);
}

export function transitionRiverReaderPosition(
  state: RiverReaderPositionState,
  selectedIndex: number | null,
  cardCount: number,
): RiverReaderPositionState {
  if (selectedIndex === null) {
    return {
      position: state.returnPosition === null
        ? state.position
        : canLoopReadingCardRiver(cardCount)
          ? state.returnPosition
          : clampRiverPosition(state.returnPosition, cardCount),
      velocity: 0,
      returnPosition: null,
    };
  }
  return {
    position: nearestReadingCardRiverPosition(state.position, selectedIndex, cardCount),
    velocity: 0,
    returnPosition: state.returnPosition ?? state.position,
  };
}

export function riverDragActivationDistance(pointerType: string) {
  return pointerType === 'touch' ? TOUCH_RIVER_DRAG_DISTANCE : MOUSE_RIVER_DRAG_DISTANCE;
}

export function shouldActivateRiverDrag(deltaY: number, pointerType: string, alreadyActive = false) {
  return alreadyActive || Math.abs(deltaY) >= riverDragActivationDistance(pointerType);
}

export function shouldRepositionRiverOnFocus(focusVisible: boolean, returningFromReader = false) {
  return focusVisible && !returningFromReader;
}

export function clampRiverPosition(position: number, cardCount: number, allowOverscroll = false) {
  if (cardCount <= 1) return 0;
  const overscroll = allowOverscroll ? 0.5 : 0;
  return clamp(position, -overscroll, cardCount - 1 + overscroll);
}

export function readingCardRiverProgress(position: number, cardCount: number) {
  if (cardCount <= 1) return 1;
  return clamp(position / (cardCount - 1), 0, 1);
}

export function readingCardRiverWindow(center: number, cardCount: number, radius = 8) {
  const safeCenter = clamp(Math.round(center), 0, Math.max(cardCount - 1, 0));
  return {
    start: Math.max(0, safeCenter - radius),
    end: Math.min(cardCount, safeCenter + radius + 1),
  };
}

export function readingCardRiverWindowIndices(center: number, cardCount: number, radius = 8) {
  if (cardCount <= 0) return [];
  if (!canLoopReadingCardRiver(cardCount)) {
    const { start, end } = readingCardRiverWindow(center, cardCount, radius);
    return Array.from({ length: end - start }, (_, offset) => start + offset);
  }
  const count = Math.min(cardCount, radius * 2 + 1);
  if (count === cardCount) {
    return Array.from({ length: cardCount }, (_, index) => index);
  }
  const first = Math.round(center) - Math.floor(count / 2);
  return Array.from({ length: count }, (_, offset) => wrapRiverIndex(first + offset, cardCount))
    .sort((left, right) => left - right);
}

export function readingCardRiverSpacing(height: number, cardCount: number) {
  if (!canLoopReadingCardRiver(cardCount)) return READING_CARD_RIVER_SPACING;
  return clamp((height - 160) / Math.max(cardCount - 1, 1), READING_CARD_RIVER_SPACING, 132);
}

export function readingCardRiverRenderCoordinate(
  value: number,
  moving: boolean,
  devicePixelRatio = 1,
) {
  if (moving) return value;
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.round(value * pixelRatio) / pixelRatio;
}

export function shouldUpdateReadingCardRiverWindow(
  previousCenter: number,
  nextCenter: number,
  cardCount: number,
  radius = 8,
) {
  return previousCenter !== nextCenter && cardCount > radius * 2 + 1;
}

interface RiverCardPoseInput {
  index: number;
  position: number;
  width: number;
  height: number;
  spacing?: number;
  cardCount?: number;
  looping?: boolean;
}

export interface RiverCardPose {
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
  relative: number;
  outside: boolean;
}

export function readingCardRiverPose({
  index,
  position,
  width,
  height,
  spacing = READING_CARD_RIVER_SPACING,
  cardCount = 0,
  looping = canLoopReadingCardRiver(cardCount),
}: RiverCardPoseInput): RiverCardPose {
  const relative = readingCardRiverRelative(index, position, cardCount, looping);
  const anchorY = looping ? height * 0.5 : clamp(height * 0.13, 82, 126);
  const y = anchorY + relative * spacing;
  const amplitude = looping ? clamp(width * 0.07, 18, 34) : clamp(width * 0.135, 24, 56);
  const phase = looping
    ? relative * 0.72
    : (y / Math.max(height, 1)) * Math.PI * 1.62 - 0.82;
  const x = width / 2 + Math.sin(phase) * amplitude;
  const distance = Math.abs(relative);
  const edgeDistance = Math.abs(y - height / 2) / Math.max(height / 2, 1);
  const fadeEnd = looping
    ? clamp((cardCount * spacing) / Math.max(height, 1) - 0.02, 0.68, 1.04)
    : 1.04;
  const edgeFade = looping
    ? 1 - smoothstep(Math.max(0.42, fadeEnd - 0.24), fadeEnd, edgeDistance)
    : 1;
  const rotate = looping && distance > 1.15
    ? clamp(Math.sin(relative * 0.56) * 1.25, -1.25, 1.25)
    : 0;
  const scale = looping ? 1 - Math.min(Math.max(distance - 0.55, 0) * 0.012, 0.055) : 1;
  return {
    x,
    y,
    rotate,
    scale,
    opacity: edgeFade,
    relative,
    outside: edgeFade < 0.015 || y < -140 || y > height + 140,
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / Math.max(edge1 - edge0, Number.EPSILON), 0, 1);
  return progress * progress * (3 - 2 * progress);
}
