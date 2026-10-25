import { readingGroupMetadata, SEMANTIC_LABELS, type ReadingFocusGroup } from '../../shared/readingFocus';

export interface ReadingHint { title: string; detail?: string }

// Stable meanings for old cached results. These never guess which conclusion a phrase refers to.
const CONNECTORS: Array<[string, string]> = [
  ['even if', '即使……也……'], ['even when', '即使……也……'],
  ['provided that', '只要……'], ['so that', '以便……'], ['such as', '例如……'],
  ['for example', '例如……'], ['based on', '基于……'], ['at least', '至少'],
  ['although', '虽然……'], ['unless', '除非……'], ['because', '因为……'],
  ['when', '当……时'], ['if', '如果……'],
];
const KIND_LABELS = { core: '核心信息', condition: '条件', reason: '原因／目的', detail: '补充说明' };

/** Keep the first hover useful and short; optional sentence detail is opened deliberately by the UI. */
export function readingHint(group: ReadingFocusGroup): ReadingHint | null {
  const metadata = readingGroupMetadata({ ...group });
  if (!metadata) return null;
  const detail = metadata.learningNote?.trim();
  if (metadata.cue) return { title: `${metadata.cue.text} · ${metadata.cue.meaning.trim()}`, ...(detail ? { detail } : {}) };
  if ((metadata.isCore ?? metadata.kind === 'core') && (!metadata.semantic || metadata.semantic === 'statement')) return null;
  const text = group.text.trimStart();
  const connector = CONNECTORS.find(([phrase]) => text.toLowerCase().startsWith(phrase)
    && !/[A-Za-z0-9_]/u.test(text[phrase.length] ?? ''));
  if (connector) return { title: `${text.slice(0, connector[0].length)} · ${connector[1]}`, ...(detail ? { detail } : {}) };
  return { title: metadata.semantic ? SEMANTIC_LABELS[metadata.semantic] : KIND_LABELS[metadata.kind],
    ...(detail ? { detail } : {}) };
}
