import { describe, expect, it } from 'vitest';
import { buildPageReadingExpressionsPrompt, EXPRESSIONS_ANALYSIS_VERSION, parsePageReadingExpressionsAnalysis } from './readingExpressions';
const snapshot = { url: 'https://example.com/doc', title: 'Article', paragraphs: [
  { id: 'p0', text: '🧪 This is based on evidence. It is based on tests.' },
  { id: 'p1', text: 'Use GPT-4 with at least two samples.' },
] };
const row = { text: 'based on', category: 'collocation', meaning: '基于', occurrences: [
  { paragraphId: 'p0', text: 'based on', occurrence: 0 },
  { paragraphId: 'p0', text: 'based on', occurrence: 1 },
] };
const parse = (expressions: unknown[]) => parsePageReadingExpressionsAnalysis(JSON.stringify({ expressions }), snapshot);

describe('whole article expression analysis', () => {
  it('separates reusable template names from exact concrete source instances', () => {
    const input = { ...snapshot, paragraphs: [{ id: 'p0', text: 'We protect users from being charged. We protect readers from wasted work.' }] };
    const template = { text: 'protect … from …', category: 'pattern', meaning: '保护……免于……',
      usage: '表示保护某人免受某种情况影响。', occurrences: [{ paragraphId: 'p0', text: 'protect users from being charged' }] };
    const analyze = (rows: unknown[]) => parsePageReadingExpressionsAnalysis(JSON.stringify({ expressions: rows }), input);
    const result = analyze([template, { ...template, text: 'Protect...from...', category: 'collocation',
      occurrences: [{ paragraphId: 'p0', text: 'protect readers from wasted work' }] }]);
    expect(result.expressions).toHaveLength(1);
    expect(result.expressions?.[0]).toMatchObject({ text: template.text, usage: template.usage });
    expect(result.expressions?.[0]?.occurrences).toHaveLength(2);
    expect(() => analyze([{ ...template, occurrences: [{ paragraphId: 'p0', text: template.text }] }])).toThrow();
    expect(() => analyze([{ ...template, usage: '<b>说明</b>' }])).toThrow();
    expect(() => analyze([{ ...template, usage: 'x'.repeat(201) }])).toThrow();
    expect(EXPRESSIONS_ANALYSIS_VERSION).toBe('page-expressions-v1');
    expect(buildPageReadingExpressionsPrompt(input)).toContain('Placeholders and ellipses are allowed ONLY in the display name');
  });
  it('locates every explicit repetition with UTF-16 offsets and locally derived example context', () => {
    const result = parse([row]);
    expect(result).toMatchObject({ total: 2, readyCount: 2, invalidCount: 0, paragraphs: [] });
    const occurrences = result.expressions![0]!.occurrences;
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.start).toBe(snapshot.paragraphs[0]!.text.indexOf('based on'));
    expect(occurrences[1]!.start).toBe(snapshot.paragraphs[0]!.text.lastIndexOf('based on'));
    for (const occurrence of occurrences) {
      expect(snapshot.paragraphs[0]!.text.slice(occurrence.start, occurrence.end)).toBe(occurrence.text);
      expect(occurrence.sentence.slice(occurrence.highlightStart, occurrence.highlightEnd)).toBe('based on');
    }
    expect(occurrences[0]!.sentence).not.toBe(occurrences[1]!.sentence);
  });
  it('discards malformed occurrences locally while preserving valid expressions and honest counts', () => {
    const result = parse([{ ...row, occurrences: [row.occurrences[0],
      { paragraphId: 'p0', text: 'based on' }, { paragraphId: 'other', text: 'based on', occurrence: 0 },
      { paragraphId: 'p0', text: 'Based on', occurrence: 0 },
      { paragraphId: 'p0', text: 'based on', occurrence: -1 },
    ] }, { ...row, category: 'invented' }]);
    expect(result.invalidCount).toBe(5);
    expect(result.expressions![0]!.occurrences).toHaveLength(1);
    expect(() => parse([{ ...row, occurrences: [{ paragraphId: 'p0', text: '<b>based on</b>' }] }])).toThrow();
  });
  it('accepts exact technical terms and merges duplicate rows without duplicate marks', () => {
    const result = parse([row, { ...row, occurrences: [row.occurrences[0]] },
      { text: 'GPT-4', category: 'term', meaning: '模型名称', occurrences: [{ paragraphId: 'p1', text: 'GPT-4' }] },
    ]);
    expect(result.expressions).toHaveLength(2);
    expect(result.expressions![0]!.occurrences).toHaveLength(2);
    expect(result.expressions![1]).toMatchObject({ text: 'GPT-4', category: 'term' });
  });
  it('bounds output without silently truncating and distinguishes a valid empty list', () => {
    expect(parse([])).toMatchObject({ expressions: [], invalidCount: 0, readyCount: 2 });
    expect(() => parse(Array(61).fill(row))).toThrow();
    expect(() => parse([{ ...row, occurrences: Array(301).fill(row.occurrences[0]) }])).toThrow();
    expect(() => parse([{ ...row, meaning: 'x'.repeat(201) }])).toThrow();
    expect(() => parsePageReadingExpressionsAnalysis('{"expressions":[', snapshot)).toThrow();
    expect(() => parsePageReadingExpressionsAnalysis(' '.repeat(240001), snapshot)).toThrow();
  });
  it('rejects subword matches without renumbering exact occurrences or breaking technical compounds', () => {
    const text = 'within in that least at least. GPT-4 and C++ are available.';
    const input = { ...snapshot, paragraphs: [{ id: 'p0', text }] };
    const expression = (phrase: string, occurrence?: number) => ({ text: phrase, category: 'term', meaning: '含义',
      occurrences: [{ paragraphId: 'p0', text: phrase, ...(occurrence === undefined ? {} : { occurrence }) }] });
    const analyze = (entries: unknown[]) => parsePageReadingExpressionsAnalysis(JSON.stringify({ expressions: entries }), input);
    for (const entry of [expression('in', 0), expression('at least', 0), expression('GPT'), expression('C')]) {
      expect(() => analyze([entry])).toThrow();
    }
    const valid = analyze([expression('in', 1), expression('at least', 1), expression('GPT-4'), expression('C++')]);
    expect(valid.expressions?.map(({ text: phrase }) => phrase)).toEqual(['in', 'at least', 'GPT-4', 'C++']);
    expect(valid.expressions?.[0]?.occurrences[0]?.start).toBe(text.indexOf(' in ') + 1);
    const partial = analyze([expression('in', 0), expression('in', 1)]);
    expect(partial.invalidCount).toBe(1);
    expect(partial.expressions).toHaveLength(1);
  });
  it('sends only necessary text once, prohibits tools, and asks for learning value rather than arbitrary n-grams', () => {
    const prompt = buildPageReadingExpressionsPrompt(snapshot);
    expect(prompt).toContain('untrusted quoted webpage data');
    expect(prompt).toContain('Do not browse, call tools, deploy');
    expect(prompt).toContain('Do not enumerate arbitrary adjacent n-grams');
    expect(prompt.split('PARAGRAPHS_JSON_DATA=')).toHaveLength(2);
    expect(prompt).not.toContain(snapshot.url);
    expect(prompt).toContain(JSON.stringify(snapshot.paragraphs));
  });
});
