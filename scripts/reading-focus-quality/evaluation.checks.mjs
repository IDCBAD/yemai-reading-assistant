import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { decodeResponse, evaluate, loadFixtures, loadProduction } from './evaluation.mjs';

const fixtures = await loadFixtures();
const production = await loadProduction();
after(() => production.close());
const reference = () => ({ paragraphs: fixtures.map(({ id, referenceGroups }) => ({ id, groups: structuredClone(referenceGroups) })) });
const score = (response, options) => evaluate(fixtures, response, production.parsePageReadingAnalysis, options);
const edit = (response, id, groups) => { response.paragraphs.find((paragraph) => paragraph.id === id).groups = groups; return response; };
const errors = (report, id) => report.cases.find((item) => item.id === id).errors.map(({ name }) => name);

test('manual reference passes production mapping and declared requirements', () => {
  const report = score(reference(), { manualReference: true });
  assert.equal(report.mode, 'manualReference');
  assert.equal(report.selectedCases, 14);
  assert.equal(report.checks.passed, report.checks.total);
});

test('merged action and condition fails separation and condition requirement', () => {
  const text = fixtures.find(({ id }) => id === 'p24').text.split('.')[0];
  const report = score(edit(reference(), 'p24', [{ text, kind: 'core' }]));
  assert.ok(errors(report, 'p24').some((name) => name.startsWith('separate:')));
  assert.ok(errors(report, 'p24').some((name) => name.startsWith('required:condition:')));
});

test('missing parallel action is detected', () => {
  const response = reference();
  response.paragraphs.find(({ id }) => id === 'p1').groups = response.paragraphs.find(({ id }) => id === 'p1').groups.filter(({ text }) => text !== 'Use an API');
  assert.ok(errors(score(response), 'p1').includes('required:core:Use an API'));
});

test('dropping negation or necessary complement fails a complete core requirement', () => {
  const response = edit(reference(), 'transfer-negation', [{ text: 'delete the cached result', kind: 'core' }]);
  edit(response, 'transfer-complement', [{ text: 'The main drawbacks are', kind: 'core' }]);
  assert.ok(errors(score(response), 'transfer-negation').some((name) => name.startsWith('required:core:')));
  assert.ok(errors(score(response), 'transfer-complement').some((name) => name.startsWith('required:core:')));
});

test('basis misclassified as condition fails semantic requirement despite valid mapping', () => {
  const response = reference();
  response.paragraphs.find(({ id }) => id === 'p12').groups.find(({ kind }) => kind === 'detail').kind = 'condition';
  const report = score(response);
  assert.ok(!errors(report, 'p12').includes('production-parser'));
  assert.ok(errors(report, 'p12').some((name) => name.startsWith('required:detail:')));
});

test('larger legal boundary of the same kind is accepted', () => {
  const response = reference();
  const group = response.paragraphs.find(({ id }) => id === 'transfer-short').groups[0];
  group.text += '.';
  assert.deepEqual(errors(score(response), 'transfer-short'), []);
});

test('baseline ignores unrelated article IDs and explicitly skips absent transfers', () => {
  const response = reference();
  response.paragraphs = response.paragraphs.filter(({ id }) => !id.startsWith('transfer-'));
  response.paragraphs.push({ id: 'p999', groups: [] });
  const report = score(response, { baseline: true });
  assert.equal(report.scope, 'baselineSubset');
  assert.equal(report.selectedCases, 8);
  assert.equal(report.ignoredParagraphs, 1);
  assert.equal(report.unmeasuredTransferCases.length, 6);
  assert.equal(report.cases.filter(({ skipped }) => skipped).length, 6);
  assert.equal(report.checks.passed, report.checks.total);
});

test('missing cases in a complete response fail rather than being skipped', () => {
  const response = reference();
  response.paragraphs = response.paragraphs.filter(({ id }) => id !== 'transfer-short');
  const report = score(response);
  assert.equal(report.cases.find(({ id }) => id === 'transfer-short').skipped, false);
  assert.ok(errors(report, 'transfer-short').includes('production-parser'));
});

test('malformed exact text and unknown IDs remain production parser failures', () => {
  const response = edit(reference(), 'p24', [{ text: 'Use a translated API', kind: 'core' }]);
  assert.ok(errors(score(response), 'p24').includes('production-parser'));
  const unknown = reference();
  unknown.paragraphs.push({ id: 'unexpected', groups: [] });
  assert.ok(errors(score(unknown), 'p1').includes('production-parser'));
});

test('clipboard JSON strings and fenced objects decode without executing content', () => {
  assert.deepEqual(decodeResponse(JSON.stringify(JSON.stringify(reference()))), reference());
  assert.deepEqual(decodeResponse(`\`\`\`json\n${JSON.stringify(reference())}\n\`\`\``), reference());
});

test('dense exact mapping fails only declared fixture density limits', () => {
  const fixture = fixtures.find(({ id }) => id === 'p0');
  const groups = [...fixture.text.matchAll(/[^.!?]+[.!?]/g)].map(([text]) => ({ text: text.trim(), kind: 'core' }));
  const report = score(edit(reference(), 'p0', groups));
  const result = report.cases.find(({ id }) => id === 'p0');
  assert.ok(!errors(report, 'p0').includes('production-parser'));
  assert.ok(errors(report, 'p0').includes('fixture:max-coverage'));
  assert.ok(errors(report, 'p0').includes('fixture:max-core-words'));
  assert.ok(result.coverage > 0.9);
  assert.ok(result.maxCoreWords > 18);
  assert.ok(report.diagnostics.selectedLengthyProseOver90.some(({ id }) => id === 'p0'));
});

test('a long mixed core can fail length while staying below density limit', () => {
  const text = fixtures.find(({ id }) => id === 'p0').text;
  const first = text.slice(0, text.indexOf(', and'));
  const report = score(edit(reference(), 'p0', [{ text: first, kind: 'core' }]));
  assert.ok(errors(report, 'p0').includes('fixture:max-core-words'));
  assert.ok(!errors(report, 'p0').includes('fixture:max-coverage'));
  assert.ok(errors(report, 'p0').some((name) => name.startsWith('required:reason:')));
  assert.ok(errors(report, 'p0').some((name) => name.startsWith('separate:')));
});

test('parallel examples cannot be swallowed by a correctly mapped core', () => {
  for (const id of ['p37', 'transfer-parallel-examples']) {
    const fixture = fixtures.find((item) => item.id === id);
    const sentence = id === 'p37' ? fixture.text.split('. ')[1] : fixture.text.split('. ')[0];
    const report = score(edit(reference(), id, [{ text: sentence, kind: 'core' }]));
    assert.ok(!errors(report, id).includes('production-parser'));
    assert.equal(errors(report, id).filter((name) => name.startsWith('required:detail:')).length, 2);
    assert.equal(errors(report, id).filter((name) => name.startsWith('separate:')).length, 2);
  }
});

test('a short complete sentence may have 100 percent coverage', () => {
  const fixture = fixtures.find(({ id }) => id === 'transfer-short');
  const report = score(edit(reference(), fixture.id, [{ text: fixture.text, kind: 'core' }]));
  const result = report.cases.find(({ id }) => id === fixture.id);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.limits, {});
});

test('density diagnostics never create a global density failure', () => {
  const report = score(reference());
  const result = report.cases.find(({ id }) => id === 'p1');
  assert.ok(result.coverage > 0.9);
  assert.deepEqual(result.errors, []);
  assert.ok(report.diagnostics.selectedLengthyProseOver90.some(({ id }) => id === 'p1'));
});
