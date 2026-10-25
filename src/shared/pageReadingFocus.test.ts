import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_VERSION, buildPageReadingPrompt, MAX_PAGE_READING_OUTPUT_LENGTH,
  pageReadingKey, pageReadingTaskView, parsePageReadingAnalysis, validatePageReadingSnapshot,
  type PageReadingSnapshot, type PageReadingTask,
} from './pageReadingFocus';

const snapshot: PageReadingSnapshot = {
  url: 'https://browser-use.com/posts/browser-agents', title: 'Browser agents',
  paragraphs: [
    { id: 'p0', text: "Use a script if there's no suitable API and the workflow is predictable." },
    { id: 'p1', text: '🧪 Agents can recover from errors.' },
  ],
};
const group = { text: 'Use a script', kind: 'core' };
const output = (paragraphs: unknown[] = [{ id: 'p0', groups: [group] }, { id: 'p1', groups: [] }]) => JSON.stringify({ paragraphs });

describe('page reading input and identity', () => {
  it('preserves original characters and semantic URLs, removes tracking and ordinary anchors', async () => {
    expect(validatePageReadingSnapshot(snapshot)).toEqual(snapshot);
    expect(validatePageReadingSnapshot({ ...snapshot, url: 'https://example.com/doc?chapter=2&utm_source=mail#intro' }).url)
      .toBe('https://example.com/doc?chapter=2');
    const base = { ...snapshot, url: 'https://example.com/doc?chapter=2#/part/1' };
    const key = await pageReadingKey(base, 'internal:agent:https://api.example.com');
    expect(key).toBe(await pageReadingKey({ ...base, title: 'Different title' }, 'internal:agent:https://api.example.com'));
    for (const changed of [
      { ...base, url: 'https://example.com/doc?chapter=3#/part/1' },
      { ...base, url: 'https://example.com/doc?chapter=2#/part/2' },
      { ...base, paragraphs: [...base.paragraphs].reverse() },
      { ...base, paragraphs: base.paragraphs.map((p) => ({ ...p, id: p.id + 'x' })) },
      { ...base, paragraphs: base.paragraphs.map((p) => ({ ...p, text: p.text + ' ' })) },
    ]) expect(await pageReadingKey(changed, 'internal:agent:https://api.example.com')).not.toBe(key);
    expect(await pageReadingKey(base, 'public:agent:https://api.example.com')).not.toBe(key);
    expect(await pageReadingKey(base, 'internal:other:https://api.example.com')).not.toBe(key);
    expect(await pageReadingKey(base, 'internal:agent:https://other.example.com')).not.toBe(key);
    // Identity includes the analysis version so future prompt changes invalidate cached data.
    const data = JSON.stringify([ANALYSIS_VERSION, 'groups', 'target', snapshot.url, snapshot.paragraphs.map(({ id, text }) => [id, text])]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    expect(await pageReadingKey(snapshot, 'target')).toBe('page-reading:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''));
  });

  it('rejects input beyond each bound without truncation', () => {
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: [] })).toThrow();
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: [{ id: 'p', text: 'x'.repeat(16001) }] })).toThrow('16000');
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: Array.from({ length: 241 }, (_, i) => ({ id: `p${i}`, text: 'abc' })) })).toThrow('240');
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, text: 'x'.repeat(15001) })) })).toThrow('60000');
    expect(validatePageReadingSnapshot({ ...snapshot, paragraphs: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, text: 'x'.repeat(15000) })) }).paragraphs).toHaveLength(4);
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: [{ id: 'p', text: 'bad\u0000text' }] })).toThrow();
    expect(() => validatePageReadingSnapshot({ ...snapshot, paragraphs: [snapshot.paragraphs[0], snapshot.paragraphs[0]] })).toThrow();
  });

  it('supplies paragraph data once and describes a compact, exact, tool-free response', () => {
    const prompt = buildPageReadingPrompt(snapshot);
    expect(prompt).toContain(`PARAGRAPHS_JSON_DATA=${JSON.stringify(snapshot.paragraphs)}`);
    expect(prompt.split('PARAGRAPHS_JSON_DATA=')).toHaveLength(2);
    expect(prompt).toContain('untrusted quoted webpage data');
    expect(prompt).toContain('Do not browse, use tools, deploy, translate');
    expect(prompt).toContain('Return every input paragraph id exactly once');
    expect(prompt).toContain('Do not return the original full paragraph or character offsets');
  });

  it('uses a new cache identity rather than treating v1 or v2 results as the sparse analysis', async () => {
    for (const version of ['page-reading-v1', 'page-reading-v2']) {
      const legacyData = JSON.stringify([version, 'target', snapshot.url, snapshot.paragraphs.map(({ id, text }) => [id, text])]);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyData));
      const legacyKey = 'page-reading:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(await pageReadingKey(snapshot, 'target')).not.toBe(legacyKey);
    }
  });

  it('keeps teaching examples separate from the article and demonstrates valid exact multiword roles', () => {
    const prompt = buildPageReadingPrompt(snapshot);
    const exampleLine = prompt.split('\n').find((line) => line.startsWith('TEACHING_EXAMPLES_JSON='))!;
    const examples = JSON.parse(exampleLine.slice('TEACHING_EXAMPLES_JSON='.length)) as Array<{
      text: string; groups: Array<{ text: string; kind: string }>;
    }>;
    const input = { ...snapshot, paragraphs: examples.map(({ text }, index) => ({ id: `example-${index}`, text })) };
    const result = parsePageReadingAnalysis(JSON.stringify({ paragraphs: examples.map(({ groups }, index) => ({ id: `example-${index}`, groups })) }), input);
    expect(result.invalidCount).toBe(0);
    expect(result.paragraphs.find(({ text }) => text.startsWith('Use an API when'))?.groups.map(({ kind }) => kind)).toEqual(['core', 'condition', 'core', 'condition']);
    expect(result.paragraphs.find(({ text }) => text.includes('Because the connection'))?.groups.map(({ kind }) => kind)).toEqual(['reason', 'core']);
    expect(result.paragraphs.find(({ text }) => text.includes('based on'))?.groups.at(-1)?.kind).toBe('detail');
    expect(result.paragraphs.find(({ text }) => text.startsWith('If the cache'))?.groups.at(-1)?.text).toContain('do not overwrite');
    expect(result.paragraphs.find(({ text }) => text === 'Variable Running Costs')?.groups).toEqual([]);
    expect(result.paragraphs.find(({ text }) => text.startsWith('A browser agent'))?.groups).toMatchObject([
      { kind: 'core', semantic: 'definition', text: 'A browser agent is software that uses an AI model to operate a web browser toward a goal' },
    ]);
    expect(result.paragraphs.find(({ text }) => text.startsWith('The report covers'))?.groups.map(({ kind }) => kind)).toEqual(['core', 'detail', 'core', 'detail']);
    const multiSentence = result.paragraphs.filter(({ text }) => text.split('. ').length > 1);
    expect(multiSentence.length).toBeGreaterThanOrEqual(2);
    for (const paragraph of multiSentence) {
      const covered = paragraph.groups.reduce((sum, item) => sum + item.text.length, 0);
      expect(covered / paragraph.text.length).toBeLessThan(.7);
      const sentences = [...paragraph.text.matchAll(/[^.]+(?:\.|$)/gu)];
      expect(sentences.some((sentence) => paragraph.groups.every(({ start, end }) =>
        end <= sentence.index! || start >= sentence.index! + sentence[0].length))).toBe(true);
    }
    expect(multiSentence.some(({ groups }) => groups[0]!.start > 0)).toBe(true);
    const short = result.paragraphs.find(({ text }) => text.startsWith('The main drawbacks'))!;
    expect(short.groups[0]?.text).toContain('are slow responses and high costs');
    expect(short.groups[0]!.text.length / short.text.length).toBeGreaterThan(.9);
    expect(JSON.parse(prompt.split('PARAGRAPHS_JSON_DATA=')[1]!)).toEqual(snapshot.paragraphs);
  });
});

