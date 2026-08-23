export interface SearchTextMatch {
  start: number;
  end: number;
}

const SEARCH_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function normalizeSearchTextWithOffsets(value: string) {
  let normalized = '';
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  let originalOffset = 0;

  for (const character of value) {
    const normalizedCharacter = character.normalize('NFKC').toLocaleLowerCase();
    normalized += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      originalStarts.push(originalOffset);
      originalEnds.push(originalOffset + character.length);
    }
    originalOffset += character.length;
  }

  return { normalized, originalStarts, originalEnds };
}

export function normalizeSearchLiteral(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

export function segmentSearchWords(value: string) {
  const normalized = normalizeSearchLiteral(value);
  return [...new Set([...SEARCH_SEGMENTER.segment(normalized)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment))];
}

export function isStructuredSearchLiteral(value: string) {
  const normalized = normalizeSearchLiteral(value);
  return normalized.length >= 4
    && !/\s/u.test(normalized)
    && /[-/:.@_]/u.test(normalized)
    && segmentSearchWords(normalized).length >= 2;
}

export function findSearchTextMatches(
  value: string,
  query: string,
  matchedTerms: string[],
  limit = 40,
): SearchTextMatch[] {
  const normalizedValue = normalizeSearchTextWithOffsets(value);
  const normalizedQuery = normalizeSearchLiteral(query);

  const toOriginalRange = (start: number, end: number): SearchTextMatch | undefined => {
    const originalStart = normalizedValue.originalStarts[start];
    const originalEnd = normalizedValue.originalEnds[end - 1];
    return originalStart === undefined || originalEnd === undefined
      ? undefined
      : { start: originalStart, end: originalEnd };
  };

  if (isStructuredSearchLiteral(normalizedQuery)) {
    const matches: SearchTextMatch[] = [];
    let cursor = 0;
    while (cursor < normalizedValue.normalized.length && matches.length < limit) {
      const index = normalizedValue.normalized.indexOf(normalizedQuery, cursor);
      if (index < 0) break;
      const range = toOriginalRange(index, index + normalizedQuery.length);
      if (range) matches.push(range);
      cursor = index + normalizedQuery.length;
    }
    if (matches.length > 0) return matches;
  }

  const collectWordMatches = (rawTerms: string[]) => {
    const terms = new Set(rawTerms
    .map((term) => normalizeSearchLiteral(term))
    .filter(Boolean));
    const matches: SearchTextMatch[] = [];
    for (const segment of SEARCH_SEGMENTER.segment(normalizedValue.normalized)) {
      if (matches.length >= limit) break;
      if (!segment.isWordLike || !terms.has(segment.segment)) continue;
      const range = toOriginalRange(segment.index, segment.index + segment.segment.length);
      if (range) matches.push(range);
    }
    return matches;
  };

  const queryMatches = collectWordMatches(segmentSearchWords(query));
  return queryMatches.length > 0 ? queryMatches : collectWordMatches(matchedTerms);
}
