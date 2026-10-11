import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const output = resolve('output/background-tasks');
await mkdir(output, { recursive: true });
const session = join(output, `run-${Date.now()}`);
const extension = join(session, 'extension');
await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
const submissions = [], errors = [], checks = [], streams = new Map();
let aborts = 0;
const envelope = (response, data) => { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify({ success: true, code: 200, data })); };
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const message = (runId, data) => event('message', { runId, data: JSON.stringify(data) });
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url.endsWith('/create')) {
    assert.equal(Buffer.from(request.headers['x-user-uuid'], 'base64').length, 256);
    assert.equal(Buffer.from(request.headers['x-organization-uuid'], 'base64').length, 256);
    envelope(response, { conversationUuid: '22222222-2222-4222-8222-222222222222' }); return;
  }
  if (request.url.endsWith('/subscribe')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' }); response.flushHeaders();
    streams.set('current', response); return;
  }
  if (request.url.endsWith('/submit')) {
    let body = ''; for await (const chunk of request) body += chunk;
    const text = JSON.parse(body).parts[0].text;
    const runId = `run-${submissions.length + 1}`;
    submissions.push({ runId, text, at: Date.now() });
    const stream = streams.get('current');
    envelope(response, { runId });
    setTimeout(() => {
      stream.write(message(runId, { type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: '' } } }));
      stream.write(message(runId, { type: 'message.part.delta', properties: { partID: 'answer', field: 'text', delta: '后台已接收，进度持续保留。' } }));
    }, 1_000).unref();
    if (text.includes('长静默测试')) setTimeout(() => {
      stream.write(message(runId, { type: 'message.part.delta', properties: { partID: 'answer', field: 'text', delta: '超过五分钟后任务完成。' } }));
      stream.end(event('xybot-stream-complete', { runId }));
    }, 335_000).unref();
    return;
  }
  if (request.url.endsWith('/abort')) {
    aborts++; setTimeout(() => envelope(response, {}), 1_500).unref(); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>后台测试资料</title><main><h1>模拟页面</h1><p>只使用本地模拟接口。</p></main>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function patchDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await patchDirectory(path);
    else if (/\.(js|json)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      await writeFile(path, source.replaceAll('https://workos-api.yingdao.com', origin));
    }
  }
}
await patchDirectory(extension);
const profile = join(session, 'profile');
const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
let context;
const waitFor = async (predicate, timeout = 15_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out waiting for mock server state'); await new Promise((resolve) => setTimeout(resolve, 100)); }
};
const observe = (page) => page.on('pageerror', (error) => errors.push(error.message));
const snapshot = (page) => page.evaluate(() => new Promise((resolve) => {
  const port = chrome.runtime.connect({ name: 'workspace-executor:verification' });
  const timeout = setTimeout(() => { port.disconnect(); resolve({ error: 'Snapshot timed out' }); }, 10_000);
  port.onMessage.addListener((state) => { clearTimeout(timeout); port.disconnect(); resolve(state); });
}));
try {
  context = await launch();
  console.log('isolated browser launched');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  console.log('worker registered');
  // Do not evaluate/attach a debugger to the worker; it would invalidate idle-lifetime evidence.
  const panelUrl = `chrome-extension://${id}/sidepanel.html`;
  let page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.evaluate(async () => chrome.storage.local.set({ workosConnectionSettings: { schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '', internalV2: { accessToken: 'synthetic-test-token', userUuid: 'synthetic-user', organizationUuid: 'synthetic-org' } } }));
  await page.reload(); await page.getByRole('textbox', { name: '输入问题' }).waitFor();
  const before = await snapshot(page);
  assert.ok(before.workspace, JSON.stringify(before));
  console.log('workspace hydrated');
  await page.getByRole('textbox', { name: '输入问题' }).fill('长静默测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.close();
  await waitFor(() => submissions.length === 1);
  checks.push('send then immediately close document: submission accepted exactly once');
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.getByText('后台已接收，进度持续保留。', { exact: false }).first().waitFor();
  const progress = await snapshot(page);
  assert.equal(progress.epoch, before.epoch);
  assert.equal(progress.workspace.conversations[0].messages.at(-1).status, 'streaming');
  await page.getByRole('textbox', { name: '输入问题' }).fill('重开后仍保留的草稿');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.close();
  const start = submissions[0].at;
  while (Date.now() - start < 340_000) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 340_000 - (Date.now() - start))));
    console.log(`closed document, no worker debugger, elapsed ${Math.round((Date.now() - start) / 1000)}s`);
  }
  page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.getByText('超过五分钟后任务完成。', { exact: false }).first().waitFor();
  const complete = await snapshot(page);
  assert.equal(complete.epoch, before.epoch);
  assert.equal(complete.workspace.conversations[0].messages.at(-1).status, 'complete');
  assert.equal(complete.workspace.conversations[0].draftInput, '重开后仍保留的草稿');
  assert.equal(submissions.length, 1);
  await page.screenshot({ path: join(output, 'reopened-complete.png') });
  checks.push('335s mostly silent stream with document closed: same worker epoch, complete persisted, draft retained');
  await page.getByRole('textbox', { name: '输入问题' }).fill('暂停测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitFor(() => submissions.length === 2);
  await page.getByRole('button', { name: '停止当前任务' }).click();
  await page.close();
  await waitFor(() => aborts === 1); await new Promise((resolve) => setTimeout(resolve, 2_000));
  page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.getByText('WorkOS 已接受暂停请求', { exact: false }).first().waitFor();
  assert.equal((await snapshot(page)).workspace.conversations[0].messages.at(-1).stopStatus, 'accepted');
  checks.push('stop then close during delayed abort response: remote acceptance persisted, one abort');
  await page.getByRole('textbox', { name: '输入问题' }).fill('重启恢复测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitFor(() => submissions.length === 3);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await context.close(); context = await launch();
  page = await context.newPage(); observe(page); await page.goto(panelUrl);
  const recovered = await snapshot(page);
  const last = recovered.workspace.conversations[0].messages.at(-1);
  assert.equal(last.status, 'stopped'); assert.match(last.errorMessage, /状态未确认/);
  assert.notEqual(recovered.epoch, before.epoch);
  await new Promise((resolve) => setTimeout(resolve, 1_000)); assert.equal(submissions.length, 3);
  checks.push('browser restart: partial result retained, remote status unknown, no automatic resubmission');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, submissions: submissions.map(({ runId, at }) => ({ runId, at })), aborts, errors, elapsedMs: Date.now() - start, scope: 'isolated Chromium extension document; local synthetic WorkOS; browser-native sidepanel close gesture and real WorkOS not tested' }, null, 2));
  console.log(JSON.stringify({ checks, aborts, errors }));
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
