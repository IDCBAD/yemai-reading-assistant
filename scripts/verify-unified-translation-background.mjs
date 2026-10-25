import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const {chromium}=createRequire(import.meta.url)('C:/Users/xiao_/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=resolve('output/unified-translation-background'),extension=resolve('.output/chrome-mv3');await mkdir(output,{recursive:true});
const context=await chromium.launchPersistentContext(join(output,`profile-${Date.now()}`),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const checks=[];
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 await worker.evaluate(()=>{const original=globalThis.fetch;globalThis.manualCalls=[];globalThis.fetch=async(...args)=>{if(String(args[0]).includes('fanyi-api.baidu.com')){const body=JSON.parse(args[1].body);globalThis.manualCalls.push({text:body.q,model:body.model_type});return new Response(JSON.stringify({trans_result:[{src:body.q,dst:'合成译文'}]}),{headers:{'Content-Type':'application/json'}})}return original(...args)}});
 const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/sidepanel.html`);
 await panel.evaluate(()=>chrome.storage.local.set({localTranslationEnabled:false,wordTranslationSettings:{service:'baidu-nmt',remoteEnabled:true,appid:'1234567890123',apiKey:'synthetic-unified-key'}}));
 const preference=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'word-translation:preference'}));
 assert.equal(preference.ok,true);assert.deepEqual(preference.preference,{service:'baidu-nmt',remoteEnabled:true,configured:true});assert(!JSON.stringify(preference).includes('synthetic-unified-key'));assert(!JSON.stringify(preference).includes('1234567890123'));
 checks.push('trusted sidepanel receives public preference without credentials');
 for(let i=0;i<2;i++){
   const response=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'word-translation:text',input:{text:'Only the selected sentence.',service:'baidu-nmt'}}));
   assert.equal(response.ok,true);assert.equal(response.result.source,'baidu');assert.equal(response.result.translation,'合成译文');
 }
 assert.equal(await worker.evaluate(()=>globalThis.manualCalls.length),1);checks.push('built sidepanel text request reaches shared provider and repeat uses cache');
 const other=await context.newPage();await other.goto(`chrome-extension://${id}/artifact-preview.html`);
 const denied=await other.evaluate(()=>chrome.runtime.sendMessage({type:'word-translation:text',input:{text:'Untrusted document text.'}}));
 assert.equal(denied.ok,false);assert.equal(await worker.evaluate(()=>globalThis.manualCalls.length),1);checks.push('other extension documents cannot invoke manual remote translation');
 await panel.evaluate(()=>chrome.storage.local.set({wordTranslationSettings:{service:'baidu-nmt',remoteEnabled:false,appid:'1234567890123',apiKey:'synthetic-unified-key'}}));
 const stopped=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'word-translation:text',input:{text:'A new selected sentence.',service:'baidu-nmt'}}));
 assert.equal(stopped.ok,false);assert.equal(await worker.evaluate(()=>globalThis.manualCalls.length),1);checks.push('disabled remote service rejects new sidepanel text without submission');
 await writeFile(join(output,'checks.json'),JSON.stringify({checks,realApiCalls:0,actualExtension:true,provider:'synthetic'},null,2));console.log(JSON.stringify({checks},null,2));
}finally{await context.close()}
