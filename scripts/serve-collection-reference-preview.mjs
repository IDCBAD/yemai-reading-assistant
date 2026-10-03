// Real sidepanel components, isolated localhost IndexedDB and simulated browser/Agent.
// Does not read extension storage, real credentials or send requests to WorkOS.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const directory = 'output/collection-reference';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/browser.ts`, String.raw`
// @ts-nocheck -- simulated browser surface, outside production build
export const page = { title: 'Agent 能力与材料边界', site: 'example.com', url: 'https://example.com/agent', status: 'not-read',
  browserTabId: 1, sourceId: 'preview-page', accessHint: 'browser_only', pageType: 'article' };
const event = () => ({ addListener() {}, removeListener() {} });
const storage = {
  async get(keys) {
    const state = JSON.parse(localStorage.getItem('preview-browser-storage') || '{}');
    if (keys == null) return state;
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, state[key]]));
  },
  async set(patch) { const state = await storage.get(null); localStorage.setItem('preview-browser-storage', JSON.stringify({ ...state, ...patch })); },
  async remove(keys) { const state = await storage.get(null); for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; localStorage.setItem('preview-browser-storage', JSON.stringify(state)); },
};
let selectionsConsumed = Boolean(localStorage.getItem('preview-selections-consumed'));
export const browser = {
  storage: { local: storage, session: storage },
  runtime: {
    getManifest: () => ({ version: '0.6.1' }), getURL: (path) => '/' + path,
    connect: () => ({ disconnect() {}, onDisconnect: event() }), onMessage: event(),
    async sendMessage(request) {
      if (request.type === 'page:get-active-metadata') return { page };
      if (request.type === 'page:extract-active') return { page: { ...page, status: 'read', pageId: 'preview-page',
        markdown: new URLSearchParams(location.search).get('scenario') === 'capacity' ? '网页正文'.repeat(3000) : '# 当前网页正文\n网页与收藏一起作为本次材料。',
        contentHash: 'preview-rev', extractedAt: Date.now(), quality: 'high', truncated: false,
        manifest: { outline: [], relevant_links: [], truncated: false } } };
      if (request.type === 'selection:consume') {
        const quotes = selectionsConsumed ? [] : [{ id: 'preview-quote', text: '先确认材料，再发送问题。', pageTitle: page.title, pageUrl: page.url, createdAt: Date.now() }];
        selectionsConsumed = true; localStorage.setItem('preview-selections-consumed', '1'); return { quotes };
      }
      return { ok: true };
    },
  },
  tabs: { query: async () => [{ id: 1, windowId: 1, url: page.url }], onActivated: event(), onUpdated: event(), create: async () => ({ id: 2 }) },
  windows: { getCurrent: async () => ({ id: 1 }) },
};
`);
await writeFile(`${directory}/index.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页脉 · 收藏引用验证</title></head><body><div id="root"></div><script type="module" src="/output/collection-reference/main.tsx"></script></body></html>');
await writeFile(`${directory}/main.tsx`, String.raw`
// @ts-nocheck -- Vite-only fixture entrypoint
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '/src/sidepanel/App';
import { yemaiDatabase } from '/src/data/database';
import { WorkspaceRepository } from '/src/data/workspaceRepository';
import { INITIAL_WORKSPACE } from '/src/sidepanel/mockData';
import { page, browser } from './browser';
import '/src/sidepanel/styles.css';

if (!localStorage.getItem('collection-preview-seeded')) {
  const now = Date.now();
  const workspace = structuredClone(INITIAL_WORKSPACE);
  workspace.conversations[0].page = page;
  workspace.conversations[0].pages = [page];
  workspace.conversations[0].draftContextItems = [];
  const result = await new WorkspaceRepository(yemaiDatabase).save(workspace, now);
  await browser.storage.local.set({ workspaceUiState: result.ui, workosConnectionSettings: {
    schemaVersion: 2, transport: 'public-v1', agentUuid: '11111111-1111-4111-8111-111111111111', publicApiToken: 'AP_PREVIEW_ONLY',
    internalV2: { accessToken: '', userUuid: '', organizationUuid: '' },
  } });
  await yemaiDatabase.readingCards.bulkPut([
    { id: 'preview-card-1', kind: 'answer', question: '为什么插件能力应独立于 Agent？', title: '插件能力应独立于 Agent',
      bodyMarkdown: '## 材料由插件管理\n\n插件负责收集、保存与选择材料，Agent 负责回答问题。更换 Agent 时，收藏和来源仍可以使用。',
      excerpt: '插件管理材料，Agent 回答问题。', sources: [{ title: '能力边界', url: 'https://example.com/boundary' }] },
    { id: 'preview-card-2', kind: 'excerpt', question: '如何知道 Agent 使用了哪些输入？', title: '回答需要保留来源',
      bodyMarkdown: '随用户问题保存输入快照，之后回看仍能确认当时提供的材料。', excerpt: '保存本次输入快照。',
      sources: [{ title: '来源记录', url: 'https://example.com/sources' }] },
    { id: 'preview-card-old', kind: 'answer', title: '旧收藏：评估与反馈', bodyMarkdown: '没有评估就没有进步。', excerpt: '没有评估就没有进步。', sources: [] },
    { id: 'preview-card-long', kind: 'answer', title: '超长收藏测试', question: '长度边界', bodyMarkdown: '正文'.repeat(16000), excerpt: '仅用于验证长度提示。', sources: [] },
  ].map((card, i) => ({ ...card, sourceConversationId: 'deleted-source-chat', sourceMessageId: 'source-' + i,
    artifacts: [], createdAt: now - i * 60000, updatedAt: now - i * 60000, messageCreatedAt: now - i * 60000 })));
  localStorage.setItem('collection-preview-seeded', '1');
}

if (new URLSearchParams(location.search).get('scenario') === 'capacity') {
  await yemaiDatabase.readingCards.put({ id: 'preview-card-medium', kind: 'answer', title: '组合长度测试收藏', question: '长度测试',
    bodyMarkdown: '收藏正文'.repeat(5000), excerpt: '单条收藏可加入，但与完整网页组合后超限。', sources: [], artifacts: [],
    sourceConversationId: 'preview-source', sourceMessageId: 'preview-source-medium', createdAt: Date.now(), updatedAt: Date.now(), messageCreatedAt: Date.now() });
}

const nativeFetch = window.fetch.bind(window);
const requestLog = document.createElement('pre');
requestLog.id = 'preview-request-log';
requestLog.hidden = true;
requestLog.textContent = localStorage.getItem('preview-request-log') || '[]';
document.body.append(requestLog);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('https://power-api.yingdao.com/')) return nativeFetch(input, init);
  const logs = JSON.parse(requestLog.textContent || '[]');
  logs.push({ url, body: JSON.parse(init?.body || '{}') });
  requestLog.textContent = JSON.stringify(logs, null, 2);
  localStorage.setItem('preview-request-log', requestLog.textContent);
  if (url.endsWith('/conversations')) return new Response(JSON.stringify({ code: 0, data: { conversationUuid: 'preview-remote' } }), { headers: { 'Content-Type': 'application/json' } });
  const nested = (event) => 'data: ' + JSON.stringify({ data: JSON.stringify(event) }) + '\n\n';
  if (new URLSearchParams(location.search).get('scenario') === 'batch') {
    const chapters = ['模型后训练', '持续进化', '多智能体协作'];
    const task = (index, status) => nested({ type: 'message.part.updated', properties: { part: {
      id: 'preview-task-' + index, callID: 'preview-call-' + index, type: 'tool', tool: 'task', state: {
        status, input: { description: '阅读：' + chapters[index], subagent_type: 'general',
          prompt: '阅读 https://example.com/chapter-' + (index + 8) + '，围绕用户问题提炼核心观点并保留来源。' },
        metadata: { sessionId: 'ses_preview_' + index }, time: { start: Date.now() - 3200, ...(status === 'completed' ? { end: Date.now() } : {}) },
        ...(status === 'completed' && !(index === 1 && new URLSearchParams(location.search).get('details') === 'missing') ? { output: '<task_result>## ' + chapters[index] + '\n\n这是本地模拟的子任务结果。\n\n'
          + Array.from({ length: 6 }, (_, item) => '### 要点 ' + (item + 1) + '\n\n插件保存材料与来源，阅读任务由当前 Agent 处理。每项结果需要说明依据与限制。').join('\n\n')
          + '\n\n来源：https://example.com/chapter-' + (index + 8) + '</task_result>' } : {})
      }
    } } });
    let cancelled = false;
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(chapters.map((_, index) => task(index, 'running')).join('')));
        setTimeout(() => {
          if (cancelled) return;
          controller.enqueue(encoder.encode(chapters.map((_, index) => task(index, 'completed')).join('')
            + nested({ type: 'message.part.updated', properties: { part: { id: 'preview-answer', type: 'text',
              text: '## 三篇材料的联系\n\n模型后训练、持续进化与多智能体协作，分别讨论能力形成、反馈改进和任务分工。\n\n这是本地模拟回答，未真实读取网页，也未调用 WorkOS 子智能体。' } } })
            + nested({ type: 'xybot-stream-complete', properties: {} })));
          controller.close();
        }, 1600);
      }, cancel() { cancelled = true; }
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response(nested({ type: 'message.part.updated', properties: { part: { id: 'preview-answer', type: 'text', text: '已收到本次问题和引用材料。\n\n这是本地模拟回答，用于核对输入、快照和来源显示。' } } })
    + nested({ type: 'xybot-stream-complete', properties: {} }), { headers: { 'Content-Type': 'text/event-stream' } });
};
createRoot(document.getElementById('root')).render(<App />);
`);
if (process.argv.includes('--fixtures-only')) process.exit(0);
const server = await createServer({ configFile: false, plugins: [react()],
  resolve: { alias: { 'wxt/browser': resolve(directory, 'browser.ts') } },
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
});
await server.listen();
console.log('Collection reference verification: http://127.0.0.1:5193/output/collection-reference/index.html');
