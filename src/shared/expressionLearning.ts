// Kept independent of card storage: card captures may import display-name validation.
function isEnglishFragment(text: string): boolean {
  if (!/[a-z]/iu.test(text) || !/^[a-z0-9 '’+.#:()\-]+$/iu.test(text)
    || /(?:https?:\/\/|www\.|\.(?:com|org|net|io|ai|dev|app)(?:\s|$))/iu.test(text)) return false;
  let parentheses = 0;
  for (const token of text.split(/ +/u)) {
    for (const char of token) {
      if (char === '(' && ++parentheses > 1) return false;
      if (char === ')' && --parentheses < 0) return false;
    }
    if (!/^\(?[a-z0-9]+(?:['’:\-][a-z0-9]+|\.[a-z0-9]+)*(?:\+{1,2}|#|:)?\)?$/iu.test(token)) return false;
  }
  return parentheses === 0;
}

/** Display names may describe a reusable pattern; source occurrences never use this validator. */
export function isLearningExpressionName(value: string): boolean {
  if (typeof value !== 'string' || value.trim().length > 240 || /[\r\n\t\f\v\u2028\u2029]/u.test(value)) return false;
  const text = value.trim().replace(/\.{3}/gu, '…');
  if (!text || text.length > 240 || text.split(/\s+/u).length > 16) return false;
  if (!text.includes('…')) return isEnglishFragment(text);
  const pieces = text.split('…');
  if (pieces.length > 4 || !pieces[0]?.trim()) return false;
  // A template is made of valid English fragments and a few explicit variable slots.
  return pieces.every((piece, index) => !piece.trim()
    ? index === pieces.length - 1 : isEnglishFragment(piece.trim()));
}

export function normalizeLearningExpressionName(text: string): string {
  return text.trim().replace(/\.{3}/gu, '…').replace(/\s*…\s*/gu, ' … ')
    .replace(/\s+/gu, ' ').replace(/’/gu, "'").trim().toLowerCase();
}
