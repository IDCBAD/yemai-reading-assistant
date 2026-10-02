import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { utils, write } from 'xlsx';

const directory = 'output/artifact-preview';
await mkdir(directory, { recursive: true });
const workbook = utils.book_new();
utils.book_append_sheet(workbook, utils.aoa_to_sheet([
  ['项目', '本周收入', '环比', '备注'], ['阅读服务', 12800, 0.12, '编号 001'], ['知识整理', 8600, 0.08, '已交付'],
  ...Array.from({ length: 220 }, (_, index) => [`项目 ${index + 1}`, 100 + index, 0.1, '用于验证分批展示']),
]), '经营汇总');
workbook.Sheets['经营汇总'].C2.z = '0%';
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['日期', '内容'], ['2026-10-02', '静态报告预览']]), '交付明细');
await writeFile(`${directory}/report.xlsx`, new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })));
const fixtures = {
  'report.md': '# 本周经营报告\n\n这份报告汇总了本周交付情况。\n\n| 项目 | 状态 |\n| --- | --- |\n| 阅读服务 | 已交付 |\n| 知识整理 | 已交付 |\n\n```json\n{"delivered": 12, "pending": 2}\n```\n\n```mermaid\nflowchart LR\n  A[阅读材料] --> B[生成报告] --> C[在线预览]\n```',
  'report.html': '<!doctype html><html><head><style>body{font-family:system-ui;color:#243247;padding:30px;line-height:1.6}h1{font-size:28px}.metric{padding:18px;background:#eef3ff;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #e5eaf1;text-align:left}</style></head><body><h1>本周经营报告</h1><p>2026 年 10 月 2 日 · 页脉</p><div class="metric">本周交付 <strong>12</strong> 项，待完成 2 项</div><h2>交付明细</h2><table><tr><th>项目</th><th>状态</th></tr><tr><td>阅读服务</td><td>已交付</td></tr></table><script>window.__unsafeReportRan=true;parent.document.body.dataset.compromised="yes"</script><img src="data:text/html,unsafe" onerror="parent.document.body.dataset.compromised=1"><a href="javascript:alert(1)">危险链接测试</a><form action="https://example.com"><input autofocus value="不提交表单"></form><meta http-equiv="refresh" content="0;url=https://example.com"></body></html>',
  'report.csv': '编号,说明,金额\r\n001,"包含,逗号",1200\r\n002,"多行\n说明",800\r\n003,=1+1,500',
  'report.json': '{"项目":"阅读服务","交付数量":12,"状态":["已完成","待处理"]}',
  'broken.json': '{broken: true',
  'notes.txt': '交付说明\n\n文件可以直接在线查看，也可以保留原始文件下载。',
};
for (const [name, contents] of Object.entries(fixtures)) await writeFile(`${directory}/${name}`, contents);
await writeFile(`${directory}/prototype.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页脉 · 产物预览原型</title></head><body><div id="root"></div><script type="module" src="/output/artifact-preview/prototype.tsx"></script></body></html>');
await writeFile(`${directory}/diagram.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="white"/><text x="100" y="100" font-size="40" fill="#253249">阅读材料 → 生成报告 → 在线预览</text><rect x="100" y="180" width="600" height="300" rx="20" fill="#edf2ff" stroke="#4268ed"/><text x="160" y="260" font-size="30" fill="#253249">图片缩放与拖动测试</text><text x="160" y="330" font-size="20">原始尺寸 1600 × 1000</text></svg>');
await writeFile(`${directory}/prototype.tsx`, String.raw`// @ts-nocheck
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantArtifacts } from '/src/sidepanel/components/AssistantArtifacts';
import { ArtifactPreview } from '/src/sidepanel/components/ArtifactPreview';
import { readPreviewTab } from '/src/sidepanel/previewTab';
import '/src/sidepanel/styles.css';
// Only the demo redirects image URLs. Production URLs and components are unchanged.
const setAttribute = Element.prototype.setAttribute;
const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  get: imageSrc.get,
  set(value) { imageSrc.set.call(this, value.startsWith('https://preview.example.test/') ? '/output/artifact-preview/' + new URL(value).pathname.slice(1) : value); },
});
Element.prototype.setAttribute = function(name, value) {
  if (this instanceof HTMLImageElement && name === 'src' && value.startsWith('https://preview.example.test/')) value = '/output/artifact-preview/' + new URL(value).pathname.slice(1);
  return setAttribute.call(this, name, value);
};
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://preview.example.test/')) {
    const filename = new URL(url).pathname.slice(1);
    if (filename === 'expired.md') return Promise.resolve(new Response('', { status: 403 }));
    if (filename === 'slow.md') return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('延迟内容')), 5000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    return originalFetch('/output/artifact-preview/' + filename, init).then((response) => {
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
  }
  return originalFetch(input, init);
};
const artifacts = ['report.md','report.html','report.xlsx','report.csv','report.json','notes.txt','broken.json','expired.md','slow.md','report.pdf'].map((filename, index) => ({
  id: filename, kind: 'file', filename, url: 'https://preview.example.test/' + filename, status: 'available', size: 1600,
}));
artifacts.unshift({ id:'image', kind:'image', filename:'流程图.svg', url:'https://preview.example.test/diagram.svg', status:'available', size:12000 });
function App() {
  const [artifact,setArtifact] = useState(null);
  const standalone = location.pathname === '/artifact-preview.html';
  useEffect(() => { if (standalone) void readPreviewTab().then(setArtifact); }, []);
  if (standalone) return artifact ? <ArtifactPreview artifact={artifact} standalone onClose={() => window.close()} /> : <p>正在打开预览…</p>;
  return <main style={{maxWidth:820,margin:'0 auto',padding:24,background:'#fff',minHeight:'100vh'}}><h1 style={{fontSize:22}}>页脉 · 产物预览</h1><p style={{fontSize:13,color:'#64748b'}}>模拟交付产物，用于检查图片、文档和表格的查看体验。</p><AssistantArtifacts artifacts={artifacts} /></main>;
}
createRoot(document.getElementById('root')).render(<App />);
`);
if (process.argv.includes('--fixtures-only')) process.exit(0);
const server = await createServer({
  configFile: false, plugins: [react(), { name: 'preview-prototype-route', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.split('?')[0] === '/artifact-preview.html') request.url = '/output/artifact-preview/prototype.html';
      next();
    });
  } }], server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
await server.listen();
console.log('Artifact preview prototype: http://127.0.0.1:5188/output/artifact-preview/prototype.html');
