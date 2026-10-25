import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const directory = resolve('output/playwright/reading-focus-v2', `run-${Date.now()}`);
const extension = join(directory, 'extension');
await mkdir(directory, { recursive: true });
await cp(resolve(process.argv[3] || '.output/chrome-mv3'), extension, { recursive: true });
const checks = [], errors = [], submissions = [], streams = new Map();
let created = 0;
let mockDelay = 6000;
let lastState;
let inspectShadow;
const fixture = `<!doctype html><html><head><title>Reading V2 fixture</title><style>
html{background:#080d11;color:#e8edf1;color-scheme:dark;font:18px/1.9 system-ui}body{margin:0;padding:70px 24px}article{max-width:760px;margin:auto}p{margin:32px 0}a{color:#a9d4ff}nav{position:fixed;top:0}pre{padding:15px}
</style></head><body><nav>Original navigation</nav><article>
<h1>Technical reading practice</h1>
<p id="definition">For text-to-speech requests, usable output means that the stream delivered valid audio: at least one complete sample.</p>
<p id="repeat">Decisions are based on the task. Results are also based on the current page, even when inputs and outputs are the same.</p>
<p id="technical">If a request returns HTTP 429, use a fallback model. To keep a request free, list only free models.</p>
<p id="link">A <a href="#original" id="original-link">stable interface</a> keeps the original webpage readable and interactive.</p>
</article><pre>Code blocks stay unchanged.</pre></body></html>`;
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const message = (runId, data) => event('message', { runId, data: JSON.stringify(data) });
const json = (response, value) => { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify({ success: true, code: 200, data: value })); };
function answer(paragraphs, mode) {
  if (mode === 'expressions') {
    const repeated = paragraphs.find(p => p.text.startsWith('Decisions are'));
    const definition = paragraphs.find(p => p.text.startsWith('For text-to-speech'));
    const technical = paragraphs.find(p => p.text.startsWith('If a request'));
    return { expressions: [
      { text: 'based on', category: 'expression', meaning: '基于；依据', occurrences: [0, 1].map(occurrence => ({ paragraphId: repeated.id, text: 'based on', occurrence })) },
      { text: 'at least', category: 'expression', meaning: '至少', occurrences: [{ paragraphId: definition.id, text: 'at least', occurrence: 0 }] },
      { text: 'for … requests', category: 'pattern', meaning: '针对……请求', usage: '限定规则适用的请求类型。', occurrences: [{ paragraphId: definition.id, text: 'For text-to-speech requests', occurrence: 0 }] },
      { text: 'HTTP 429', category: 'term', meaning: '请求过于频繁的 HTTP 状态码', occurrences: [{ paragraphId: technical.id, text: 'HTTP 429', occurrence: 0 }] },
    ] };
  }
  const landmarks = [
    ['For text-to-speech requests', 'scope', false],
    ['usable output means that the stream delivered valid audio', 'definition', true],
    ['at least one complete sample', 'criterion', false],
    ['Decisions are based on the task', 'statement', true],
    ['Results are also based on the current page', 'statement', true],
    ['even when inputs and outputs are the same', 'concession', false],
    ['If a request returns HTTP 429', 'condition', false],
    ['use a fallback model', 'statement', true],
    ['To keep a request free', 'purpose', false],
    ['list only free models', 'statement', true],
  ];
  return { paragraphs: paragraphs.map(({ id, text }) => ({ id, groups: landmarks.filter(([phrase]) => text.includes(phrase))
    .sort(([a], [b]) => text.indexOf(a) - text.indexOf(b)).map(([text, semantic, isCore]) => ({ text, semantic, isCore,
      ...(semantic === 'concession' ? { cue: { text: 'even when', meaning: '即使……也……' }, learningNote: '即使输入和输出相同，结果仍然基于当前页面。', explanation: '让步：让步：重复旧说明' } : {}),
    })) })) };
}
const server = createServer(async (request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.url.endsWith('/create')) { json(response, { conversationUuid: `${String(++created).padStart(8, '0')}-1111-4111-8111-111111111111` }); return; }
  const uuid = request.url.match(/\/conversations\/([^/]+)\//)?.[1];
  if (request.url.endsWith('/subscribe')) { response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' }); response.flushHeaders(); streams.set(uuid, response); return; }
  if (request.url.endsWith('/submit')) {
    let body = ''; for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).parts[0].text;
    const paragraphs = JSON.parse(prompt.split('PARAGRAPHS_JSON_DATA=')[1]);
    const mode = prompt.includes('Extract valuable reusable expressions') ? 'expressions' : 'groups';
    const runId = `v2-${submissions.length + 1}`; submissions.push({ mode, paragraphs, uuid }); json(response, { runId });
    const stream = streams.get(uuid);
    setTimeout(() => { if (stream.destroyed || stream.writableEnded) return;
      stream.write(message(runId, { type: 'message.part.updated', properties: { part: { id: 'answer', type: 'text', text: '' } } }));
      stream.write(message(runId, { type: 'message.part.delta', properties: { partID: 'answer', field: 'text', delta: JSON.stringify(answer(paragraphs, mode)) } }));
      stream.end(event('xybot-stream-complete', { runId }));
    }, mockDelay).unref(); return;
  }
  if (request.url.endsWith('/abort')) { streams.get(uuid)?.end(); json(response, {}); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function patch(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await patch(file);
    else if (/\.(js|json)$/.test(entry.name)) { const source = await readFile(file, 'utf8'); if (source.includes('https://workos-api.yingdao.com')) await writeFile(file, source.replaceAll('https://workos-api.yingdao.com', origin)); }
  }
}
await patch(extension);
let context;
const wait = async (predicate, limit = 15000) => { const deadline = Date.now() + limit; while (!(await predicate())) { if (Date.now() >= deadline) throw Error('Timed out waiting for V2 state'); await new Promise(resolve => setTimeout(resolve, 60)); } };
try {
  context = await chromium.launchPersistentContext(join(directory, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ workosConnectionSettings: { schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '', internalV2: { accessToken: 'synthetic-v2-token', userUuid: 'synthetic-user', organizationUuid: 'synthetic-org' } } }));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/reading`); await page.locator('[data-yebian-selection]').waitFor({ state: 'attached' }); await page.bringToFront();
  const original = await page.locator('article').innerHTML();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const command = type => worker.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 }), { tabId, type });
  const state = async () => lastState = await command('reading-focus:status');
  const cdp = await context.newCDPSession(page);
  async function shadowCall(functionDeclaration) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = node => node.attributes?.includes('data-yebian-selection') ? node : (node.children || []).map(find).find(Boolean);
    const host = find(root); assert(host?.shadowRoots?.[0]);
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: host.shadowRoots[0].backendNodeId });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  }
  inspectShadow = shadowCall;
  const click = text => shadowCall(`function(){const b=[...this.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.hidden);if(!b)throw Error('Missing button');b.click();}`);
  const setMode = value => shadowCall(`function(){const s=this.querySelector('select[aria-label="高亮显示模式"]');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change'));}`);
  const high = () => page.evaluate(() => [...CSS.highlights.entries()].map(([name, highlights]) => ({ name, text: [...highlights].map(r => r.toString()) })));
  await command('reading-focus:toggle');
  assert.equal(submissions.length, 0); assert.equal(created, 0);
  assert(await shadowCall('function(){return this.textContent.includes("设置你的阅读方式")}'));
  checks.push('first setup submits no AI request before explicit start');
  await shadowCall('function(){const s=this.querySelector("input[type=range]");s.value="85";s.dispatchEvent(new Event("input"));}');
  await click('保存并开始'); await wait(async () => (await state()).taskStatus === 'analyzing');
  const startedAt = (await state()).taskCreatedAt;
  assert(Number.isFinite(startedAt));
  assert(await shadowCall('function(){const card=this.querySelector(".rfv2-preparation");return !card.hidden&&card.dataset.state==="pending"&&this.querySelector(".rfv2-bar").hidden&&card.querySelector(".rfv2-preparation-title").textContent==="正在分析文章意群"&&card.querySelector(".rfv2-preparation-note").hidden&&!card.querySelector(".rfv2-preparation-more").hidden}'));
  await page.screenshot({ path: join(directory, 'preparation-dark.png') });
  await page.setViewportSize({ width: 360, height: 760 });
  assert(await shadowCall('function(){const r=this.querySelector(".rfv2-preparation").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.height<=105}'));
  await page.screenshot({ path: join(directory, 'preparation-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  // Exercise real pointer events through the closed shadow, not HTMLElement.click().
  const morePoint = await shadowCall('function(){const r=this.querySelector(".rfv2-preparation-more").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}');
  await page.mouse.click(morePoint.x, morePoint.y);
  assert(await shadowCall('function(){return !this.querySelector(".rfv2-preparation-menu").hidden}'));
  await page.mouse.click(morePoint.x, morePoint.y);
  assert(await shadowCall('function(){return this.querySelector(".rfv2-preparation-menu").hidden}'));
  await wait(async () => shadowCall('function(){return !this.querySelector(".rfv2-preparation-time").textContent.includes("等待 0 秒")}'));
  await command('reading-focus:toggle');
  assert(await shadowCall('function(){return this.querySelector(".rfv2-preparation").hidden}'));
  await command('reading-focus:toggle'); await wait(async () => (await state()).taskStatus === 'analyzing');
  assert.equal((await state()).taskCreatedAt, startedAt); assert.equal(submissions.length, 1);
  checks.push('two-line pending card uses real task time; menu toggles with pointer input; exit/reentry preserves one task');
  await wait(async () => (await state()).phase === 'ready'); mockDelay = 200;
  assert(await shadowCall('function(){return !this.querySelector(".rfv2-preparation").hidden&&this.querySelector(".rfv2-preparation").dataset.state==="ready"}'));
  await page.screenshot({ path: join(directory, 'preparation-ready.png') });
  await wait(async () => shadowCall('function(){return this.querySelector(".rfv2-preparation").hidden&&!this.querySelector(".rfv2-bar").hidden}'));
  checks.push('completion briefly confirms readiness then collapses to the compact reading toolbar');
  assert.equal(submissions.length, 1); assert.equal(submissions[0].mode, 'groups');
  await page.locator('#definition').hover(); await wait(async () => (await state()).phase === 'highlighted');
  await wait(async () => Math.abs(Number(await page.locator('#repeat').evaluate(n => getComputedStyle(n).opacity)) - .15) < .01);
  assert.equal(await page.locator('nav').evaluate(n => getComputedStyle(n).opacity), '1');
  checks.push('stored strong dimming affects prose only and rich roles render without rewriting DOM');
  await click('设置'); await setMode('skeleton');
  assert.deepEqual((await high()).flatMap(h => h.text), ['usable output means that the stream delivered valid audio']);
  await setMode('practice'); assert.equal((await high()).length, 0);
  assert.equal(submissions.length, 1); await setMode('full'); await click('完成');
  checks.push('full, skeleton and practice switch locally with no new model requests');
  await click('搭配'); await click('扫描全文搭配');
  await wait(async () => (await state()).expressionTaskStatus === 'ready');
  assert.equal(submissions.length, 2); assert.equal(submissions[1].mode, 'expressions');
  assert((await high()).some(h => h.name.endsWith('-expressions') && h.text.filter(t => t === 'based on').length === 2));
  assert((await high()).some(h => h.name.endsWith('-core')));
  await click('关闭清单');
  const scopePoint = await page.locator('#definition').evaluate(element => {
    const node = element.firstChild; const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 10);
    const rect = range.getBoundingClientRect(); return { x: rect.left + 10, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(scopePoint.x, scopePoint.y);
  await wait(async () => shadowCall('function(){const tip=this.querySelector(".rfv2-tip");return !tip.hidden&&tip.textContent.includes("适用范围")}'));
  checks.push('hovering a range exposes its rich semantic role without wrapping webpage text');
  await click('搭配');
  await page.screenshot({ path: join(directory, 'expressions-dark.png'), caret: 'initial' });
  checks.push('independent whole-article scan paints repeated expression underlines over thought groups');
  const expressionAction = (name, label) => shadowCall('function(){const row=[...this.querySelectorAll(".rfv2-expression")].find(n=>n.querySelector("strong").textContent===' + JSON.stringify(name) + ');const b=[...row.querySelectorAll("button")].find(b=>b.textContent===' + JSON.stringify(label) + ');if(!b)throw Error("Missing expression action");b.click();}');
  assert.equal(await shadowCall('function(){return [...this.querySelectorAll(".rfv2-expression-heading")].every(b=>b.getAttribute("aria-expanded")==="false")}'), true);
  assert.equal(await shadowCall('function(){return [...this.querySelectorAll("button")].some(b=>b.textContent.startsWith("位置 ")||b.textContent.includes("查词 / 收藏"))}'), false);
  await shadowCall('function(){[...this.querySelectorAll(".rfv2-expression-heading")].find(b=>b.querySelector("strong").textContent==="based on").click();}');
  await expressionAction('based on', '下一处');
  await expressionAction('based on', '收藏表达');
  await wait(async () => shadowCall('function(){return [...this.querySelectorAll(".rfv2-expression-save")].some(b=>b.textContent==="已收藏"&&b.disabled)}'));
  await expressionAction('based on', '上一处');
  await expressionAction('based on', '已收藏');
  const readCards = () => worker.evaluate(async () => {
    const databases = await indexedDB.databases(); const name = databases.find(d => /yemai/i.test(d.name))?.name;
    if (!name) throw Error('Missing database');
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = database.transaction('wordCards').objectStore('wordCards').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { database.close(); }
  });
  const cards = await readCards();
  assert(cards.some(card => card.word === 'based on' && card.expression?.name === 'based on' && card.meaning === '基于；依据' && card.sentence.slice(card.highlightStart, card.highlightEnd) === 'based on' && card.source.url === `${origin}/reading`));
  assert.equal(cards.filter(card => card.expression?.name === 'based on').length, 1);
  assert(cards.find(card => card.expression?.name === 'based on').sentence.startsWith('Results are'));
  await click('关闭清单'); await click('搭配');
  await wait(async () => shadowCall('function(){const row=[...this.querySelectorAll(".rfv2-expression")].find(n=>n.querySelector("strong").textContent==="based on");return !row.querySelector(".rfv2-saved-badge").hidden}'));
  checks.push('collapsed expression rows share one navigation and one save; navigating after save preserves one card and its selected second example');
  await shadowCall('function(){[...this.querySelectorAll(".rfv2-expression-heading")].find(b=>b.querySelector("strong").textContent==="for … requests").click();}');
  await expressionAction('for … requests', '收藏表达');
  await wait(async () => (await readCards()).some(card=>card.expression?.name==='for … requests'));
  const templateCard = (await readCards()).find(card=>card.expression?.name==='for … requests');
  assert.equal(templateCard.word, 'For text-to-speech requests');
  assert.equal(templateCard.sentence.slice(templateCard.highlightStart,templateCard.highlightEnd),templateCard.word);
  await page.screenshot({path:join(directory,'learning-list-expanded.png'),caret:'initial'});
  checks.push('template display names are saved separately from exact original instances and sentence offsets');
  const originalCard = (await readCards()).find(card => card.expression?.name === 'based on');
  const alterTestCard = (action, card) => worker.evaluate(async ({action, card}) => {
    const name = (await indexedDB.databases()).find(d=>/yemai/i.test(d.name)).name;
    const database = await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {await new Promise((resolve,reject)=>{const tx=database.transaction('wordCards','readwrite');const store=tx.objectStore('wordCards');if(action==='delete')store.delete(card.id);else store.put(card);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});} finally {database.close();}
  }, {action,card});
  await alterTestCard('delete', originalCard);
  await click('关闭清单'); await click('搭配');
  await wait(async () => shadowCall('function(){const row=[...this.querySelectorAll(".rfv2-expression")].find(n=>n.querySelector("strong").textContent==="based on");return row.querySelector(".rfv2-saved-badge").hidden}'));
  await alterTestCard('restore', originalCard);
  await click('关闭清单'); await click('搭配');
  await wait(async () => shadowCall('function(){const row=[...this.querySelectorAll(".rfv2-expression")].find(n=>n.querySelector("strong").textContent==="based on");return !row.querySelector(".rfv2-saved-badge").hidden}'));
  checks.push('reopening the list refreshes saved state after card deletion and restoration');


  await click('关闭清单');
  await page.mouse.move(0,0); await page.locator('#repeat').hover();
  const point = await page.locator('#repeat').evaluate(element => {const node=element.firstChild;const start=node.textContent.indexOf('even when');const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+9);const r=range.getBoundingClientRect();return {x:r.left+5,y:r.top+r.height/2};});
  await page.mouse.move(point.x, point.y);
  await wait(async () => shadowCall('function(){const tip=this.querySelector(".rfv2-tip");return !tip.hidden&&tip.textContent.includes("even when")&&!tip.textContent.includes("让步：让步")}'));
  await page.mouse.click(point.x, point.y);
  assert(await shadowCall('function(){return !this.querySelector(".rfv2-pop").hidden&&this.querySelector(".rfv2-pop").textContent.includes("结果仍然基于当前页面")}'));
  await page.screenshot({path:join(directory,'learning-hint.png'),caret:'initial'});
  await click('关闭提示');
  checks.push('short connector hint is delayed and concrete explanation appears only on explicit click; legacy duplicated explanation is hidden');
  await click('设置'); await setMode('practice'); await click('完成');
  assert((await high()).every(h => h.name.endsWith('-expressions')));
  await click('设置');
  await shadowCall('function(){const label=[...this.querySelectorAll("label")].find(n=>n.textContent==="固定搭配下划线");const input=label.querySelector("input");input.checked=false;input.dispatchEvent(new Event("change"));}');
  assert.equal((await high()).length, 0);
  await setMode('full'); assert((await high()).some(h => h.name.endsWith('-core')));
  assert.equal(submissions.length, 2); await click('完成');
  checks.push('expression marks and thought-group backgrounds toggle independently');
  await click('退出'); assert.equal(await page.locator('article').innerHTML(), original); assert.equal((await high()).length, 0);
  await command('reading-focus:toggle'); await wait(async () => ['ready', 'highlighted'].includes((await state()).phase));
  assert.equal(submissions.length, 2);
  assert(await shadowCall('function(){return this.querySelector(".rfv2-preparation").hidden&&!this.querySelector(".rfv2-bar").hidden}'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('div')].some(el => [...el.attributes].some(a => a.name.startsWith('data-yemai-rf-') && a.value === 'scan'))), false);
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('readingFocusPreferencesV2')).readingFocusPreferencesV2);
  assert.equal(saved.initialized, true); assert(Math.abs(saved.dimOpacity - .15) < .01);
  assert.equal(await shadowCall('function(){return this.querySelector(".rfv2-pop").hidden}'), true);
  await click('搭配'); await wait(async () => (await state()).expressionTaskStatus === 'ready');
  assert.equal(submissions.length, 2); assert.equal(created, 2);
  checks.push('exit restores original article; reentry skips setup and reuses both analysis caches');
  await click('退出');
  await page.evaluate(() => { document.documentElement.style.background = '#fff'; document.documentElement.style.color = '#202830'; document.documentElement.style.colorScheme = 'light'; });
  await command('reading-focus:toggle'); await wait(async () => (await state()).phase === 'ready');
  assert.equal(await shadowCall('function(){return this.querySelector(".rfv2").dataset.theme}'), 'light');
  await page.mouse.move(0, 0); await page.locator('#definition').hover(); await wait(async () => (await state()).phase === 'highlighted');
  await page.screenshot({ path: join(directory, 'toolbar-light.png'), caret: 'initial' });
  await command('reading-focus:toggle');
  await page.goto(`${origin}/preparation-race`); await page.locator('[data-yebian-selection]').waitFor({ state: 'attached' });
  await command('reading-focus:toggle'); await wait(async () => (await state()).phase === 'ready');
  assert(await shadowCall('function(){return !this.querySelector(".rfv2-preparation").hidden&&this.querySelector(".rfv2-preparation").dataset.state==="ready"}'));
  await shadowCall('function(){const card=this.querySelector(".rfv2-preparation");[...card.querySelectorAll("button")].find(b=>b.textContent==="开始阅读").click();document.querySelector("#definition").firstChild.textContent+=" The source has changed.";}');
  await wait(async () => (await state()).phase === 'error');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert(await shadowCall('function(){const card=this.querySelector(".rfv2-preparation");return !card.hidden&&card.dataset.state==="error"&&card.textContent.includes("正文已变化")}'));
  await page.screenshot({ path: join(directory, 'preparation-source-changed.png') });
  checks.push('a source change during completion collapse cancels the old animation and keeps the new error visible');
  assert.deepEqual(errors, []);
  checks.push('toolbar follows page dark/light text theme and no page errors occurred');
  await writeFile(join(directory, 'result.json'), JSON.stringify({ evidence: 'built-extension with synthetic local WorkOS; no real account requests', created, submissions: submissions.map(({ mode, paragraphs }) => ({ mode, paragraphCount: paragraphs.length })), checks, errors }, null, 2));
  console.log(JSON.stringify({ directory, checks, errors, created }, null, 2));
} catch (error) {
  const diagnostics = { checks, errors, created, submissions: submissions.map(({ mode, paragraphs }) => ({ mode, paragraphCount: paragraphs.length })), lastState,
    ui: await inspectShadow?.('function(){return this.querySelector(".rfv2")?.textContent}').catch(() => undefined), error: error.message };
  await writeFile(join(directory, 'failure.json'), JSON.stringify(diagnostics, null, 2));
  console.error(JSON.stringify(diagnostics, null, 2));
  throw error;
} finally { await context?.close(); for (const stream of streams.values()) stream.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
