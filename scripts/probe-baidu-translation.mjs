// Explicit opt-in probe. Credentials only from process environment, never persisted or printed.
import { createServer } from 'vite';
const appid=process.env.YEMAI_BAIDU_APPID,apiKey=process.env.YEMAI_BAIDU_API_KEY;
if(!appid||!apiKey)throw Error('Set the local probe environment credentials first.');
const vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
try{
 const {translateBaidu}=await vite.ssrLoadModule('/src/services/baiduTranslation.ts');
 const samples=[{model:'nmt',text:'complete'},{model:'llm',text:'complete',reference:'根据以下原句中的用法将目标词翻译成中文，仅返回该词在此处的中文译文。原句：at least one complete MPEG frame for MP3'}];
 const results=[];
 for(const sample of samples){const started=Date.now();try{results.push({model:sample.model,translation:await translateBaidu({appid,apiKey,...sample}),durationMs:Date.now()-started});}catch(error){results.push({model:sample.model,errorCode:typeof error?.code==='string'?error.code:'unknown',durationMs:Date.now()-started});}}
 console.log(JSON.stringify({realRequests:true,results},null,2));
}finally{await vite.close();}
