import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const inputRoot = path.resolve(args[0] ?? 'C:/Users/xiao_/Desktop/测试用例');
const outputRoot = path.resolve(args[1] ?? path.join(root, 'output/reading-focus-corpus/user'));
if (inputRoot === outputRoot || outputRoot.startsWith(`${inputRoot}${path.sep}`)) {
  throw new Error('Output must be outside the read-only user case directory.');
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonFile = (directory, name, value) => writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

async function textFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    // Do not follow symlinks outside the explicitly supplied folder.
    if (entry.isDirectory()) found.push(...await textFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) found.push(full);
  }
  return found.sort();
}

function decodeResponse(text) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  let parsed = JSON.parse(fenced?.[1] ?? trimmed);
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.paragraphs)) {
    throw new Error('Response must contain a paragraphs array.');
  }
  return parsed;
}

function decodeParagraphs(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item.id === 'string' && typeof item.text === 'string')) {
    throw new Error('Input must be an array of paragraph objects with string id and text.');
  }
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) throw new Error('Input paragraph IDs are duplicated.');
  return parsed;
}

function exactTextDiagnostics(paragraphs, response) {
  const input = new Map(paragraphs.map(({ id, text }) => [id, text]));
  const issues = [];
  const seen = new Set();
  let groups = 0;
  for (const paragraph of response.paragraphs) {
    if (seen.has(paragraph.id)) issues.push({ id: paragraph.id, reason: 'duplicate-response-id' });
    seen.add(paragraph.id);
    const text = input.get(paragraph.id);
    if (text === undefined) { issues.push({ id: paragraph.id, reason: 'unknown-response-id' }); continue; }
    if (!Array.isArray(paragraph.groups)) { issues.push({ id: paragraph.id, reason: 'groups-not-array' }); continue; }
    let previousEnd = 0;
    for (const group of paragraph.groups) {
      groups++;
      if (typeof group.text !== 'string' || group.text.length === 0) { issues.push({ id: paragraph.id, reason: 'invalid-group-text' }); continue; }
      const occurrence = group.occurrence ?? 0;
      if (!Number.isInteger(occurrence) || occurrence < 0) { issues.push({ id: paragraph.id, text: group.text, reason: 'invalid-occurrence' }); continue; }
      let start = -1;
      for (let index = 0; index <= occurrence; index++) {
        start = text.indexOf(group.text, start + 1);
        if (start < 0) break;
      }
      if (start < 0) issues.push({ id: paragraph.id, text: group.text, reason: 'no-exact-source-match' });
      else if (start < previousEnd) issues.push({ id: paragraph.id, text: group.text, reason: 'overlap-or-out-of-order' });
      else previousEnd = start + group.text.length;
    }
  }
  for (const id of input.keys()) if (!seen.has(id)) issues.push({ id, reason: 'missing-response-id' });
  return { groups, issues, scope: 'Exact text, order and IDs only; not production-parser acceptance or semantic quality.' };
}

await mkdir(outputRoot, { recursive: true });
const importedAt = new Date().toISOString();
const cases = [];
for (const filename of await textFiles(inputRoot)) {
  const bytes = await readFile(filename);
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const relativePath = path.relative(inputRoot, filename).split(path.sep).join('/');
  const digest = sha256(bytes);
  const stem = relativePath.replace(/\.txt$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'case';
  const id = `user-${stem}-${digest.slice(0, 12)}`;
  const directory = path.join(outputRoot, id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'raw.txt'), bytes);
  const sourceUrl = /^网址\s*[:：]\s*(https?:\/\/\S+)/m.exec(text)?.[1] ?? null;
  const description = /^描述\s*[:：]\s*(.*)$/m.exec(text)?.[1] ?? null;
  const inputMarker = /^输入\s*[:：]/m.exec(text);
  const outputMarker = /^输出\s*[:：]/m.exec(text);
  const record = {
    id, sourceUrl, description,
    provenance: { kind: 'user-captured-text', sourceFile: filename, relativePath, sha256: digest, importedAt, byteLength: bytes.length },
    artifacts: { raw: `${id}/raw.txt` },
    input: { status: 'absent' }, response: { status: 'absent', provenance: 'user-provided WorkOS reply; no new remote call performed by importer' },
    notes: [],
  };
  let paragraphs;
  let response;
  if (inputMarker) {
    const start = inputMarker.index + inputMarker[0].length;
    const end = outputMarker && outputMarker.index > start ? outputMarker.index : text.length;
    const prompt = text.slice(start, end).trim();
    await writeFile(path.join(directory, 'prompt.txt'), prompt, 'utf8');
    record.artifacts.prompt = `${id}/prompt.txt`;
    const marker = 'PARAGRAPHS_JSON_DATA=';
    const paragraphStart = prompt.lastIndexOf(marker);
    record.input.status = 'missing-paragraphs-marker';
    if (paragraphStart >= 0) {
      const capturedJson = prompt.slice(paragraphStart + marker.length).trim();
      await writeFile(path.join(directory, 'input-json.txt'), capturedJson, 'utf8');
      record.artifacts.inputJsonText = `${id}/input-json.txt`;
      try {
        paragraphs = decodeParagraphs(capturedJson);
        const snapshot = { url: sourceUrl ?? '', title: '', paragraphs };
        await jsonFile(directory, 'snapshot.json', snapshot);
        record.artifacts.snapshot = `${id}/snapshot.json`;
        record.input = { status: 'parsed', paragraphCount: paragraphs.length, characters: paragraphs.reduce((sum, item) => sum + item.text.length, 0) };
      } catch (error) {
        record.input = { status: 'invalid-captured-json', error: error.message };
        record.notes.push('Captured input is not valid JSON. It is preserved without repairs; this does not establish that the actual plugin request was invalid.');
      }
    }
    if (/Format:.*"id":\s*,/.test(prompt)) record.notes.push('Captured format example contains empty placeholder values; UI copying may have removed angle-bracket placeholders. Actual request text is not independently verified.');
  }
  if (outputMarker) {
    const responseText = text.slice(outputMarker.index + outputMarker[0].length).trim();
    await writeFile(path.join(directory, 'response-raw.txt'), responseText, 'utf8');
    record.artifacts.responseRaw = `${id}/response-raw.txt`;
    try {
      response = decodeResponse(responseText);
      await jsonFile(directory, 'response.json', response);
      record.artifacts.response = `${id}/response.json`;
      record.response.status = 'parsed';
      record.response.paragraphCount = response.paragraphs.length;
    } catch (error) {
      record.response.status = 'invalid-captured-json';
      record.response.error = error.message;
    }
  }
  if (paragraphs && response) record.exactTextDiagnostics = exactTextDiagnostics(paragraphs, response);
  if (response && !paragraphs) record.notes.push('No valid complete input snapshot is available, so exact source matching is not evaluated.');
  await jsonFile(directory, 'provenance.json', record);
  cases.push(record);
}
const index = { schemaVersion: 1, importedAt, inputRoot, caseCount: cases.length, cases };
await jsonFile(outputRoot, 'index.json', index);
console.log(JSON.stringify({ outputRoot, caseCount: cases.length, cases: cases.map(({ id, sourceUrl, input, response, exactTextDiagnostics }) => ({ id, sourceUrl, input, response, exactTextDiagnostics })) }, null, 2));