describe('page reading exact output validation', () => {
  it('keeps optional learning cues separate from specific sentence details without invalidating old caches', () => {
    const text = 'Token charges are waived, even if the provider charges for processing.';
    const input = { ...snapshot, paragraphs: [{ id: 'p0', text }] };
    const concession = { text: 'even if the provider charges for processing', semantic: 'concession', isCore: false,
      cue: { text: 'even if', meaning: '即使……也……' }, learningNote: '即使提供商收费，也不改变前面的免计费结论。' };
    const analyze = (item: unknown) => parsePageReadingAnalysis(output([{ id: 'p0', groups: [item] }]), input);
    expect(analyze(concession).paragraphs[0]?.groups[0]).toMatchObject(concession);
    expect(ANALYSIS_VERSION).toBe('page-reading-v4');
    expect(analyze({ text: concession.text, semantic: 'concession', isCore: false, explanation: '让步：仍收费也不影响结论' }).readyCount).toBe(1);
    for (const extra of [
      { cue: { text: 'even when', meaning: '即使……也……' } },
      { cue: { text: 'if', meaning: '如果' } },
      { cue: { text: 'even if', meaning: 'x'.repeat(81) } },
      { cue: { text: 'even if', meaning: '<b>即使</b>' } },
      { learningNote: 'x'.repeat(241) }, { learningNote: '<script>bad</script>' },
    ]) expect(analyze({ ...concession, ...extra }).readyCount).toBe(0);
    const prompt = buildPageReadingPrompt(snapshot);
    expect(prompt).toContain('Do not explain every group');
    expect(prompt).toContain('never copy this conclusion into unrelated articles');
    expect(prompt).not.toContain('optional short Chinese role hint');
  });
  it('maps rich semantics locally and preserves exact cores independently from role', () => {
    const input = { ...snapshot, paragraphs: [{ id: 'p0', text: 'For audio requests, usable output means valid audio. Even when requests fail, search fees still apply.' }] };
    const result = parsePageReadingAnalysis(output([{ id: 'p0', groups: [
      { text: 'For audio requests', semantic: 'scope', isCore: false, kind: 'core' },
      { text: 'usable output means valid audio', semantic: 'definition', isCore: true, explanation: '核心定义' },
      { text: 'Even when requests fail', semantic: 'concession', isCore: false },
      { text: 'search fees still apply', semantic: 'statement', isCore: true },
    ] }]), input);
    expect(result.readyCount).toBe(1);
    expect(result.paragraphs[0]!.groups.map(({ kind }) => kind)).toEqual(['condition', 'core', 'detail', 'core']);
    expect(result.paragraphs[0]!.groups[1]).toMatchObject({ semantic: 'definition', isCore: true, explanation: '核心定义' });
    for (const bad of [{ semantic: 'unknown', isCore: false }, { semantic: 'condition' },
      { semantic: 'scope', isCore: false, explanation: 'x'.repeat(121) }]) {
      expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: 'For audio requests', ...bad }] }]), input).readyCount).toBe(0);
    }
  });
  it('separates mode cache identities and rejects unsupported modes', async () => {
    expect(await pageReadingKey(snapshot, 'target')).toBe(await pageReadingKey(snapshot, 'target', 'groups'));
    expect(await pageReadingKey(snapshot, 'target', 'groups')).not.toBe(await pageReadingKey(snapshot, 'target', 'expressions'));
    await expect(pageReadingKey(snapshot, 'target', 'other' as never)).rejects.toThrow();
  });
  it('rejects single vocabulary items without treating punctuation or technical compounds as extra words', () => {
    const text = "API-driven workflows call browser.use with C++ support. Don't overwrite this cache; use   scripts instead.";
    const input = { ...snapshot, paragraphs: [{ id: 'p0', text }, snapshot.paragraphs[1]!] };
    for (const phrase of ['API-driven', 'browser.use', 'C++', "Don't", 'API-driven workflows call']) {
      const result = parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: phrase, kind: 'core' }] }, { id: 'p1', groups: [] }]), input);
      const valid = phrase === 'API-driven workflows call';
      expect(result.paragraphs[0]?.status).toBe(valid ? 'ready' : 'invalid');
      expect(result.paragraphs[1]?.status).toBe('ready');
    }
    for (const phrase of ['API-driven workflows', 'with C++ support', "Don't overwrite", 'use   scripts']) {
      expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: phrase, kind: 'core' }] }]), input).paragraphs[0]?.status).toBe('ready');
    }
    const punctuation = { ...snapshot, paragraphs: [{ id: 'p0', text: 'API-driven !!! ...' }] };
    expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: 'API-driven !!!', kind: 'core' }] }]), punctuation).readyCount).toBe(0);
  });
  it('maps exact phrases to UTF-16 indices, preserving input paragraph order and legal empty results', () => {
    const result = parsePageReadingAnalysis(output([
      { id: 'p1', groups: [{ text: 'Agents can recover', kind: 'core' }] },
      { id: 'p0', groups: [group] },
    ]), snapshot);
    expect(result).toMatchObject({ total: 2, readyCount: 2, invalidCount: 0 });
    expect(result.paragraphs.map(({ id }) => id)).toEqual(['p0', 'p1']);
    expect(result.paragraphs[0]?.groups).toEqual([{ ...group, start: 0, end: 12 }]);
    expect(result.paragraphs[1]?.groups[0]).toMatchObject({ start: 3, end: 21 });
    expect(parsePageReadingAnalysis(`\`\`\`json\n${output()}\n\`\`\``, snapshot).readyCount).toBe(2);
  });

  it('requires explicit occurrence for repeated phrases and uses exact zero-based positions', () => {
    const repeated = { ...snapshot, paragraphs: [{ id: 'p0', text: 'Use a script. Use a script.' }] };
    const analyze = (phrase: unknown) => parsePageReadingAnalysis(output([{ id: 'p0', groups: [phrase] }]), repeated).paragraphs[0]!;
    expect(analyze(group).status).toBe('invalid');
    expect(analyze({ ...group, occurrence: 1 }).groups[0]).toMatchObject({ start: 14, end: 26 });
    expect(analyze({ ...group, occurrence: 0 }).groups[0]).toMatchObject({ start: 0, end: 12 });
    for (const occurrence of [-1, 2, 0.5, '0', null]) expect(analyze({ ...group, occurrence }).status).toBe('invalid');
  });

  it('degrades malformed or missing paragraphs locally without treating them as successful empty results', () => {
    for (const groups of [
      [{ ...group, text: 'use a script' }], [{ ...group, kind: 'unknown' }], [group, group],
      [{ text: 'workflow', kind: 'detail' }, group], [{ ...group, text: 'Use  a script' }],
      Array(33).fill(group), 'groups', [{ text: 'Us', kind: 'core' }],
    ]) {
      const result = parsePageReadingAnalysis(output([{ id: 'p0', groups }]), snapshot);
      expect(result).toMatchObject({ total: 2, readyCount: 0, invalidCount: 2 });
      expect(result.paragraphs[0]).toMatchObject({ status: 'invalid', groups: [] });
      expect(result.paragraphs[1]).toMatchObject({ status: 'missing', groups: [] });
    }
    expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [] }]), snapshot)).toMatchObject({ readyCount: 1, invalidCount: 1 });
  });

  it('rejects ambiguous IDs, malformed structure, excess output and excessive total groups', () => {
    for (const bad of [output([{ id: 'other', groups: [] }]), output([{ id: 'p0', groups: [] }, { id: 'p0', groups: [] }]),
      output([null]), 'explanation ' + output(), JSON.stringify({ groups: [] }), ' '.repeat(MAX_PAGE_READING_OUTPUT_LENGTH + 1)]) {
      expect(() => parsePageReadingAnalysis(bad, snapshot)).toThrow();
    }
    const large = { ...snapshot, paragraphs: Array.from({ length: 32 }, (_, i) => ({ id: `p${i}`, text: 'Use a script.' })) };
    expect(() => parsePageReadingAnalysis(output(large.paragraphs.map(({ id }) => ({ id, groups: Array(32).fill(group) }))), large)).toThrow();
  });

  it('rejects boundaries splitting surrogate pairs and never interprets model markup', () => {
    const unicode = { ...snapshot, paragraphs: [{ id: 'p0', text: 'abc🧪def' }] };
    expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: 'abc\ud83e', kind: 'core' }] }]), unicode).readyCount).toBe(0);
    expect(parsePageReadingAnalysis(output([{ id: 'p0', groups: [{ text: '<b>Use a script</b>', kind: 'core' }] }]), snapshot).readyCount).toBe(0);
  });

  it('exposes only public task data and returns an independent result copy', () => {
    const task: PageReadingTask = {
      id: 'key', snapshot, target: 'internal:agent:api', status: 'ready', remoteUuid: 'remote', runId: 'run',
      createdAt: 1, updatedAt: 2, result: parsePageReadingAnalysis(output(), snapshot), message: 'Ready',
    };
    const view = pageReadingTaskView(task);
    expect(view).toEqual({ id: 'key', status: 'ready', total: 2, readyCount: 2, invalidCount: 0, createdAt: 1, result: task.result, message: 'Ready' });
    expect(Object.keys(view)).not.toEqual(expect.arrayContaining(['target', 'snapshot', 'remoteUuid', 'runId']));
    view.result!.paragraphs[0]!.groups.length = 0;
    expect(task.result!.paragraphs[0]!.groups).toHaveLength(1);
  });
});
