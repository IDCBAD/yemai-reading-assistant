import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=resolve('output/baidu-extension');await mkdir(output,{recursive:true});
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html><title>Reading fixture</title><body><article><p id="sentence">The task is complete.</p><a href="/source">Source</a></article></body></html>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,extension=resolve('.output/chrome-mv3');let context;
const checks=[];
try{
 context=await chromium.launchPersistentContext(join(output,`profile-${Date.now()}`),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 // Synthetic provider inside this isolated worker; no external translation request.
 await worker.evaluate(()=>{
   const original=globalThis.fetch;globalThis.syntheticCalls=[];
   globalThis.fetch=async(...args)=>{if(String(args[0]).includes('fanyi-api.baidu.com')){const body=JSON.parse(args[1].body);globalThis.syntheticCalls.push({q:body.q,model:body.model_type});return new Response(JSON.stringify({trans_result:[{src:body.q,dst:body.q==='complete'?'完整的':'任务是完整的。'}]}),{headers:{'Content-Type':'application/json'}})}return original(...args)};
 });
 const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
 await panel.evaluate(()=>chrome.storage.local.set({wordTranslationSettings:{service:'auto',appid:'1234567890123',apiKey:'synthetic-translation-key',remoteEnabled:true}}));
 const page=await context.newPage();await page.goto(origin);await page.locator('[data-yebian-selection]').waitFor({state:'attached'});await page.bringToFront();
 await page.evaluate(()=>{const node=document.querySelector('#sentence').firstChild;const r=document.createRange();r.setStart(node,12);r.setEnd(node,20);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 const cdp=await context.newCDPSession(page);
 async function shadow(fn){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});function find(n){return n.attributes?.includes('data-yebian-selection')?n:(n.children||[]).map(find).find(Boolean)}const host=find(root);assert(host?.shadowRoots?.length);const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:host.shadowRoots[0].backendNodeId});const result=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value}
 const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Extension check timeout')};
 await panel.setViewportSize({width:360,height:780});
 const readingButton=panel.getByRole('button',{name:'开启辅助阅读',exact:true});
 await readingButton.waitFor({state:'visible'});
 const settings=panel.getByRole('dialog',{name:'设置',exact:true});
 if(await settings.isVisible()){
   await settings.getByRole('button',{name:'关闭设置',exact:true}).click();
   await settings.waitFor({state:'hidden'});
 }
 assert.equal(await panel.locator('.topbar .reading-focus-trigger').count(),0);
 assert.equal(await panel.locator('.composer-tools .reading-focus-trigger').count(),1);
 for(const width of [300,360,540]){
   await panel.setViewportSize({width,height:780});
   const bounds=await panel.locator('.composer-toolbar').evaluate(el=>{
     const toolbar=el.getBoundingClientRect();return [...el.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,toolbarLeft:toolbar.left,toolbarRight:toolbar.right,toolbarTop:toolbar.top,toolbarBottom:toolbar.bottom}});
   });
   assert(bounds.every(r=>r.left>=0&&r.right<=width&&r.left>=r.toolbarLeft-1&&r.right<=r.toolbarRight+1&&r.top>=r.toolbarTop-1&&r.bottom<=r.toolbarBottom+1),`bottom toolbar fits ${width}px`);
 }
 await panel.setViewportSize({width:360,height:780});
 await panel.screenshot({path:join(output,'bottom-reading-toolbar.png')});
 checks.push('reading entry uses bottom composer tools and fits 300/360/540px sidepanels');
 await until(()=>shadow('function(){return !this.querySelector(".selection-toolbar").hidden && this.querySelector(".selection-toolbar").dataset.visible==="true"}'));
 assert.deepEqual(await shadow('function(){return [...this.querySelector(".selection-toolbar").querySelectorAll("button")].filter(b=>!b.hidden).map(b=>b.textContent)}'),['查词','“引用']);
 assert(await shadow('function(){const t=this.querySelector(".selection-toolbar");const r=t.getBoundingClientRect();return r.width<=130&&r.left>=0&&r.right<=innerWidth}'));
 checks.push('selection toolbar contains lookup and quote only, with compact width');
 assert(await shadow('function(){return [...this.querySelectorAll("button")].some(b=>b.textContent==="查词"&&!b.hidden)}'));checks.push('lookup available without enabling reading focus');
 await shadow('function(){[...this.querySelectorAll("button")].find(b=>b.textContent==="查词").click()}');
 await until(()=>shadow('function(){const p=this.querySelector(".yemai-word-popover");return p&&!p.hidden&&p.getAttribute("aria-busy")==="false"&&p.textContent.includes("任务是完整的")}'));
 checks.push('content -> background -> synthetic Baidu -> rich popup');
 assert.equal((await worker.evaluate(()=>globalThis.syntheticCalls)).length,2);
 const texts=await shadow('function(){return this.querySelector(".yemai-word-popover").textContent}');assert(!texts.includes('synthetic-translation-key'));checks.push('credentials absent from content UI');
 await shadow('function(){this.querySelector(".yemai-word-save").click()}');await until(()=>shadow('function(){return this.querySelector(".yemai-word-save").textContent==="已收藏"}'));checks.push('translated word saves through normal collection flow');
 await page.keyboard.press('Escape');await until(()=>shadow('function(){return this.querySelector(".yemai-word-popover").hidden}'));checks.push('Escape closes real injected popup');
 assert.equal(await page.locator('a').getAttribute('href'),'/source');
 await writeFile(join(output,'checks.json'),JSON.stringify({checks,actualExtension:true,translationProvider:'synthetic',realApiCalls:0},null,2));console.log(JSON.stringify({checks},null,2));
}finally{await context?.close();await new Promise(r=>server.close(r))}
