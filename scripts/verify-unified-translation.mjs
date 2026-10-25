import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import { createServer } from 'node:http';
const {chromium}=createRequire(import.meta.url)('C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=resolve('output/unified-translation');await mkdir(output,{recursive:true});
const mock=join(output,'browser-mock.js'),entry=join(output,'entry.tsx');
await writeFile(mock,'export const browser=globalThis.__translationBrowser;');
await writeFile(entry,`
// @ts-nocheck -- generated browser harness with explicit synthetic window bindings, not production source.
import React from 'react';import {createRoot} from 'react-dom/client';
import {MessageList} from '../../src/sidepanel/components/MessageList';
import {WordCardsPanel} from '../../src/sidepanel/components/WordCardsPanel';
import * as store from '../../src/services/wordCardStorage';
import '../../src/sidepanel/styles.css';
window.__wordStore=store;const root=createRoot(document.getElementById('root'));
window.showAnswer=()=>root.render(<MessageList messages={[{id:'answer-one',role:'assistant',content:'Refresh a theme, share a vault, write a guide, or make a video that helps someone discover a new way to use Obsidian.\\n\\nOnly this paragraph should be translated. The rest of the answer must stay private.',createdAt:1,status:'done'}]} savedMessageIds={new Set()} localTranslationEnabled={false} wordCollectionEnabled={true} onCollectWord={async capture=>{window.saved.push(capture)}} onUseStarter={()=>{}} onEditUserMessage={()=>{}} onRetryMessage={()=>{}} onCollectAssistantMessage={()=>{}} onCollectAssistantExcerpt={()=>{}} onOpenBranchOrigin={()=>{}} onAddAssistantQuote={()=>{}} onResolveDecision={()=>{}}/>);
window.showCards=async()=>{await store.saveWordCardCapture({word:'theme',sentence:'Refresh a theme.',meaning:'主题',meaningSource:'dictionary',source:{kind:'page',title:'Fixture',url:'https://example.com/'}});root.render(<WordCardsPanel open={true} embedded={true} onClose={()=>{}} onShowAnswers={()=>{}}/>)};
window.showAnswer();`);
const built=await build({configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock-browser',enforce:'pre',resolveId(id){if(id==='wxt/browser')return mock}}],build:{write:false,minify:false,lib:{entry,formats:['iife'],name:'translationHarness'},rollupOptions:{output:{inlineDynamicImports:true}}}});
const outputs=(Array.isArray(built)?built[0]:built).output,bundle=outputs.find(x=>x.type==='chunk').code,css=outputs.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n');
const browser=await chromium.launch({channel:'chrome',headless:true});const checks=[],errors=[];
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let page;
try{
 page=await browser.newPage({viewport:{width:700,height:900}});page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(10000);
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(()=>{
  window.pref={service:'baidu-nmt',remoteEnabled:true,configured:true};window.calls=[];window.saved=[];window.waiting=[];window.delay=false;
  const listeners=new Set();window.changePref=p=>{window.pref=p;listeners.forEach(fn=>fn({wordTranslationSettings:{}},'local'))};
  window.__translationBrowser={runtime:{getURL:p=>'/'+p.replace(/^\//,''),onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
   if(m.type==='word-translation:preference')return {ok:true,preference:window.pref};
   if(m.type==='word-translation:text'){window.calls.push(m.input);if(window.delay)return new Promise(resolve=>window.waiting.push(()=>resolve({ok:true,result:{translation:'迟到译文',service:'baidu-nmt',source:'baidu'}})));return {ok:true,result:{translation:m.input.text==='theme'?'主题':'译文：'+m.input.text,service:'baidu-nmt',source:'baidu'}}}
   const s=window.__wordStore;
   if(m.type==='word:update-meaning')return {ok:true,card:await s.updateWordCardMeaning(m.id,m.meaning,m.meaningSource,m.expectedUpdatedAt,m.expectedField)};
   if(m.type==='word:update-sentence-translation')return {ok:true,card:await s.updateWordCardSentenceTranslation(m.id,m.translation,m.expectedUpdatedAt,m.expectedField,m.source)};
   if(m.type==='word:enrich')return {ok:true,card:await s.enrichWordCard(m.id,m.captureKey,m.patch)};
   return {ok:true};
  }},storage:{local:{get:async()=>({wordCardAutoplay:false})},onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
 });
 await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.locator('[data-assistant-selectable="true"] p').first().waitFor();await page.waitForTimeout(200);
 const select=async(text)=>{
  await page.evaluate(text=>{const p=[...document.querySelectorAll('[data-assistant-selectable="true"] p')].find(p=>p.textContent.includes(text));const n=p.firstChild,i=n.textContent.indexOf(text);const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+text.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));},text);
  await page.getByRole('button',{name:'翻译',exact:true}).waitFor();
 };
 await select('theme');await page.getByRole('button',{name:'翻译',exact:true}).click();
 await page.waitForFunction(()=>window.calls.length===2);await page.locator('.assistant-selection-translation__context-result').waitFor();
 assert.equal(await page.locator('.assistant-selection-translation').getAttribute('aria-label'),'翻译');
 assert((await page.locator('.assistant-selection-translation').innerText()).includes('百度'));
 await page.locator('.assistant-selection-translation').getByRole('button',{name:/收藏/}).click();assert.equal(await page.evaluate(()=>window.saved[0].meaningSource),'baidu');checks.push('answer word translation works with legacy local toggle off and saves Baidu provenance');
 await page.keyboard.press('Escape');
 const passage='Only this paragraph should be translated. The rest of the answer must stay private.';
 await page.evaluate(()=>window.calls=[]);await select(passage);
 await page.keyboard.press('Control');await page.keyboard.press('Control');await page.waitForFunction(()=>window.calls.length>0);
 assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.text)),[passage]);checks.push('double Ctrl sends selected passage once without attaching the whole answer');
 await page.keyboard.press('Escape');await page.evaluate(()=>{window.calls=[];window.delay=true});await select('theme');await page.getByRole('button',{name:'翻译',exact:true}).click();
 await page.waitForFunction(()=>window.calls.length===1);await page.getByRole('button',{name:'关闭翻译',exact:true}).click();await page.evaluate(()=>{window.waiting.splice(0).forEach(fn=>fn())});await page.waitForTimeout(80);
 assert.equal(await page.locator('.assistant-selection-translation').count(),0);assert.equal(await page.evaluate(()=>window.calls.length),1);checks.push('closing blocks late UI results and the not-yet-sent context request');
 await page.evaluate(()=>{window.calls=[]});await select('theme');await page.getByRole('button',{name:'翻译',exact:true}).click();await page.waitForFunction(()=>window.calls.length===1);
 await page.evaluate(()=>window.changePref({service:'baidu-llm',remoteEnabled:true,configured:true}));await page.waitForTimeout(60);await page.evaluate(()=>window.waiting.splice(0).forEach(fn=>fn()));await page.waitForTimeout(80);assert.equal(await page.locator('.assistant-selection-translation').count(),0);checks.push('changing service invalidates pending answer results');
 await page.evaluate(()=>{window.calls=[];window.delay=false;return window.showCards()});await page.locator('.word-card h3').waitFor();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.calls.length),0);checks.push('opening a saved card does not request remote translation');
 await page.getByRole('button',{name:/^用百度/}).click();await page.locator('.word-card-sentence-translation').waitFor();
 assert.deepEqual(await page.evaluate(()=>window.calls.map(x=>x.text)),['Refresh a theme.']);
 assert.equal(await page.evaluate(async()=>(await window.__wordStore.loadWordCards())[0].sentenceTranslationSource),'baidu');
 checks.push('card manual sentence translation sends one field and persists Baidu source');
 await page.screenshot({path:join(output,'word-card.png')});
 assert.deepEqual(errors,[]);await writeFile(join(output,'checks.json'),JSON.stringify({checks,errors,realApiCalls:0,productionComponents:true,provider:'synthetic'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}catch(error){console.log(JSON.stringify({errors,body:(await page?.locator('body').innerText())?.slice(0,2000)}));throw error}
finally{await browser.close();await new Promise(r=>server.close(r))}
