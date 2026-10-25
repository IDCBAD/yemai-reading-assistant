import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'vite';

// Production popover with deterministic provider doubles. No account, credentials or API calls.
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  lib: { entry: resolve('src/content/readingWordPopover.ts'), formats: ['iife'], name: 'wordPopover' } } });
const bundle = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk').code;
const output = resolve('output/word-translation-popover'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.setContent('<html><body style="background:white"><main style="padding:80px;background:transparent"><p id="sentence">The task is complete. <a href="https://example.com">Source</a></p></main></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const host = document.createElement('div'); document.body.append(host); window.shadow = host.attachShadow({ mode: 'open' });
    window.saved = []; window.calls = []; window.pending = [];
    window.popover = wordPopover.createReadingWordPopover(window.shadow, {
      lookup: async () => 'adj. 完整的；完成的', pronunciation: () => '/kəmˈpliːt/', speak: () => {},
      save: async capture => window.saved.push(capture), getService: () => 'auto',
      enrich: (capture, service) => { window.calls.push({ capture, service }); return new Promise(resolve => window.pending.push(resolve)); },
    });
    window.openWord = (word = 'complete') => {
      const node = document.querySelector('#sentence').firstChild;
      const selection = getSelection(); const range = document.createRange();
      range.setStart(node, 12); range.setEnd(node, 20); selection.removeAllRanges(); selection.addRange(range);
      window.popover.show({ word, sentence: 'The task is complete.', highlightStart: 12, highlightEnd: 20,
        source: { kind: 'page', title: 'Test', url: 'https://example.com' } }, range.getBoundingClientRect());
    };
    window.openWord();
  });
  const panel = page.locator('.yemai-word-popover');
  await page.waitForFunction(() => window.pending.length === 1);
  assert.equal(await panel.locator('.yemai-word-meaning').textContent(), 'adj. 完整的；完成的');
  assert.equal(await panel.locator('.yemai-word-waiting').isVisible(), true);
  await page.evaluate(() => window.pending.shift()({ service: 'baidu-nmt', meaning: '完成的', sentenceTranslation: '任务已完成。', examples: [] }));
  await page.waitForFunction(() => window.shadow.querySelector('.yemai-word-waiting').hidden);
  assert.equal(await panel.locator('.yemai-word-context').count(), 0);
  assert.equal(await panel.locator('.yemai-word-example').count(), 1);
  assert.equal(await panel.locator('mark').textContent(), 'complete');
  await panel.getByText('收藏单词', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.saved[0].sentenceTranslationSource), 'baidu');
  checks.push('Local first, waiting, real data only, exact original highlight, save provenance');
  for (const [name, body, main, scheme] of [['white', '#fff', 'transparent', 'light'], ['dark', '#050707', 'transparent', 'dark'], ['paper', '#f2eee5', 'transparent', 'light'], ['mixed', '#fff', '#171b20', 'dark']]) {
    await page.evaluate(({ body, main }) => { document.body.style.background = body; document.querySelector('main').style.background = main; }, { body, main });
    await page.waitForFunction(expected => window.shadow.querySelector('section').style.colorScheme === expected, scheme);
    const bounds = await panel.boundingBox(); assert.equal(Math.round(bounds.width), 420); assert.ok(bounds.height < 600);
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    checks.push(`${name} surface: ${Math.round(bounds.width)} x ${Math.round(bounds.height)}, ${scheme}`);
  }
  await page.evaluate(() => window.openWord('old'));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() => window.openWord('complete'));
  await page.waitForFunction(() => window.pending.length === 2);
  await page.evaluate(() => { window.pending[1]({ service: 'baidu-llm', meaning: '新的释义', examples: [] }); window.pending[0]({ service: 'baidu-nmt', meaning: '过期结果', examples: [] }); window.pending = []; });
  await page.waitForFunction(() => window.shadow.querySelector('.yemai-word-meaning').textContent === '新的释义');
  await panel.getByText('Auto ▾', { exact: true }).click();
  await panel.getByRole('menuitemradio', { name: '百度 · 机器翻译' }).click();
  await page.waitForFunction(() => window.calls.at(-1).service === 'baidu-nmt');
  await page.keyboard.press('Escape'); assert.equal(await panel.isVisible(), false);
  await page.evaluate(() => window.pending[0]({ service: 'baidu-nmt', meaning: '关闭后迟到', examples: [] }));
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.locator('a').getAttribute('href'), 'https://example.com');
  assert.equal(await page.locator('a').textContent(), 'Source');
  checks.push('Stale results ignored, explicit service selection, Escape, no late reopen, original link unchanged');
  await page.setViewportSize({ width: 320, height: 580 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.openWord());
  const small = await panel.boundingBox(); assert.ok(small.x >= 12 && small.x + small.width <= 308);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.locator('.yemai-word-waiting i').first().evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.evaluate(() => window.popover.destroy()); assert.equal(await panel.count(), 0);
  checks.push('320px viewport bounds, reduced motion, destroy removes UI');
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ provider: 'deterministic doubles; no network', checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output, checks }, null, 2));
} finally { await browser.close(); }
