import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.argv[2] || 'playwright');
const output = resolve('output/sidebar-idle');
const idleSeconds = process.argv.includes('--force-only') ? 0 : 45;
await mkdir(output, { recursive: true });
const extension = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(join(output, `profile-${Date.now()}`), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`;
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => chrome.storage.local.set({ workosConnectionSettings: { schemaVersion: 2, agentUuid: '11111111-1111-4111-8111-111111111111', transport: 'internal-v2', publicApiToken: '', internalV2: { accessToken: 'synthetic-token', userUuid: 'synthetic-user', organizationUuid: 'synthetic-org' } } }));
  await page.reload();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const tabs = page.getByRole('tab');
  await tabs.nth(1).waitFor();
  await page.getByRole('textbox', { name: '输入问题' }).fill('第二个对话的草稿');
  await page.waitForTimeout(500);
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  console.log(`two conversations ready; no task, idle ${idleSeconds} seconds without worker evaluate or debugger`);
  await new Promise((resolve) => setTimeout(resolve, idleSeconds ? idleSeconds * 1_000 : 500));
  await tabs.nth(0).click();
  await page.waitForTimeout(1_500);
  const selected = await tabs.nth(0).getAttribute('aria-selected');
  await page.screenshot({ path: join(output, selected === 'true' ? 'idle-fixed.png' : 'idle-repro.png') });
  console.log(JSON.stringify({ selected, errors }));
  assert.equal(selected, 'true', 'idle then clicking conversation 1 must switch without closing the panel');
  await tabs.nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected') === 'true');
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '第二个对话的草稿');
  assert.equal(await page.getByRole('textbox', { name: '输入问题' }).inputValue(), '第二个对话的草稿');
  const cdp = await context.newCDPSession(page);
  const versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: update }) => versions.push(...update));
  await cdp.send('ServiceWorker.enable');
  const until = Date.now() + 5_000;
  while (!versions.some((version) => version.scriptURL === worker.url())) {
    if (Date.now() > until) throw new Error('Background worker version not found');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const version = versions.filter((version) => version.scriptURL === worker.url()).at(-1);
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await page.waitForTimeout(500);
  await tabs.nth(0).click();
  await page.waitForTimeout(1_500);
  const restartedSelected = await tabs.nth(0).getAttribute('aria-selected');
  await page.screenshot({ path: join(output, restartedSelected === 'true' ? 'restart-fixed.png' : 'restart-repro.png') });
  console.log(JSON.stringify({ forcedWorkerRestartSelected: restartedSelected, errors }));
  assert.equal(restartedSelected, 'true', 'worker restart then clicking conversation 1 must switch without reopening');
  await tabs.nth(1).click();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '第二个对话的草稿');
  await cdp.detach();
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({ idleSeconds, switching: true, workerRestartSwitching: true, draftRetained: true, errors, scope: 'isolated Chromium extension page, no WorkOS requests, natural idle then explicit ServiceWorker.stopWorker' }, null, 2));
} finally { await context.close(); }
