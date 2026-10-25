import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';

// Public, rendered DOM evidence only. This tool never reads connection settings or calls WorkOS.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--url', '--id', '--playwright', '--html', '--browser-channel'].includes(key) || !process.argv[index + 1]) throw new Error('Usage: node scripts/capture-reading-focus-corpus.mjs --url https://… --id sample-id [--playwright module-path] [--html saved-rendered.html] [--browser-channel chrome]');
  options.set(key, process.argv[index + 1]);
}
const url = new URL(options.get('--url') ?? '');
if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected a public HTTP(S) URL without credentials.');
const id = options.get('--id');
if (options.has('--browser-channel') && !['chrome','msedge','chromium'].includes(options.get('--browser-channel'))) throw new Error('Unsupported browser channel.');
if (!id || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(id)) throw new Error('Expected a lowercase sample id containing letters, digits and hyphens.');
const { chromium } = require(options.get('--playwright') ?? 'C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const startedAt = new Date().toISOString();
const replay = options.get('--html');
const output = resolve(root, 'output/reading-focus-corpus/captures', id, startedAt.replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const started = performance.now();
let browser;
let vite;
const writeJson = (name, value) => writeFile(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
try {
  vite = await createServer({ root, configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: 'custom' });
  const compiled = await build({
    root, configFile: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'corpus-capture-entry', formats: ['iife'], name: '__readingCorpusProduction' } },
    plugins: [{ name: 'production-vite-transform',
      resolveId(path) {
        if (path === 'corpus-capture-entry' || path === resolve(root, 'corpus-capture-entry')) return '\0corpus-capture-entry';
        if (path.startsWith('/src/')) return resolve(root, path.slice(1).split('?')[0]);
      },
      async load(path) {
        if (path === '\0corpus-capture-entry') return 'export { readingParagraphs } from "/src/content/readingFocus/index.ts"; export { paragraphText } from "/src/content/readingFocus/text.ts"; export { buildPageReadingPrompt, validatePageReadingSnapshot, ANALYSIS_VERSION } from "/src/shared/pageReadingFocus.ts";';
        if (!path.endsWith('.ts') || !isAbsolute(path) || relative(root, path).startsWith('..')) return;
        const transformed = await vite.transformRequest(`/${relative(root, path).replaceAll('\\', '/')}`);
        if (!transformed) throw new Error(`Could not transform production module: ${path}`);
        return transformed.code;
      },
    }],
  });
  console.log(JSON.stringify({ id, stage: 'production-module-ready' }));
  browser = await chromium.launch({ headless: true, timeout: 60_000, ...(options.has('--browser-channel') ? {channel:options.get('--browser-channel')} : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(replay ? {javaScriptEnabled:false} : {}) });
  if (replay) {
    const html = await readFile(resolve(replay), 'utf8');
    await context.route('**/*', route => route.request().url() === url.href
      ? route.fulfill({status:200,contentType:'text/html',body:html}) : route.abort());
  }
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  console.log(JSON.stringify({ id, stage: 'public-page-navigation' }));
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  // Allow initial hydration, without waiting on advertising/analytics requests or opening collapsed content.
  await page.waitForTimeout(1200);
  const title = await page.title();
  const status = response?.status() ?? null;
  const html = await page.content();
  await writeFile(resolve(output, 'rendered.html'), html);
  await page.screenshot({ path: resolve(output, 'viewport.png'), timeout: 5000 }).catch(()=>{});
  const blocked = status === null || status >= 400 || /just a moment|verify (?:you are|that you)|access denied|attention required/i.test(title);
  if (blocked) throw new Error(`Page not available for DOM capture: HTTP ${status}; title=${title}`);
  const bundle = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item=>item.type==='chunk').code;
  const result = await page.evaluate(`${bundle}\n(() => {
    const {readingParagraphs,paragraphText,buildPageReadingPrompt,validatePageReadingSnapshot,ANALYSIS_VERSION}=__readingCorpusProduction;
    const roots = [...document.querySelectorAll('.markdown-body,.theme-doc-markdown,.vp-doc,.sl-markdown-content,.prose,[itemprop="articleBody"],article,main,[role="main"]')];
    const chosen = readingParagraphs(document);
    const describe = (node) => node ? {tag:node.tagName,domId:node.id,className:node.className} : null;
    const snapshots = chosen.paragraphs.map((node,index)=>({id:'p'+index,text:paragraphText(node).text}));
    const snapshot={url:document.URL,title:document.title,paragraphs:snapshots};
    const details=chosen.paragraphs.map((node,index)=>({...snapshots[index],...describe(node),visibleText:node.innerText}));
    // Candidate blocks are audit evidence, not a second extraction algorithm.
    const rootAudit=roots.map((node,index)=>{
      // Record candidate blocks and selected descendants separately; candidates are not all eligible paragraphs.
      const blocks=[...node.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,dt,dd,blockquote,.mdx-content [data-as="p"],.mdx-content [data-as="li"]')];
      const selected=chosen.paragraphs.filter(block=>node.contains(block));
      return {index,...describe(node),selected:node===chosen.root,text:node.innerText,textCharacters:node.innerText.length,
        candidateBlockCount:blocks.length,candidateBlocks:blocks.map(block=>({...describe(block),text:paragraphText(block).text})),
        selectedParagraphCount:selected.length,selectedTextCharacters:selected.reduce((sum,block)=>sum+paragraphText(block).text.length,0)};
    });
    const visibleMain=[...document.querySelectorAll('main,[role="main"],article')].map(node=>({...describe(node),text:node.innerText}));
    let prompt=null,validationError=null;
    try{validatePageReadingSnapshot(snapshot);prompt=buildPageReadingPrompt(snapshot);}catch(error){validationError=error.message;}
    return {analysisVersion:ANALYSIS_VERSION,snapshot,details,rootAudit,visibleMain,selectedRoot:describe(chosen.root),prompt,validationError};
  })()`);
  const { prompt, ...audit } = result;
  const capture = { id, requestedUrl: url.href, finalUrl: page.url(), startedAt, capturedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), httpStatus: status, evidence: replay ? 'saved-rendered-html-replay' : 'live-rendered-public-dom', ...(replay ? {replayedFrom:resolve(replay)} : {}), state: result.validationError ? 'captured-not-analyzable' : 'captured', pageErrors, ...audit };
  await writeJson('capture.json', capture);
  await writeJson('snapshot.json', result.snapshot);
  await writeJson('roots.json', result.rootAudit);
  await writeFile(resolve(output, 'visible-main.txt'), result.visibleMain.map(({text})=>text).join('\n\n--- NEXT ROOT ---\n\n'));
  if (prompt) await writeFile(resolve(output, 'prompt.txt'), prompt);
  console.log(JSON.stringify({ id, state: capture.state, paragraphs: result.snapshot.paragraphs.length, textCharacters: result.snapshot.paragraphs.reduce((sum, {text})=>sum+text.length,0), selectedRoot: result.selectedRoot, validationError: result.validationError, output }));
} catch (error) {
  const failure = { id, requestedUrl: url.href, startedAt, endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), evidence: 'capture-attempt-only', state: 'blocked', error: error.message };
  await writeJson('failure.json', failure);
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
} finally {
  const deadline = (operation) => Promise.race([operation, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
  await deadline(browser?.close());
  await deadline(vite?.close());
  // Vite's background dependency workers can otherwise retain handles after a capture-only invocation.
  process.exit(process.exitCode ?? 0);
}
