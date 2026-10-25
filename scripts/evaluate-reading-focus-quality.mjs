import { readFile, writeFile } from 'node:fs/promises';
import { decodeResponse, evaluate, loadFixtures, loadProduction, snapshotFor } from './reading-focus-quality/evaluation.mjs';

const args = process.argv.slice(2);
const supported = new Set(['--reference', '--response', '--baseline', '--write-prompt']);
const options = {};
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!supported.has(key) || options[key] !== undefined) throw new Error(`Unknown or duplicate argument: ${key}`);
  if (key === '--reference') options[key] = true;
  else {
    const path = args[++index];
    if (!path || path.startsWith('--')) throw new Error(`Expected a file path after ${key}`);
    options[key] = path;
  }
}
const modes = ['--reference', '--response', '--baseline'].filter((key) => options[key] !== undefined);
if (modes.length > 1 || (!modes.length && !options['--write-prompt'])) {
  throw new Error('Usage: node scripts/evaluate-reading-focus-quality.mjs [--reference | --response FILE | --baseline FILE] [--write-prompt FILE]');
}
const fixtures = await loadFixtures();
const production = await loadProduction();
try {
  if (options['--write-prompt']) await writeFile(options['--write-prompt'], production.buildPageReadingPrompt(snapshotFor(fixtures)), 'utf8');
  if (modes.length) {
    const reference = Boolean(options['--reference']);
    const response = reference
      ? { paragraphs: fixtures.map(({ id, referenceGroups }) => ({ id, groups: referenceGroups })) }
      : decodeResponse(await readFile(options['--response'] ?? options['--baseline'], 'utf8'));
    const report = evaluate(fixtures, response, production.parsePageReadingAnalysis, { baseline: Boolean(options['--baseline']), manualReference: reference });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.checks.passed !== report.checks.total || report.selectedCases === 0) process.exitCode = 1;
  }
} finally {
  await production.close();
}
