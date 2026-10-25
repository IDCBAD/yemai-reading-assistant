import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, basename } from 'node:path';
const playwrightModule = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'playwright';
const { chromium } = createRequire(import.meta.url)(playwrightModule);
const output = resolve('output/playwright/page-reading-extension');
const session = join(output, `run-${Date.now()}`), extension = join(session, 'extension');
await mkdir(session, { recursive: true });
await cp(resolve(process.env.READING_FOCUS_EXTENSION_PATH || '.output/chrome-mv3'), extension, { recursive: true });
const fixture = (await readFile('scripts/reading-focus-preview/index.html', 'utf8')).replace(/<div class="controls">[\s\S]*?<script type="module"[^>]*><\/script>/, '');
const siteHtml = (await readFile('output/reading-focus-browser-agents.html', 'utf8').catch(() => '')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const targetUrl = 'https://browser-use.com/posts/browser-agents';
const streams = new Map(), submissions = [], checks = [], errors = [];
let created = 0, aborts = 0, delay = 1800, invalid = false;
const event = (name, value) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
const message = (runId, data) => event('message', { runId, data: JSON.stringify(data) });
function envelope(response, data) { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify({ success: true, code: 200, data })); }
function answer(paragraphs, malformed) {
  return { paragraphs: paragraphs.map(({ id, text }) => {
    const phrases = [['Use a script', 'core'], ["if there's no suitable API", 'condition'], ['and the workflow is predictable', 'condition'], ['An API provides a stable interface', 'core'], ['because it exposes structured data', 'reason'], ['because they can adapt to unexpected changes and recover from errors', 'reason'], ['Use an agent when the task requires flexibility and decision-making', 'core']];
    let groups = phrases.filter(([phrase]) => text.includes(phrase)).map(([text, kind]) => ({ text, kind }));
    const phrase = text.trim().split(/\s+/).slice(0, 6).join(' ');
    if (!groups.length && phrase.length > 4 && text.includes(phrase) && text.indexOf(phrase) === text.lastIndexOf(phrase)) groups = [{ text: phrase, kind: 'core' }];
    groups.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
    return { id, groups: malformed ? [{ text: 'not in the original text', kind: 'core' }] : groups };
  }) };
}
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url.endsWith('/create')) { envelope(response, { conversationUuid: `${String(++created).padStart(8, '0')}-1111-4111-8111-111111111111` }); return; }
  const uuid = request.url.match(/\/conversations\/([^/]+)\//)?.[1];
  if (request.url.endsWith('/subscribe')) { response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' }); response.flushHeaders(); streams.set(uuid, response); return; }
  if (request.url.endsWith('/submit')) {
    let body = ''; for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).parts[0].text; assert(prompt.includes('PARAGRAPHS_JSON_DATA='));
    const paragraphs = JSON.parse(prompt.split('PARAGRAPHS_JSON_DATA=')[1]), runId = `page-${submissions.length + 1}`;
    submissions.push({ paragraphs, uuid }); envelope(response, { runId });
    const stream = streams.get(uuid), malformed = invalid;
    setTimeout(() => {
      if (stream.destroyed || stream.writableEnded) return;
      stream.write(message(runId, { type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: '' } } }));
      stream.write(message(runId, { type: 'message.part.delta', properties: { partID: 'answer', field: 'text', delta: JSON.stringify(answer(paragraphs, malformed)) } }));
      stream.end(event('xybot-stream-complete', { runId }));
    }, delay).unref(); return;
  }
  if (request.url.endsWith('/abort')) { aborts++; streams.get(uuid)?.end(); envelope(response, {}); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function patch(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await patch(path);
    else if (/\.(js|json)$/.test(entry.name)) { const source = await readFile(path, 'utf8'); if (source.includes('https://workos-api.yingdao.com')) await writeFile(path, source.replaceAll('https://workos-api.yingdao.com', origin)); }
  }
}
await patch(extension);
let context, worker, extensionId;
const waitUntil = async (predicate, timeout = 12000) => { const deadline = Date.now() + timeout; while (!(await predicate())) { if (Date.now() > deadline) throw new Error('Timed out waiting for extension state'); await new Promise((resolve) => setTimeout(resolve, 50)); } };
const observe = (page) => page.on('pageerror', (error) => errors.push(error.message));
async function launch() {
  context = await chromium.launchPersistentContext(join(session, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1200, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('https://browser-use.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/posts/browser-agents' && siteHtml) return route.fulfill({ contentType: 'text/html', body: siteHtml });
    if (url.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: await readFile(`output/reading-focus-site-css/${basename(url.pathname)}`, 'utf8').catch(() => '') });
    return route.fulfill({ status: 204, body: '' });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); extensionId = new URL(worker.url()).host;
}
async function webTab(url) {
  const page = await context.newPage(); observe(page); await page.goto(url); await page.locator('[data-yebian-selection]').waitFor({ state: 'attached' });
  await page.bringToFront();
  // URL visibility requires tabs/activeTab permissions; the test does not broaden
  // the production manifest merely to identify its newly activated fixture tab.
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  assert(Number.isInteger(tabId), `No active extension tab for ${page.url()}`);
  const cdp = await context.newCDPSession(page);
  const command = (type) => worker.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
  const state = () => command('reading-focus:status');
  const complete = () => waitUntil(async () => ['ready', 'highlighted'].includes((await state()).phase)).catch(async error => { throw new Error(error.message + ': ' + JSON.stringify(await state())); });
  async function shadowCall(functionDeclaration) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => node.attributes?.includes('data-yebian-selection') ? node : (node.children || []).map(find).find(Boolean);
    const host = find(root); assert(host?.shadowRoots?.[0]);
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: host.shadowRoots[0].backendNodeId });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value;
  }
  return { page, command, state, complete, shadowCall };
}
try {
  await launch();
  const panel = await context.newPage(); observe(panel); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.storage.local.set({ readingFocusPreferencesV2: { initialized: true }, workosConnectionSettings: { schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '', internalV2: { accessToken: 'synthetic-page-token', userUuid: 'synthetic-user', organizationUuid: 'synthetic-org' } } }));
  if (process.argv.includes('--spa-only')) {
    delay = 50;
    await worker.evaluate(() => {
      globalThis.readingSpaSenders = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message?.type?.startsWith('reading-focus:page-')) globalThis.readingSpaSenders.push({
          type: message.type, senderUrl: sender.url, tabUrl: sender.tab?.url,
          documentId: sender.documentId, frameId: sender.frameId, snapshotUrl: message.snapshot?.url,
        });
        return false;
      });
    });
    const spa = await webTab(`${origin}/principles`);
    const article = await spa.page.locator('article').innerHTML();
    await spa.command('reading-focus:toggle'); await spa.complete();
    const principlesTask = (await spa.state()).taskId;
    await spa.command('reading-focus:toggle');
    await spa.page.evaluate(() => {
      history.pushState({}, '', '/models');
      document.querySelector('#first').textContent = 'The Models API supports query parameters to filter the list of models returned.';
    });
    await spa.command('reading-focus:toggle');
    await waitUntil(async () => ['ready', 'highlighted', 'error'].includes((await spa.state()).phase));
    const status = await spa.state();
    assert.notEqual(status.phase, 'error', status.message);
    assert.equal(submissions.length, 2);
    assert(submissions[1].paragraphs.some(({text})=>text.startsWith('The Models API supports')));
    const modelsTask = status.taskId;
    assert.notEqual(modelsTask, principlesTask);
    checks.push('same-document navigation from Principles to Models analyzes the current article');
    await spa.command('reading-focus:toggle');
    await spa.page.evaluate(() => history.back());
    await spa.page.waitForURL(`${origin}/principles`);
    await spa.page.locator('article').evaluate((element, html) => {element.innerHTML=html;}, article);
    await spa.command('reading-focus:toggle'); await spa.complete();
    assert.equal((await spa.state()).taskId, principlesTask);
    assert.equal(submissions.length, 2);
    checks.push('back navigation reuses the original article cache without another submission');
    await spa.page.evaluate(() => {
      history.replaceState({}, '', '/models');
      document.querySelector('#first').textContent = 'The Models API supports query parameters to filter the list of models returned.';
    });
    await waitUntil(async () => (await spa.state()).phase === 'error');
    assert.equal(submissions.length, 2);
    await spa.command('reading-focus:toggle');
    await spa.command('reading-focus:toggle'); await spa.complete();
    assert.equal((await spa.state()).taskId, modelsTask);
    assert.equal(submissions.length, 2);
    checks.push('active replaceState invalidates old highlighting and re-entry reuses the new article cache');
    const evidence = {checks,created,submissions:submissions.length,status:await spa.state(),
      senderEvidence:await worker.evaluate(()=>globalThis.readingSpaSenders),
      source:'isolated Chromium with native message senders and synthetic WorkOS'};
    await writeFile(join(output, 'spa-checks.json'), JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({checks,created,submissions:submissions.length,status:await spa.state()}));
  } else {
  const first = await webTab(`${origin}/`), original = await first.page.locator('article').innerHTML();
  await first.command('reading-focus:toggle'); await waitUntil(() => submissions.length === 1);
  for (const id of ['first', 'second', 'third', 'fourth']) await first.page.locator(`#${id}`).hover();
  assert.equal(submissions.length, 1); assert.equal(await first.page.locator('#second').evaluate((node) => getComputedStyle(node).opacity), '1');
  checks.push('preparation submits once; hovering before ready has no effects or submissions');
  await first.command('reading-focus:toggle'); assert.equal(aborts, 0);
  const duplicate = await webTab(`${origin}/`); await duplicate.command('reading-focus:toggle'); await first.command('reading-focus:toggle'); await first.complete(); await duplicate.complete();
  assert.equal(created, 1); assert.equal(submissions.length, 1);
  checks.push('exit continues in background; re-entry and a second tab share one durable task');
  const posted = submissions[0].paragraphs.map(({ text }) => text);
  assert(posted.some((text) => text.includes('Use a script'))); assert(!posted.some((text) => text.includes('const listCode')));
  await first.page.locator('#first').hover(); await waitUntil(async () => (await first.state()).phase === 'highlighted');
  await first.page.locator('#second').hover(); await first.page.locator('#first').hover(); assert.equal(submissions.length, 1);
  assert.equal(await first.page.locator('#code-list').evaluate((node) => getComputedStyle(node).opacity), '1');
  checks.push('ready hover is entirely local, while nested code blocks remain excluded');
  await first.page.evaluate(() => { const text = document.querySelector('#first').lastChild, start = text.textContent.indexOf('predictable'); const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 11); getSelection().removeAllRanges(); getSelection().addRange(range); document.querySelector('#first').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true })); });
  await waitUntil(() => first.shadowCall('function(){const b=[...this.querySelectorAll("button")].find(e=>e.textContent==="查词");return b&&!b.hidden}'));
  await first.shadowCall('function(){[...this.querySelectorAll("button")].find(e=>e.textContent==="查词").click()}');
  await waitUntil(async () => (await first.shadowCall('function(){return this.querySelector(".yemai-word-meaning")?.textContent||""}')).includes('可预言'));
  await first.shadowCall('function(){[...this.querySelectorAll(".yemai-word-popover button")].find(e=>e.textContent==="收藏单词").click()}');
  await waitUntil(() => first.shadowCall('function(){return [...this.querySelectorAll("button")].some(e=>e.textContent==="已收藏")}'));
  await first.page.screenshot({ path: join(output, 'extension-dictionary.png'), caret: 'initial' });
  await first.shadowCall('function(){this.querySelector(".yemai-word-close").click()}'); assert.equal(await first.page.evaluate(() => getSelection().isCollapsed), true);
  checks.push('packaged dictionary and existing word card save work in closed Shadow DOM');
  await first.command('reading-focus:toggle'); assert.equal(await first.page.locator('article').innerHTML(), original);
  await duplicate.command('reading-focus:toggle'); await first.page.bringToFront();
  await panel.getByRole('button', { name: '开启辅助阅读', exact: true }).evaluate((button) => button.click()); await first.complete(); assert.equal(submissions.length, 1);
  await panel.setViewportSize({ width: 360, height: 760 }); await panel.getByRole('button', { name: '关闭辅助阅读', exact: true }).waitFor({ state: 'visible' });
  checks.push('sidepanel switch reuses cache and remains accessible at 360px');
  if (siteHtml) {
    const site = await webTab(targetUrl); await site.command('reading-focus:toggle'); await site.complete(); const captured = submissions.at(-1).paragraphs;
    assert(captured.some(({ text }) => text.startsWith('A browser agent is software'))); assert(captured.some(({ text }) => text.includes('Use an agent when the task requires')));
    assert(!captured.some(({ text }) => text.includes('while (!goalReached)'))); assert(!captured.some(({ text }) => text === 'In this article'));
    await site.page.locator('p').filter({ hasText: /^A browser agent is software/ }).first().hover(); await waitUntil(async () => (await site.state()).phase === 'highlighted');
    await site.page.screenshot({ path: join(output, 'browser-use-article.png'), caret: 'initial' });
    checks.push(`specified Browser Use HTML/CSS: ${captured.length} blocks, ${captured.reduce((sum, p) => sum + p.text.length, 0)} characters, no code/TOC`);
  }
  invalid = true; delay = 50;
  const failed = await webTab(`${origin}/failure`); await failed.command('reading-focus:toggle'); await waitUntil(async () => (await failed.state()).taskStatus === 'failed'); const failedCount = submissions.length;
  assert(await failed.shadowCall('function(){return !this.querySelector(".rfv2-preparation").hidden&&this.querySelector(".rfv2-preparation").dataset.state==="error"}'));
  await failed.shadowCall('function(){this.querySelector(".rfv2-preparation-more").click();[...this.querySelectorAll(".rfv2-preparation-menu button")].find(e=>e.textContent==="继续阅读").click()}');
  await waitUntil(() => failed.shadowCall('function(){return this.querySelector(".rfv2-preparation").hidden&&!this.querySelector(".rfv2-bar").hidden}'));
  await failed.shadowCall('function(){[...this.querySelectorAll(".rfv2-bar button")].find(e=>e.textContent==="设置").click()}');
  assert(await failed.shadowCall('function(){return !this.querySelector(".rfv2-pop").hidden&&this.querySelector(".rfv2-pop").textContent.includes("阅读设置")}'));
  await failed.shadowCall('function(){[...this.querySelectorAll(".rfv2-pop button")].find(e=>e.textContent==="完成").click();[...this.querySelectorAll(".rfv2-bar button")].find(e=>e.textContent==="搭配").click()}');
  assert(await failed.shadowCall('function(){return this.querySelector(".rfv2-pop").textContent.includes("扫描全文搭配")}'));
  assert.equal(submissions.length, failedCount);
  checks.push('failed group analysis can return to reading tools, settings and independent expressions without retrying');
  await failed.command('reading-focus:toggle'); await failed.command('reading-focus:toggle'); await new Promise((resolve) => setTimeout(resolve, 200)); assert.equal(submissions.length, failedCount);
  invalid = false; await failed.shadowCall('function(){[...this.querySelectorAll("button")].find(e=>e.textContent==="重试").click()}'); await failed.complete(); assert.equal(submissions.length, failedCount + 1);
  checks.push('failed task is not silently retried; explicit retry creates exactly one attempt');
  delay = 60000;
  const stopped = await webTab(`${origin}/stop`); await stopped.command('reading-focus:toggle'); await waitUntil(async () => (await stopped.state()).taskStatus === 'analyzing');
  await stopped.shadowCall('function(){[...this.querySelectorAll("button")].find(e=>e.textContent==="停止").click()}'); await waitUntil(() => aborts === 1); await waitUntil(async () => ['unknown', 'stopped'].includes((await stopped.state()).taskStatus)); const stopCount = submissions.length;
  await stopped.command('reading-focus:toggle'); await stopped.command('reading-focus:toggle'); await new Promise((resolve) => setTimeout(resolve, 200)); assert.equal(submissions.length, stopCount);
  checks.push('explicit stop requests remote stop and re-entry does not duplicate uncertain work');
  const pending = await webTab(`${origin}/reload-pending`); await pending.command('reading-focus:toggle'); await waitUntil(async () => (await pending.state()).taskStatus === 'analyzing'); const beforeRestart = submissions.length;
  await context.close(); context = undefined; await launch();
  const cached = await webTab(`${origin}/`); await cached.command('reading-focus:toggle'); await cached.complete(); assert.equal(submissions.length, beforeRestart);
  const unknown = await webTab(`${origin}/reload-pending`); await unknown.command('reading-focus:toggle'); await waitUntil(async () => (await unknown.state()).taskStatus === 'unknown'); assert.equal(submissions.length, beforeRestart);
  checks.push('browser restart restores completed cache and marks interrupted work unknown without resubmission');
  assert.deepEqual(errors, []);
  const result = { passed: checks.length, checks, submissions: submissions.length, created, aborts, errors, source: 'isolated Chromium, public article HTML/CSS snapshot, synthetic WorkOS only' };
  await writeFile(join(output, 'checks.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  }
} finally { await context?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
