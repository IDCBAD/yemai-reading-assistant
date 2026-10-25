import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const fixturePath = fileURLToPath(new URL('./fixtures.json', import.meta.url));
export const loadFixtures = async () => JSON.parse(await readFile(fixturePath, 'utf8'));

export async function loadProduction() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = await createServer({
    configFile: false, root,
    cacheDir: fileURLToPath(new URL('../../node_modules/.vite-reading-quality', import.meta.url)),
    logLevel: 'silent', optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true }, appType: 'custom',
  });
  try {
    const production = await server.ssrLoadModule('/src/shared/pageReadingFocus.ts');
    return { ...production, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

// Clipboard exports may contain a JSON string holding the actual JSON object.
export function decodeResponse(text) {
  const trimmed = text.trim();
  const unfenced = trimmed.startsWith('```') ? /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)?.[1] : trimmed;
  let value = JSON.parse(unfenced ?? '');
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || !Array.isArray(value.paragraphs)) throw new Error('Expected a JSON object with paragraphs.');
  return value;
}

export const snapshotFor = (fixtures) => ({
  url: 'https://reading-quality.invalid/fixtures',
  title: 'Offline reading focus quality cases',
  paragraphs: fixtures.map(({ id, text }) => ({ id, text })),
});

const countWords = (text) => text.match(/[\p{L}\p{N}]+(?:['’‑-][\p{L}\p{N}]+)*/gu)?.length ?? 0;

/** This checks declared reading requirements, not a unique gold segmentation or model accuracy. */
export function evaluate(fixtures, response, parsePageReadingAnalysis, { baseline = false, manualReference = false } = {}) {
  const known = new Set(fixtures.map(({ id }) => id));
  const provided = new Set(response.paragraphs.map(({ id }) => id));
  const ignoredParagraphs = baseline ? response.paragraphs.filter(({ id }) => !known.has(id)).length : 0;
  const selected = baseline ? fixtures.filter(({ id }) => provided.has(id)) : fixtures;
  const skipped = baseline ? fixtures.filter(({ id }) => !provided.has(id)) : [];
  const payload = baseline ? { paragraphs: response.paragraphs.filter(({ id }) => known.has(id)) } : response;
  let parsed;
  let parseError;
  if (selected.length) {
    try { parsed = parsePageReadingAnalysis(JSON.stringify(payload), snapshotFor(selected)); }
    catch (error) { parseError = error.message; }
  }
  const cases = fixtures.map((fixture) => {
    if (skipped.includes(fixture)) return { id: fixture.id, source: fixture.source, skipped: true, reason: 'Not present in supplied baseline; not measured.', checks: { passed: 0, total: 0 } };
    const paragraph = parsed?.paragraphs.find(({ id }) => id === fixture.id);
    const groups = paragraph?.groups ?? [];
    const coverage = groups.reduce((sum, group) => sum + group.end - group.start, 0) / fixture.text.length;
    const maxCoreWords = Math.max(0, ...groups.filter(({ kind }) => kind === 'core').map(({ text }) => countWords(text)));
    const checks = [];
    const add = (name, passed, detail) => checks.push({ name, passed, ...(passed ? {} : { error: detail }) });
    add('production-parser', paragraph?.status === 'ready', parseError ?? `Paragraph status: ${paragraph?.status ?? 'unavailable'}`);
    for (const required of fixture.required) {
      const starts = [];
      for (let start = fixture.text.indexOf(required.text); start !== -1; start = fixture.text.indexOf(required.text, start + 1)) starts.push(start);
      const found = groups.some((group) => group.kind === required.kind && starts.some((start) => group.start <= start && group.end >= start + required.text.length));
      add(`required:${required.kind}:${required.text}`, found, `Missing complete ${required.kind} span: ${required.text}`);
    }
    for (const [left, right] of fixture.separate) {
      const merged = groups.some((group) => group.text.includes(left) && group.text.includes(right));
      add(`separate:${left}|${right}`, !merged, 'Distinct roles were merged into one group.');
    }
    if (fixture.expectEmpty) add('empty-heading', groups.length === 0 && paragraph?.status === 'ready', 'Standalone heading should remain uncolored.');
    if (fixture.maxCoverage !== undefined) add('fixture:max-coverage', coverage <= fixture.maxCoverage, `Observed coverage ${coverage.toFixed(4)} exceeds this fixture's limit ${fixture.maxCoverage}.`);
    if (fixture.maxCoreWords !== undefined) add('fixture:max-core-words', maxCoreWords <= fixture.maxCoreWords, `Longest core has ${maxCoreWords} words; this fixture allows ${fixture.maxCoreWords}.`);
    return {
      id: fixture.id, source: fixture.source, skipped: false,
      checks: { passed: checks.filter(({ passed }) => passed).length, total: checks.length },
      errors: checks.filter(({ passed }) => !passed),
      groupCount: groups.length,
      coverage, maxCoreWords,
      limits: { ...(fixture.maxCoverage === undefined ? {} : { maxCoverage: fixture.maxCoverage }), ...(fixture.maxCoreWords === undefined ? {} : { maxCoreWords: fixture.maxCoreWords }) },
    };
  });
  const totals = cases.reduce((sum, item) => ({ passed: sum.passed + item.checks.passed, total: sum.total + item.checks.total }), { passed: 0, total: 0 });
  // Diagnostic only: a long multi-sentence block can legitimately be dense. Limits above
  // are declared case by case; neither metric changes the supplied model response.
  const lengthyProse = cases.filter((item) => !item.skipped && fixtures.find(({ id, text }) => id === item.id && text.length >= 120 && (text.match(/[.!?](?:\s|$)/g)?.length ?? 0) >= 2));
  return {
    mode: manualReference ? 'manualReference' : 'providedResponse',
    scope: baseline ? 'baselineSubset' : 'allFixtures',
    note: 'Checks cover declared requirements and exact source mapping. They are not model accuracy or a claim of improved real-model behavior.',
    selectedCases: selected.length, totalFixtureCases: fixtures.length, ignoredParagraphs,
    skippedCases: skipped.map(({ id }) => id),
    unmeasuredTransferCases: skipped.filter(({ source }) => source === 'authored-transfer').map(({ id }) => id),
    checks: totals, cases,
    diagnostics: {
      selectedLengthyProseCount: lengthyProse.length,
      selectedLengthyProseOver90: lengthyProse.filter(({ coverage }) => coverage > 0.9).map(({ id, coverage, maxCoreWords }) => ({ id, coverage, maxCoreWords })),
      note: 'Lengthy prose means at least 120 characters and two sentence-ending punctuation marks. Over 90% coverage is diagnostic only; failures use explicit fixture limits.',
    },
  };
}
