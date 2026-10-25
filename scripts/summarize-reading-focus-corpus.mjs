import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { loadProduction } from './reading-focus-quality/evaluation.mjs';

const base = resolve('output/reading-focus-corpus');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function find(directory, name) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await find(file, name));
    else if (entry.name === name) result.push(file);
  }
  return result;
}

function paragraphMetrics(paragraph, raw) {
  const unmatched = paragraph.status === 'invalid'
    ? (raw?.paragraphs.find(({ id }) => id === paragraph.id)?.groups ?? [])
      .filter(({ text }) => !paragraph.text.includes(text)).map(({ text }) => text)
    : [];
  return {
    id: paragraph.id, status: paragraph.status, groups: paragraph.groups.length,
    coverage: paragraph.groups.reduce((sum, group) => sum + group.end - group.start, 0) / paragraph.text.length,
    maxCoreWords: Math.max(0, ...paragraph.groups.filter(({ kind }) => kind === 'core')
      .map(({ text }) => text.split(/\s+/).length)),
    invalidRawSpans: unmatched,
  };
}

async function runMetrics(file, production) {
  const run = await readJson(file);
  let raw;
  try { raw = JSON.parse(run.rawResponse); } catch { /* Invalid JSON is part of the evidence. */ }
  let candidateAnalysis;
  if (!run.result && run.rawResponse) {
    try {
      const snapshot = await readJson(join(dirname(file), 'snapshot.json'));
      const candidate = production.parsePageReadingAnalysis(run.rawResponse, snapshot);
      candidateAnalysis = {
        scope: 'Offline diagnostic only; does not confirm remote completion or change task status.',
        total: candidate.total, readyCount: candidate.readyCount, invalidCount: candidate.invalidCount,
      };
    } catch { candidateAnalysis = { scope: 'Offline diagnostic only', parseable: false }; }
  }
  const paragraphs = (run.result?.paragraphs ?? []).map((paragraph) => paragraphMetrics(paragraph, raw));
  return {
    id: run.id, status: run.status, reason: run.reason, analysisVersion: run.analysisVersion,
    conversationUuid: run.conversationUuid, durationMs: run.durationMs,
    createMs: run.events.find(({ type }) => type === 'submitting')?.elapsedMs,
    firstTextMs: run.events.find(({ type }) => type === 'first-text')?.elapsedMs,
    total: run.result?.total, readyCount: run.result?.readyCount, invalidCount: run.result?.invalidCount,
    highlightedCount: paragraphs.filter(({ groups }) => groups > 0).length,
    candidateAnalysis, paragraphs, file,
  };
}

const captures = [];
for (const file of await find(join(base, 'captures'), 'capture.json')) {
  const capture = await readJson(file);
  captures.push({
    id: capture.id, state: capture.state, evidence: capture.evidence, url: capture.finalUrl,
    capturedAt: capture.capturedAt, paragraphs: capture.snapshot.paragraphs.length,
    characters: capture.snapshot.paragraphs.reduce((sum, { text }) => sum + text.length, 0),
    selectedRoot: capture.selectedRoot, file,
  });
}
const failures = [];
for (const file of await find(join(base, 'captures'), 'failure.json')) {
  const failure = await readJson(file);
  failures.push({ id: failure.id, state: failure.state, url: failure.requestedUrl,
    startedAt: failure.startedAt, error: failure.error, file });
}
const production = await loadProduction();
const runs = [];
try {
  for (const file of await find(join(base, 'runs'), 'run.json')) runs.push(await runMetrics(file, production));
} finally { await production.close(); }
await mkdir(base, { recursive: true });
await writeFile(join(base, 'summary.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  limitations: 'Mechanical metrics only, not semantic accuracy. Excerpt probes are not full-page DOM tests. Empty groups can pass original-text validation.',
  captures, failures, runs,
}, null, 2)}\n`);
console.log(JSON.stringify({ captures: captures.length, failures: failures.length,
  runs: runs.map(({ id, status, total, readyCount, durationMs }) => ({ id, status, total, readyCount, durationMs })),
  output: join(base, 'summary.json'),
}, null, 2));
