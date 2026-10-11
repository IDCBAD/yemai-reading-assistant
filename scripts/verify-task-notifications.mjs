import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const disconnectMode = process.argv.includes('--progress-disconnect');
const formMode = process.argv.includes('--form-interrupt');
const output = resolve(formMode ? 'output/task-form-notifications' : disconnectMode ? 'output/progress-disconnect' : 'output/task-notifications');
const session = join(output, `run-${Date.now()}`);
const extension = join(session, 'extension');
await mkdir(session, { recursive: true });
await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
const streams = new Map(), submissions = [], errors = [], checks = [];
let conversationCount = 0;
const formReplies = [];
const envelope = (response, data) => { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify({ success: true, code: 200, data })); };
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/create')) {
    envelope(response, { conversationUuid: `22222222-2222-4222-8222-${String(++conversationCount).padStart(12, '0')}` }); return;
  }
  const conversationId = /conversations\/([^/]+)/.exec(request.url)?.[1];
  if (request.url.endsWith('/subscribe')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' }); response.flushHeaders();
    streams.set(conversationId, response); return;
  }
  if (request.url.endsWith('/submit')) {
    let body = ''; for await (const chunk of request) body += chunk;
    const runId = `run-${submissions.length + 1}`;
    submissions.push({ runId, conversationId, body: JSON.parse(body) });
    envelope(response, { runId }); return;
  }
  if (/\/interrupt\/[^/]+\/reply$/.test(request.url)) {
    let body = ''; for await (const chunk of request) body += chunk;
    formReplies.push({ conversationId, body: JSON.parse(body) });
    envelope(response, {});
    const submission = submissions.find((entry) => entry.conversationId === conversationId);
    streams.get(conversationId).write(event('message', { runId: submission.runId, data: JSON.stringify({ type: 'interrupt.replied', properties: {
      requestID: 'form-1', sessionID: 'session-1', data: JSON.parse(body),
    } }) }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<title>通知验证</title><main>模拟 WorkOS</main>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
async function patch(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await patch(path);
    else if (/\.(js|json)$/.test(entry.name)) await writeFile(path, (await readFile(path, 'utf8')).replaceAll('https://workos-api.yingdao.com', origin));
  }
}
await patch(extension);
// Capture only OS notification APIs in the isolated extension copy. Badge,
// storage, task execution, sidebar UI and navigation use actual Chromium APIs.
const shim = `globalThis.__taskNotices={created:[],visible:{},clicks:[]};
chrome.notifications.create=async(id,options)=>{__taskNotices.created.push({id,options});__taskNotices.visible[id]=options;return id;};
chrome.notifications.getAll=async()=>({...__taskNotices.visible});
chrome.notifications.clear=async(id)=>{delete __taskNotices.visible[id];return true;};
chrome.notifications.getPermissionLevel=async()=>"granted";
chrome.notifications.onClicked.addListener=(callback)=>__taskNotices.clicks.push(callback);
chrome.sidePanel.open=async()=>{throw new Error("synthetic missing notification user gesture");};\n`;
const backgroundFile = join(extension, 'background.js');
await writeFile(backgroundFile, shim + await readFile(backgroundFile, 'utf8'));
const profile = join(session, 'profile');
const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const wait = async (predicate, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for notification verification'); await new Promise((done) => setTimeout(done, 80)); }
};
const complete = (index) => {
  const submission = submissions[index], stream = streams.get(submission.conversationId);
  stream.write(event('message', { runId: submission.runId, data: JSON.stringify({ type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: `通知验证回答 ${index}` } } }) }));
  stream.write(event('message', { runId: submission.runId, type: 'run.terminal', properties: { status: 'run_succeeded' } }));
  stream.end(event('xybot-stream-complete', { runId: submission.runId }));
};
let context;
try {
  context = await launch();
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const panelUrl = `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`;
  const observe = (page) => page.on('pageerror', (error) => errors.push(error.message));
  let page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.evaluate(() => chrome.storage.local.set({ workosConnectionSettings: { schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '', internalV2: { accessToken: 'synthetic', userUuid: 'synthetic', organizationUuid: 'synthetic' } } }));
  await page.reload(); await page.bringToFront();
  const send = async (text, count) => {
    await page.getByRole('textbox', { name: '输入问题' }).fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await wait(() => submissions.length === count);
  };
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  const created = () => worker.evaluate(() => __taskNotices.created.length);
  if (formMode) {
    await send('请用表单确认需求', 1);
    await page.close();
    const submission = submissions[0], stream = streams.get(submission.conversationId);
    const interrupt = event('message', { runId: submission.runId, data: JSON.stringify({ type: 'interrupt', properties: {
      id: 'form-1', sessionID: 'session-1', type: 'a2ui', payload: { title: '简单确认', fields: [
        { type: 'input', label: '你想做什么？', default: '' },
        { type: 'radio', label: '需要什么形式？', options: [{ label: '文字说明' }, { label: '代码 / 文件' }, { label: '表格清单' }] },
        { type: 'textarea', label: '其他补充需求', default: '' },
      ] }, tool: { messageID: 'message-1', callID: 'call-1' },
    } }) });
    stream.write(interrupt);
    await wait(async () => await badge() === '1');
    await wait(async () => await created() === 1);
    const notice = await worker.evaluate(() => __taskNotices.created[0].options);
    assert.equal(notice.title, '任务需要确认');
    assert.equal(notice.message, '请用表单确认需求');
    stream.write(interrupt);
    await new Promise((done) => setTimeout(done, 600));
    assert.equal(await created(), 1);
    checks.push('a real-shaped input/radio/textarea interrupt while closed creates one attention notice and badge; duplicate events do not repeat it');
    page = await context.newPage(); observe(page); await page.goto(panelUrl); await page.bringToFront();
    await page.getByRole('heading', { name: '简单确认', exact: true }).waitFor();
    await page.getByRole('textbox', { name: '你想做什么？', exact: true }).fill('阅读项目');
    await page.getByRole('radio', { name: '文字说明', exact: true }).check();
    await page.getByRole('textbox', { name: '其他补充需求', exact: true }).fill('简洁一些');
    await wait(async () => await badge() === '');
    await page.setViewportSize({ width: 380, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'form-waiting.png') });
    checks.push('reopening restores interactive fields, clears unread, and fits a 380px sidebar');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await wait(() => formReplies.length === 1);
    assert.deepEqual(formReplies[0].body, { '你想做什么？': '阅读项目', '需要什么形式？': '文字说明', '其他补充需求': '简洁一些' });
    await page.getByText('已确认 3 项', { exact: true }).waitFor();
    assert.equal(submissions.length, 1);
    complete(0);
    await page.getByText('通知验证回答 0', { exact: false }).first().waitFor();
    await new Promise((done) => setTimeout(done, 400));
    assert.equal(await created(), 1);
    checks.push('confirm sends field labels and selected values to the existing interrupt reply endpoint and continues the original run without resubmitting');
  } else if (disconnectMode) {
    await send('耗时任务断流验证', 1);
    const submission = submissions[0], stream = streams.get(submission.conversationId);
    stream.write(event('message', { runId: submission.runId, data: JSON.stringify({ type: 'message.part.updated', properties: {
      part: { id: 'partial', type: 'text', text: '断流前已经收到的部分回答' },
    } }) }));
    await page.getByText('断流前已经收到的部分回答', { exact: false }).first().waitFor();
    await page.getByRole('textbox', { name: '输入问题' }).fill('排队问题不应发送');
    await page.getByRole('button', { name: '加入队列', exact: true }).click();
    await page.getByText('1 条排队').waitFor();
    await page.close();
    stream.end(); // A valid HTTP stream ending without a WorkOS terminal event.
    await wait(async () => await badge() === '1');
    await wait(async () => await created() === 1);
    assert.equal(submissions.length, 1);
    const notice = await worker.evaluate(() => __taskNotices.created[0].options);
    assert.equal(notice.title, '进度连接中断，任务状态未确认');
    assert.match(notice.message, /任务可能仍在运行/);
    checks.push('closed page progress loss generates an uncertainty notification and badge without resubmitting or starting queued work');
    page = await context.newPage(); observe(page); await page.goto(panelUrl); await page.bringToFront();
    await page.getByText('断流前已经收到的部分回答', { exact: false }).first().waitFor();
    await page.getByText('进度连接已断开', { exact: false }).first().waitFor();
    await page.getByText('上一项 WorkOS 任务状态未确认，此排队问题未发送。', { exact: false }).waitFor();
    const input = page.getByRole('textbox', { name: '输入问题' });
    await input.fill('保留的草稿'); await input.press('Enter');
    assert.equal(await input.inputValue(), '保留的草稿');
    assert.equal(await page.getByRole('button', { name: '任务状态未确认，暂不发送', exact: true }).isDisabled(), true);
    assert.equal(submissions.length, 1);
    assert.equal(await page.getByRole('button', { name: '重新发送', exact: true }).count(), 0);
    await page.setViewportSize({ width: 380, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'progress-disconnected.png') });
    checks.push('reopened UI retains partial content, marks queued question unsent, disables same-conversation submit and Enter while preserving the draft');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await send('独立新对话正常发送', 2); complete(1);
    await page.getByText('通知验证回答 1', { exact: false }).first().waitFor();
    checks.push('a separate new conversation still submits and completes');
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    page = await context.newPage(); observe(page); await page.goto(panelUrl); await page.bringToFront();
    await page.getByRole('tab').nth(0).click();
    await page.getByText('断流前已经收到的部分回答', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '任务状态未确认，暂不发送', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: '输入问题' }).inputValue(), '保留的草稿');
    assert.equal(await created(), 0); assert.equal(submissions.length, 2);
    checks.push('browser restart preserves unconfirmed target and draft without replaying notifications or submissions');
  } else {
  await send('当前会话查看中', 1);
  assert.equal(await page.evaluate(() => document.hasFocus()), true);
  complete(0);
  await page.getByText('通知验证回答 0', { exact: false }).first().waitFor();
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(await badge(), ''); assert.equal(await created(), 0);
  checks.push('viewing current conversation suppresses unread and OS notification');

  await send('关闭侧边栏后完成', 2);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.close();
  complete(1);
  await wait(async () => await badge() === '1');
  await wait(async () => await created() === 1);
  const completionNotice = await worker.evaluate(() => __taskNotices.created[0].options);
  assert.equal(completionNotice.title, '任务已完成');
  assert.equal(completionNotice.message, '关闭侧边栏后完成');
  assert.deepEqual(await worker.evaluate(() => chrome.action.getBadgeBackgroundColor({})), [0, 0, 0, 255]);
  assert.deepEqual(await worker.evaluate(() => chrome.action.getBadgeTextColor({})), [255, 255, 255, 255]);
  checks.push('explicit success produces a completion notice with this question rather than the first conversation title and a black badge with white text');
  page = await context.newPage(); observe(page); await page.goto(panelUrl); await page.bringToFront();
  await page.getByRole('textbox', { name: '输入问题' }).waitFor();
  await page.locator('.tab-unread-dot').waitFor();
  assert.equal(await badge(), '1');
  await page.screenshot({ path: join(output, 'unread-conversation.png') });
  checks.push('closed page completion creates one OS notification and restores toolbar badge plus conversation dot');
  await page.getByRole('tab').nth(0).click();
  await wait(async () => await badge() === '');
  checks.push('viewing matching conversation clears its unread and badge');

  await page.getByRole('button', { name: '打开设置' }).click();
  const toggle = page.getByRole('switch', { name: '系统通知', exact: true });
  await toggle.waitFor(); await toggle.click();
  await wait(async () => await toggle.getAttribute('aria-checked') === 'false');
  await page.screenshot({ path: join(output, 'notification-setting.png') });
  await page.setViewportSize({ width: 380, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await toggle.focus();
  assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);
  await page.screenshot({ path: join(output, 'notification-setting-narrow.png') });
  checks.push('notification setting stays within a narrow 380px sidebar and remains keyboard focusable');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭设置', exact: true }).click();
  await send('关闭通知但保留角标', 3);
  await page.getByRole('tab').nth(1).click();
  await page.close(); complete(2);
  await wait(async () => await badge() === '1');
  assert.equal(await created(), 1);
  checks.push('system notification toggle off retains unread badge without OS notification');

  await context.close();
  context = await launch();
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await wait(async () => await badge() === '1');
  assert.equal(await created(), 0);
  checks.push('browser restart restores unread badge without replaying old OS notifications');
  page = await context.newPage(); observe(page); await page.goto(panelUrl);
  await page.getByRole('textbox', { name: '输入问题' }).waitFor();
  const target = await page.evaluate(() => new Promise((done) => {
    const port = chrome.runtime.connect({ name: 'workspace-executor:notification-verification' });
    port.onMessage.addListener((snapshot) => { port.disconnect(); done(snapshot.workspace.conversations.find((conversation) => conversation.title.includes('当前会话'))?.id ?? snapshot.workspace.conversations.find((conversation) => conversation.messages.length)?.id); });
  }));
  const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
  const opened = context.waitForEvent('page');
  await worker.evaluate(({ target, windowId }) => __taskNotices.clicks[0](`yemai-task:${windowId}:${encodeURIComponent(target)}`), { target, windowId });
  const fallback = await opened; observe(fallback);
  await fallback.waitForLoadState(); await fallback.bringToFront();
  await fallback.getByText('通知验证回答 2', { exact: false }).first().waitFor();
  await wait(async () => await badge() === '');
  assert.equal(new URL(fallback.url()).searchParams.has('taskConversation'), false);
  checks.push('synthetic notification click with rejected sidePanel.open navigates fallback page to matching result and clears unread after viewing');
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, errors, submissions: submissions.length,
    scope: 'isolated headless Chromium production-copy UI and real badge/storage, mock WorkOS, captured OS APIs, synthetic notification click; no native OS banner or native sidebar gesture acceptance' }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { if (context) await context.close(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
