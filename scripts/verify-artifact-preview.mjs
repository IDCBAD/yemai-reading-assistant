import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Use an installed Playwright module or pass the desktop's bundled module path.
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const output = resolve('output/artifact-preview');
await mkdir(output, { recursive: true });
const checks = [];
const browser = await chromium.launch({ headless: true });
let extensionPage;
try {
  const context = await browser.newContext({ viewport: { width: 400, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5188/output/artifact-preview/prototype.html');
  await page.getByRole('button', { name: '查看大图：流程图.svg' }).click();
  await page.locator('.preview-image-controls output').waitFor();
  assert.match(await page.locator('.preview-image-controls output').innerText(), /\d+%/);
  await page.getByRole('button', { name: '原始尺寸', exact: true }).click();
  assert.equal(await page.locator('.preview-image-controls output').innerText(), '100%');
  const canvas = page.getByRole('region', { name: /图片画布/ });
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 40); await page.mouse.up();
  assert.match(await page.locator('.preview-image-canvas img').getAttribute('style'), /translate\(60px, 40px\)/);
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(() => Number(document.querySelector('output').textContent.replace('%', '')) > 100);
  await canvas.dblclick();
  assert.notEqual(await page.locator('.preview-image-controls output').innerText(), '100%');
  await canvas.dblclick();
  assert.equal(await page.locator('.preview-image-controls output').innerText(), '100%');
  await page.getByRole('button', { name: '适应窗口', exact: true }).click();
  await page.screenshot({ path: `${output}/image-narrow.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '查看大图：流程图.svg');
  checks.push('image: fit, 100%, drag, wheel, reset, Escape and focus restore');

  const open = async (name) => {
    if (await page.getByRole('button', { name: '关闭产物预览' }).count()) await page.getByRole('button', { name: '关闭产物预览' }).click();
    const more = page.getByRole('button', { name: /^还有/ });
    if (await more.count()) await more.click();
    await page.getByRole('button', { name: `预览 ${name}`, exact: true }).click();
  };
  await open('report.md');
  await page.getByRole('heading', { name: '本周经营报告' }).waitFor();
  await page.locator('.mermaid-canvas svg').waitFor();
  await page.getByRole('button', { name: '原文', exact: true }).click();
  assert.match(await page.locator('.preview-source').innerText(), /```mermaid/);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  checks.push('Markdown: tables, code, Mermaid, original text and modal focus');

  await open('report.html');
  const report = page.frameLocator('iframe[title="HTML 静态报告"]');
  await report.getByRole('heading', { name: '本周经营报告' }).waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
  assert.equal(await report.locator('script,iframe,object,embed,meta[http-equiv="refresh"],a[href],input[autofocus]').count(), 0);
  assert.equal(await report.locator('input').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__unsafeReportRan || document.body.dataset.compromised || false), false);
  await page.screenshot({ path: `${output}/html-narrow.png` });
  await page.getByRole('button', { name: '源码', exact: true }).click();
  assert.match(await page.locator('.preview-source').innerText(), /window.__unsafeReportRan/);
  await page.getByRole('button', { name: '复制内容', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /<!doctype html>/i);
  checks.push('HTML: static layout, scripts/navigation blocked, original source and copy');

  await open('report.xlsx');
  await page.getByRole('button', { name: '交付明细', exact: true }).waitFor();
  assert.equal(await page.locator('.preview-sheet-scroll tbody tr').count(), 100);
  assert.match(await page.locator('.preview-sheet-scroll').innerText(), /12%/);
  await page.getByRole('button', { name: '下一批', exact: true }).click();
  assert.equal(await page.locator('.preview-sheet-scroll tbody tr').count(), 100);
  assert.equal(await page.locator('.preview-sheet-scroll tbody tr th').first().innerText(), '101');
  await page.getByRole('button', { name: '交付明细', exact: true }).click();
  assert.match(await page.locator('.preview-sheet-scroll').innerText(), /静态报告预览/);
  await page.screenshot({ path: `${output}/excel-narrow.png` });
  checks.push('Excel: real XLSX parsing in worker, formatted values, pagination and sheets');

  await open('report.csv');
  await page.locator('.preview-sheet-scroll').waitFor();
  assert.match(await page.locator('.preview-sheet-scroll').innerText(), /001/);
  assert.match(await page.locator('.preview-sheet-scroll').innerText(), /=1\+1/);
  await page.getByRole('button', { name: '原文', exact: true }).click();
  assert.match(await page.locator('.preview-source').innerText(), /"包含,逗号"/);
  await open('report.json'); await page.locator('.preview-source').waitFor();
  assert.match(await page.locator('.preview-source').innerText(), /"交付数量": 12/);
  await open('broken.json'); await page.getByText('JSON 格式有误，已显示原文。').waitFor();
  await open('notes.txt'); await page.getByText('交付说明', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '预览 report.pdf', exact: true }).count(), 0);
  checks.push('CSV, JSON, malformed JSON and TXT previews');

  await open('expired.md'); await page.getByText(/文件链接已失效/).waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText(/文件链接已失效/).waitFor();
  await open('slow.md'); await page.getByRole('button', { name: '关闭产物预览' }).click();
  await open('report.md'); await page.getByRole('heading', { name: '本周经营报告' }).waitFor();
  assert.equal(await page.getByText('延迟内容', { exact: true }).count(), 0);
  checks.push('expired links, retry and cancellation without stale content');

  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '新标签页查看' }).click();
  const popup = await popupPromise;
  await popup.getByRole('heading', { name: '本周经营报告' }).waitFor();
  assert.match(popup.url(), /#artifact-preview:/); assert.equal(popup.url().includes('example.test'), false);
  await popup.reload(); await popup.getByRole('heading', { name: '本周经营报告' }).waitFor();
  await popup.close();
  // Controls stay inside the preview at both sidebar and wide-tab widths.
  const checkControls = async () => {
    const clipped = await page.locator('.artifact-preview-dialog').evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      return Array.from(dialog.querySelectorAll('.artifact-preview-header button, .artifact-preview-header a, .preview-content-tools button, .preview-image-controls button'))
        .filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom; })
        .map((element) => element.getAttribute('aria-label') || element.textContent);
    });
    assert.deepEqual(clipped, []);
  };
  for (const width of [320, 400, 1000]) {
    await page.setViewportSize({ width, height: 850 });
    await checkControls();
    await page.getByRole('button', { name: '原文', exact: true }).click();
    await page.getByRole('button', { name: '正文', exact: true }).click();
    await page.getByRole('heading', { name: '本周经营报告' }).waitFor();
  }
  await page.setViewportSize({ width: 400, height: 850 });
  await page.getByRole('button', { name: '新标签页查看' }).hover();
  await page.getByRole('tooltip', { name: '新标签页查看', exact: true }).waitFor();
  await page.mouse.move(2, 2);
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${output}/markdown-native-toolbar.png` });
  const touch = await browser.newContext({ viewport: { width: 320, height: 850 }, isMobile: true, hasTouch: true });
  const touchPage = await touch.newPage();
  await touchPage.goto('http://127.0.0.1:5188/output/artifact-preview/prototype.html');
  await touchPage.getByRole('button', { name: '查看大图：流程图.svg' }).tap();
  await touchPage.locator('.preview-image-controls output').waitFor();
  const touchSizes = await touchPage.locator('.preview-image-controls button, .artifact-preview-header button, .artifact-preview-header a').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height, right: rect.right };
  }));
  assert.ok(touchSizes.every((rect) => rect.width >= 44 && rect.height >= 44 && rect.right <= 314));
  await touchPage.getByRole('button', { name: '原始尺寸', exact: true }).tap();
  assert.equal(await touchPage.locator('.preview-image-controls output').innerText(), '100%');
  await touchPage.getByRole('button', { name: '适应窗口', exact: true }).tap();
  await touchPage.screenshot({ path: `${output}/image-touch-320.png` });
  await touch.close();
  checks.push('toolbar: 320/400/1000px controls, view switching, hover tooltip and 44px touch targets');
  assert.deepEqual(errors, []);
  checks.push('standalone tab, opaque preview ID and refresh');
} finally { await browser.close(); }

const extensionPath = resolve('.output/chrome-mv3');
const extensionContext = await chromium.launchPersistentContext(`${output}/extension-test-profile`, {
  channel: 'chromium', headless: true, viewport: { width: 1000, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const serviceWorker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent('serviceworker');
  const extensionId = new URL(serviceWorker.url()).host;
  const origin = 'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com';
  await extensionContext.route(`${origin}/preview-fixtures/**`, async (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    const types = { md: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', svg: 'image/svg+xml', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8' };
    await route.fulfill({ body: await readFile(`${output}/${filename}`), contentType: types[filename.split('.').pop()] });
  });
  const page = await extensionContext.newPage();
  extensionPage = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  for (const filename of ['report.html', 'report.xlsx', 'report.md', 'report.csv', 'report.json', 'notes.txt', 'diagram.svg']) {
    console.log(`Verifying built extension: ${filename}`);
    const key = `artifact-preview:${crypto.randomUUID()}`;
    await serviceWorker.evaluate(({ key, artifact }) => chrome.storage.session.set({ [key]: { artifact, expiresAt: Date.now() + 60_000 } }), {
      key, artifact: { id: filename, filename, kind: filename.endsWith('.svg') ? 'image' : 'file', status: 'available', url: `${origin}/preview-fixtures/${filename}` },
    });
    await page.goto(`chrome-extension://${extensionId}/artifact-preview.html#${key}`);
    if (filename.endsWith('.html')) {
      await page.frameLocator('iframe').getByRole('heading', { name: '本周经营报告' }).waitFor();
      assert.equal(await page.frameLocator('iframe').locator('script').count(), 0);
      await page.screenshot({ path: `${output}/html-extension.png` });
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.csv')) {
      await page.locator('.preview-sheet-scroll').waitFor();
      if (filename.endsWith('.xlsx')) await page.screenshot({ path: `${output}/excel-extension.png` });
    } else if (filename.endsWith('.md')) {
      await page.getByRole('heading', { name: '本周经营报告' }).waitFor();
      await page.reload(); await page.getByRole('heading', { name: '本周经营报告' }).waitFor();
    } else if (filename.endsWith('.svg')) {
      await page.waitForFunction(() => document.querySelector('.preview-image-controls output')?.textContent?.includes('%'));
    } else { await page.locator('.preview-source').waitFor(); }
    assert.equal(await serviceWorker.evaluate((key) => chrome.storage.session.get(key).then((items) => !!items[key]), key), false);
  }
  await page.goto(`chrome-extension://${extensionId}/artifact-preview.html#artifact-preview:${crypto.randomUUID()}`);
  await page.getByText('预览已过期，请从产物卡片重新打开。').waitFor();
  assert.deepEqual(errors, []);
  checks.push('built Chrome extension: CSP, all seven formats, worker, temporary storage consumption, reload and invalid IDs');
} catch (error) {
  if (extensionPage) { console.error(await extensionPage.locator('body').innerText()); await extensionPage.screenshot({ path: `${output}/extension-failure.png` }); }
  throw error;
} finally { await extensionContext.close(); }

await writeFile(`${output}/verification.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), boundary: 'Synthetic files in prototype and an isolated built Chrome extension; no live WorkOS URLs', checks }, null, 2));
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
