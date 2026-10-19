import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const samplePath = process.argv[3];
const output = resolve('output/interactive-preview');
await mkdir(output, { recursive: true });
const extensionPath = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(`${output}/profile`, {
  channel: 'chromium', headless: true, viewport: { width: 1300, height: 900 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const checks = [];
const failures = [];
const requests = [];
const copied = [];
let page;
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const origin = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com';
  const documents = new Map();
  documents.set('test.html', `<!doctype html><html lang="zh-CN"><head><title>交互检查</title><style>body{font:18px sans-serif}button{padding:12px}</style></head><body>
    <h1>交互检查</h1><button id="count">计数</button><output id="value">0</output>
    <button id="copy">复制测试</button><output id="copied"></output><a href="https://example.com/read">外部资料</a>
    <script>let n=0;count.onclick=()=>value.textContent=++n;copy.onclick=async()=>{try{await navigator.clipboard.writeText('交互复制验证');copied.textContent='成功'}catch{copied.textContent='失败'}};
    window.probe={extension:typeof chrome?.runtime,parent:false,storage:false};try{parent.parent.document.body;probe.parent=true}catch{}try{localStorage.getItem('credential');probe.storage=true}catch{}</script></body></html>`);
  documents.set('boundaries.html', `<!doctype html><html><body><h1>资源限制检查</h1><button id="jump">尝试跳转</button><button id="flood">自动复制</button><output id="attempt"></output><script>
    fetch('https://example.com/blocked-fetch').catch(()=>{});
    const image=new Image();image.src='https://example.com/blocked-image';document.body.append(image);
    const script=document.createElement('script');script.src='https://example.com/blocked-script';document.body.append(script);
    const frame=document.createElement('iframe');frame.src='https://example.com/blocked-frame';document.body.append(frame);
    navigator.clipboard.writeText('不应自动复制').then(()=>attempt.textContent='自动复制成功',()=>attempt.textContent='自动复制被阻止');
    jump.onclick=()=>location.href='https://example.com/blocked-navigation';
    </script></body></html>`);
  if (samplePath) documents.set('sample.html', await readFile(samplePath, 'utf8'));
  await context.route(`${origin}/interactive-fixtures/**`, async (route) => {
    const body = documents.get(new URL(route.request().url()).pathname.split('/').pop());
    await route.fulfill({ status: body ? 200 : 404, body: body ?? '', contentType: 'text/html; charset=utf-8' });
  });
  page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  context.on('request', (request) => requests.push(request.url()));
  const open = async (filename) => {
    const key = `artifact-preview:${crypto.randomUUID()}`;
    await worker.evaluate(({ key, artifact }) => chrome.storage.session.set({ [key]: { artifact, expiresAt: Date.now() + 60_000 } }), {
      key, artifact: { id: filename, filename, kind: 'file', status: 'available', url: `${origin}/interactive-fixtures/${filename}` },
    });
    await page.goto(`chrome-extension://${extensionId}/artifact-preview.html#${key}`);
    await page.evaluate(() => {
      window.__lastPreviewCopy = undefined;
      window.__previewCopyCount = 0;
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => { window.__lastPreviewCopy = text; window.__previewCopyCount++; return original(text); };
    });
    await page.locator('.preview-report[aria-busy="false"]').waitFor({ timeout: 15_000 });
    assert.equal(await page.locator('.preview-report-tools').count(), 0);
    assert.equal(await page.getByText(/关闭后不保留填写内容|静态预览/).count(), 0);
    assert.equal(await page.getByRole('button', { name: '重新加载', exact: true }).count(), 0);
    return page.frameLocator('iframe[title="HTML 交互页面"]').frameLocator('iframe[title="HTML 页面内容"]');
  };
  const report = await open('test.html');
  await report.getByRole('button', { name: '计数', exact: true }).click();
  assert.equal(await report.locator('#value').innerText(), '1');
  const inner = page.frames().find((frame) => frame.url() === 'about:srcdoc');
  assert.deepEqual(await inner.evaluate(() => window.probe), { extension: 'undefined', parent: false, storage: false });
  checks.push('production sandbox: inline JavaScript works without extension, parent DOM or storage access');
  await report.getByRole('button', { name: '复制测试' }).click();
  await report.locator('#copied').filter({ hasText: '成功' }).waitFor();
  assert.equal(await page.evaluate(() => window.__lastPreviewCopy), '交互复制验证');
  await report.getByRole('button', { name: '复制测试' }).click();
  await page.waitForFunction(() => window.__previewCopyCount === 2);
  copied.push('synthetic clicked copy');
  checks.push('user-triggered clipboard write through the bounded bridge');
  await page.getByRole('button', { name: '进入全屏', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await report.locator('#value').innerText(), '1');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await report.locator('#value').innerText(), '1');
  await page.getByRole('button', { name: '进入全屏', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.keyboard.press('Escape');
  // Headless Chrome may not dispatch its browser-level Escape behavior.
  if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
  await page.getByRole('button', { name: '进入全屏', exact: true }).waitFor();
  checks.push('real fullscreen enter/exit preserves the running HTML document');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.locator('.preview-source').waitFor();
  await page.getByRole('button', { name: '页面', exact: true }).click();
  assert.equal(await report.locator('#value').innerText(), '1');
  checks.push('source/page switching preserves the current interactive document');
  await report.getByRole('link', { name: '外部资料' }).click();
  await page.getByRole('link', { name: '打开链接：example.com', exact: true }).waitFor();
  assert.equal(page.url().startsWith(`chrome-extension://${extensionId}/`), true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  checks.push('external links require a visible host-side action and do not replace the preview');
  await page.reload();
  await page.locator('.preview-report[aria-busy="false"]').waitFor();
  assert.equal(await report.locator('#value').innerText(), '0');
  checks.push('browser reload resets temporary state; normal preview has no mode/status toolbar');
  const boundaryRequests = [];
  await context.route('https://example.com/**', async (route) => { boundaryRequests.push(route.request().url()); await route.abort(); });
  const boundaries = await open('boundaries.html');
  await boundaries.locator('#attempt').filter({ hasText: '自动复制被阻止' }).waitFor();
  assert.equal(await page.evaluate(() => window.__lastPreviewCopy), undefined);
  await boundaries.getByRole('button', { name: '尝试跳转' }).click();
  await page.waitForTimeout(350);
  assert.deepEqual(boundaryRequests, []);
  assert.equal(page.url().startsWith(`chrome-extension://${extensionId}/`), true);
  checks.push('network/script/image/frame/self-navigation attempts and automatic clipboard writes are blocked');
  if (samplePath) {
    const sample = await open('sample.html');
    await sample.getByRole('heading', { name: 'Blender 是什么，以及怎么装', exact: true }).waitFor();
    await sample.locator('select[data-am="theme"]').selectOption('paper');
    await sample.locator('select[data-am="mode"]').selectOption('dark');
    assert.equal(await sample.locator('html').getAttribute('data-theme'), 'paper');
    assert.equal(await sample.locator('html').getAttribute('data-mode'), 'dark');
    await sample.locator('.am-comment-btn').first().click();
    await sample.locator('.am-comment textarea').first().fill('请进一步解释安装步骤。');
    await sample.locator('[data-am="reply"]').click();
    await sample.locator('dialog[open]').waitFor();
    assert.match(await sample.locator('dialog textarea').inputValue(), /请进一步解释安装步骤/);
    await sample.locator('dialog[open]').getByRole('button', { name: '复制回复', exact: true }).click();
    await page.waitForFunction(() => window.__lastPreviewCopy?.includes('请进一步解释安装步骤。'));
    assert.match(await page.evaluate(() => window.__lastPreviewCopy), /请进一步解释安装步骤/);
    copied.push('sample composed reply');
    await page.screenshot({ path: `${output}/blender-reply.png` });
    await sample.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).click();
    await sample.locator('[data-am="remark"]').click();
    await sample.locator('.am-panel .am-md p').first().click();
    const popover = sample.locator('.am-remark-pop:not([hidden])');
    await popover.waitFor();
    await popover.getByRole('button', { name: '疑问', exact: true }).click();
    await popover.locator('textarea').fill('这段需要补充说明。');
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    assert.ok(await sample.locator('.am-mark[data-kind="question"]').count());
    await sample.locator('[data-am="remark"]').click();
    await sample.locator('[data-am="reply"]').click();
    assert.match(await sample.locator('dialog[open] textarea').inputValue(), /这段需要补充说明/);
    await sample.locator('dialog[open]').getByRole('button', { name: '关闭', exact: true }).click();
    if (await sample.locator('.am-diagram-expand').count()) {
      await sample.locator('.am-diagram-expand').first().click();
      await sample.locator('.am-lightbox:not([hidden])').waitFor();
      const stage = sample.locator('.am-lightbox-stage');
      await stage.hover();
      const before = await sample.locator('.am-lightbox-canvas').getAttribute('style');
      await page.mouse.wheel(0, -180);
      await page.waitForTimeout(120);
      assert.notEqual(await sample.locator('.am-lightbox-canvas').getAttribute('style'), before);
      await sample.locator('.am-lightbox-close').click();
      checks.push('sample diagram lightbox opens and responds to wheel zoom');
    }
    await sample.locator('[data-am="copy"]').click();
    await sample.locator('[data-am="copy"]').filter({ hasText: '已复制' }).waitFor();
    assert.match(await page.evaluate(() => window.__lastPreviewCopy), /Blender/);
    await page.screenshot({ path: `${output}/blender-wide.png` });
    await page.setViewportSize({ width: 380, height: 850 });
    await page.screenshot({ path: `${output}/blender-narrow.png` });
    checks.push('provided Blender HTML: theme/mode, comments, marks, reply composition, real copy and narrow/wide rendering');
  }
  assert.deepEqual(failures, []);
  await writeFile(`${output}/verification.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), boundary: 'Isolated production extension with synthetic URL routing; user HTML bytes loaded locally, no live WorkOS URL', checks, failures, boundaryRequests, copied, requests }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  if (page) {
    console.error(await page.locator('body').innerText());
    console.error('frames', page.frames().map((frame) => frame.url()));
    await page.screenshot({ path: `${output}/failure.png` });
  }
  throw error;
} finally { await context.close(); }
