// Throwaway icon study. Uses the real Composer; no production source changes or persistence.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const directory = 'output/batch-reading-icon-prototype';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/browser.ts`, 'export const browser = { runtime: { getURL: () => "/icon.svg" } };');
const paths = {
  A: '<rect x="8" y="7" width="12" height="14" rx="1.5"/><path d="M16 7V4.5A1.5 1.5 0 0 0 14.5 3h-9A1.5 1.5 0 0 0 4 4.5v12A1.5 1.5 0 0 0 5.5 18H8M11.5 11h5M11.5 14.5h5M11.5 18h3"/>',
  B: '<path d="M12 8c-2.3-2.2-5.2-2.8-9-2.3v12c3.8-.5 6.7.1 9 2.3 2.3-2.2 5.2-2.8 9-2.3v-12c-3.8-.5-6.7.1-9 2.3v12M6 9.5c1.3 0 2.3.3 3.3.9M6 13c1.3 0 2.3.3 3.3.9M18 9.5c-1.3 0-2.3.3-3.3.9M18 13c-1.3 0-2.3.3-3.3.9"/>',
  C: '<rect x="3" y="4.5" width="7.5" height="15" rx="1.3"/><rect x="13.5" y="4.5" width="7.5" height="15" rx="1.3"/><path d="M5.5 8.5h2.5M5.5 12h2.5M5.5 15.5h2.5M16 8.5h2.5M16 12h2.5M16 15.5h2.5"/>',
  D: '<path d="M5 3.5h10l4 4V20H5zM15 3.5v4h4M11 10h5M11 13.5h5M11 17h3"/><path d="M8 10h.01M8 13.5h.01M8 17h.01" stroke-width="2.6"/>',
};
for (const [key, content] of Object.entries(paths)) {
  await writeFile(`${directory}/${key}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`);
}
await writeFile(`${directory}/index.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页脉 · 批量阅读图标方案</title></head><body><div id="root"></div><script type="module" src="/output/batch-reading-icon-prototype/main.tsx"></script></body></html>');
await writeFile(`${directory}/main.tsx`, String.raw`
// @ts-nocheck -- disposable Vite-only prototype, all state in memory.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '/src/sidepanel/components/Composer';
import { KoboyoIcon } from '/src/sidepanel/components/KoboyoIcon';
import { BatchReadingDialog } from '/src/sidepanel/components/BatchReadingDialog';
import { addReadingLinks } from '/src/sidepanel/batchReading';
import { INITIAL_WORKSPACE } from '/src/sidepanel/mockData';
import '/src/sidepanel/styles.css';
import './prototype.css';

const options = [
  { key: 'A', name: '叠页', detail: '强调多篇材料。', tradeoff: '推荐：数量感明确，小尺寸下也清楚。' },
  { key: 'B', name: '展开书页', detail: '强调阅读。', tradeoff: '阅读感最强，但批量的含义较弱。' },
  { key: 'C', name: '并排文章', detail: '强调同时查阅。', tradeoff: '适合对照阅读，也可能被理解为分屏。' },
  { key: 'D', name: '阅读清单', detail: '强调逐篇处理。', tradeoff: '简洁，但与任务清单的含义接近。' },
];
const noop = () => {};
const activeTasks = new Set();
const page = { title: '工具 · AI Agents in Depth', url: 'https://example.com/agent-tools', site: 'example.com', status: 'not-read' };
const initialItems = [{ id: 'preview-page', kind: 'page', role: 'current', included: true, status: 'ready', createdAt: 1, page }];
const conversations = [1,2,3,4].map((number) => ({ ...INITIAL_WORKSPACE.conversations[0], id: 'preview-' + number, page, pages: [page] }));
const tabs = conversations.map((conversation, index) => ({ id: 'tab-' + (index + 1), conversationId: conversation.id, openedAt: 1 }));

function Preview() {
  const initialKey = new URLSearchParams(location.search).get('variant');
  const [variant, setVariant] = useState(options.some((option) => option.key === initialKey) ? initialKey : 'A');
  const [input, setInput] = useState('');
  const [items, setItems] = useState(initialItems);
  const [tabId, setTabId] = useState('tab-4');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const current = options.find((option) => option.key === variant);
  const select = (key) => { setVariant(key); const url = new URL(location.href); url.searchParams.set('variant', key); history.replaceState(null, '', url); };
  const cycle = (step) => select(options[(options.findIndex((option) => option.key === variant) + step + options.length) % options.length].key);
  useEffect(() => {
    const keydown = (event) => {
      if (open || event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [variant, open]);
  return <main className="icon-study" style={{ '--batch-icon': 'url("/output/batch-reading-icon-prototype/' + variant + '.svg")' }}>
    <header className="study-heading"><span className="study-eyebrow">页脉 · 入口图标预览</span><h1>批量阅读</h1><p>点击方案，查看输入区中的实际尺寸。</p></header>
    <section className="study-options" aria-label="图标方案">
      {options.map((option) => <button key={option.key} type="button" className={'study-option' + (variant === option.key ? ' is-selected' : '')}
        aria-pressed={variant === option.key} aria-label={'方案 ' + option.key + '：' + option.name} onClick={() => select(option.key)}>
        <span className="study-glyph" style={{ '--glyph': 'url("/output/batch-reading-icon-prototype/' + option.key + '.svg")' }} aria-hidden="true" />
        <span className="study-option-copy"><strong>{option.key} · {option.name}</strong><small>{option.detail}</small></span>
        <span className="study-size" style={{ '--glyph': 'url("/output/batch-reading-icon-prototype/' + option.key + '.svg")' }} aria-hidden="true" />
      </button>)}
    </section>
    <p className="study-verdict" aria-live="polite">{current.tradeoff}</p>
    <section className="study-live" aria-label="真实输入区预览">
      <div className="study-live-label"><span>输入区 · 17px 图标</span><span>悬浮或聚焦显示“批量阅读”</span></div>
      <Composer tabs={tabs} conversations={conversations} activeTabId={tabId} input={input} focusRequestId={0}
        contextItems={items} activeConversationIds={activeTasks} runSummary={null} historyOpen={false} connectionState="configured"
        fileUploadEnabled={false} fileAccept="" maxTabs={6} onSelectTab={setTabId} onCloseTab={noop} onNewConversation={noop}
        onToggleHistory={noop} onInputChange={setInput} onOpenBatchReading={() => setOpen(true)} onOpenCollectionReferences={() => setNotice('这是图标预览。')}
        onContextIncludedChange={(id, included) => setItems((old) => old.map((item) => item.id === id ? { ...item, included } : item))}
        onRemoveContextItem={(id) => setItems((old) => old.filter((item) => item.id !== id))} onRetryAttachment={noop}
        onFilesSelected={noop} onAttachmentUnavailable={() => setNotice('这是图标预览。')} smartSelectionActive={false} onStartSmartSelection={noop}
        onSend={() => { setNotice('这是图标预览，问题未发送。'); return false; }} onStop={noop} />
      {notice && <p className="study-notice" role="status">{notice}</p>}
    </section>
    <nav className="study-switcher" aria-label="切换图标方案"><button type="button" aria-label="上一个方案" onClick={() => cycle(-1)}>←</button>
      <span>{variant} · {current.name}</span><button type="button" aria-label="下一个方案" onClick={() => cycle(1)}>→</button></nav>
    {open && <BatchReadingDialog existingCount={items.filter((item) => item.kind === 'link').length} onClose={() => setOpen(false)}
      onAdd={(links) => { const result = addReadingLinks(items, links); if (result.error) return result.error; setItems(result.items); setOpen(false); }} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview />);
`);
await writeFile(`${directory}/prototype.css`, `
html,body,#root { height: auto; min-height: 100%; overflow: auto; }
body { margin: 0; background: #f4f5f6; }
.icon-study { width: min(100%, 680px); margin: 0 auto; padding: 28px 24px 90px; }
.study-heading { margin-bottom: 22px; }
.study-eyebrow { font-size: 11px; color: #6f7378; }
.study-heading h1 { margin: 7px 0; font-size: 24px; line-height: 1.4; font-weight: 600; letter-spacing: -.4px; }
.study-heading p { margin: 0; font-size: 12px; color: #6f7378; }
.study-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.study-option { display: flex; align-items: center; gap: 14px; min-width: 0; min-height: 106px; padding: 16px; border: 1px solid #dfe3e8; border-radius: 10px; text-align: left; color: #3c4043; background: #fff; cursor: pointer; }
.study-option:hover { border-color: #aebed4; }
.study-option.is-selected { border-color: #315eea; box-shadow: 0 0 0 1px #315eea; }
.study-option:focus-visible { outline: 2px solid #315eea; outline-offset: 3px; }
.study-glyph,.study-size { flex: none; display: block; width: 38px; height: 38px; background: currentColor; mask: var(--glyph) center/contain no-repeat; -webkit-mask: var(--glyph) center/contain no-repeat; }
.study-size { width: 17px; height: 17px; margin-left: auto; }
.study-option-copy { min-width: 0; }
.study-option-copy strong { display: block; font-size: 13px; font-weight: 500; }
.study-option-copy small { display: block; margin-top: 6px; color: #6f7378; font-size: 11px; line-height: 1.5; }
.study-verdict { min-height: 36px; margin: 12px 0 20px; font-size: 12px; line-height: 1.6; color: #6f7378; }
.study-live-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 9px; font-size: 11px; color: #6f7378; }
.study-live .composer { position: relative; flex: none; padding: 0; width: 100%; }
.study-live button[aria-label="批量阅读"] .koboyo-icon { --koboyo-icon: var(--batch-icon) !important; }
.study-live .composer-deck { box-shadow: none; }
.study-notice { color: #6f7378; font-size: 11px; }
.study-switcher { display: flex; align-items: center; justify-content: center; gap: 16px; position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 40; height: 44px; padding: 4px 8px; border-radius: 24px; color: #fff; background: #202124; box-shadow: 0 5px 16px #0002; font-size: 12px; }
.study-switcher button { display: grid; place-items: center; min-width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; color: #fff; background: transparent; font-size: 18px; cursor: pointer; }
.study-switcher button:hover { background: #ffffff20; }
.study-switcher button:focus-visible { outline: 2px solid #a9baff; }
.study-switcher span { min-width: 102px; text-align: center; }
@media(max-width:460px) { .icon-study { padding: 18px 14px 85px; } .study-option { gap: 8px; padding: 12px; min-height: 116px; flex-wrap: wrap; } .study-glyph { width: 30px; height: 30px; } .study-size { margin-left: 0; } .study-option-copy { flex: 1; } .study-live-label span:last-child { display: none; } }
`);
await writeFile(`${directory}/README.md`, '# 批量阅读图标预览\n\n四个临时 SVG 方案，仅用于选择入口图标；名称在预览中改为“批量阅读”。复用真实 Composer，以 Vite 内存转换替换名称，不修改生产代码。无存储或 Agent 请求。\n\n运行：`node scripts/serve-batch-reading-icon-prototype.mjs`。\n\n地址：`http://127.0.0.1:5195/output/batch-reading-icon-prototype/index.html?variant=A`；支持 A/B/C/D、方案按钮、底部箭头和左右键切换。\n');
if (process.argv.includes('--fixtures-only')) process.exit(0);
const server = await createServer({ configFile: false, plugins: [{ name: 'preview-reading-label', enforce: 'pre',
  transform(code, id) {
    if (id.split('?')[0].replaceAll('\\', '/').endsWith('/src/sidepanel/components/Composer.tsx')) return code.replaceAll('"添加网页"', '"批量阅读"');
    if (id.split('?')[0].replaceAll('\\', '/').endsWith('/src/sidepanel/components/BatchReadingDialog.tsx')) return code.replaceAll('添加网页', '批量阅读');
  },
}, react()], resolve: { alias: { 'wxt/browser': resolve(directory, 'browser.ts') } }, server: { host: '127.0.0.1', port: 5195, strictPort: true } });
await server.listen();
console.log('Batch reading icon prototype: http://127.0.0.1:5195/output/batch-reading-icon-prototype/index.html?variant=A');
