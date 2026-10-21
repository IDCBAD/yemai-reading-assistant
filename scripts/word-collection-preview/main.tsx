import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WordCardsPanel } from '../../src/sidepanel/components/WordCardsPanel';
import { ReadingCardsPanel } from '../../src/sidepanel/components/ReadingCardsPanel';
import { CollectionSurface } from '../../src/sidepanel/components/CollectionSurface';
import type { ReadingCardRow } from '../../src/data/database';
import { captureWordSelection } from '../../src/content/wordSelection';
import { collectWord } from '../../src/services/wordCollectionClient';
import { loadWordCards } from '../../src/services/wordCardStorage';
import { exportAllReadingCardsMarkdown, exportReadingCardMarkdown } from '../../src/services/readingCardExport';
import { WORD_COLLECTION_ENABLED_KEY, type WordCardCapture } from '../../src/shared/wordCards';
import { browser, previewControls } from './browser';
import '../../src/sidepanel/styles.css';

const source = { kind: 'page' as const, title: 'Browser agents: what they are and how they work', url: 'https://browser-use.com/posts/browser-agents' };
const contentMode = new URLSearchParams(window.location.search).get('content') === '1';
const examples = [
  ['adapt', '适应；调整', 'Agents are especially useful for unpredictable workflows because they can adapt to unexpected changes and recover from errors.'],
  ['navigates', '导航；浏览页面', 'You describe the task, and the agent automatically opens the page, navigates, chooses actions, and checks the results before continuing.'],
  ['recover', '恢复；从错误中恢复', 'Agents are especially useful for unpredictable workflows because they can adapt to unexpected changes and recover from errors.'],
];
const exampleAnswer: ReadingCardRow = {
  id: 'preview-answer', kind: 'answer', sourceConversationId: 'preview', sourceMessageId: 'preview-answer',
  title: '[示例] 浏览器 Agent 如何工作？', question: '浏览器 Agent 如何工作？',
  excerpt: '读取页面，选择动作，再检查结果。', bodyMarkdown: '读取页面，选择动作，再检查结果。\n\n这张示例卡片仅用于验证两种收藏的同级切换。',
  sources: [{ title: source.title, url: source.url }], artifacts: [],
  createdAt: 1792389600000, updatedAt: 1792389600000, messageCreatedAt: 1792389600000,
};
const exampleAnswers = ['浏览器 Agent 如何工作？', '观察页面与选择动作', '什么时候使用 API？', '动态页面中的操作', '工作流与不确定性', '检查每一步的结果', '失败后如何恢复', '让工具承担确定性工作', '阅读中的上下文'].map((title, index) => ({
  ...exampleAnswer, id: `preview-answer-${index}`, sourceMessageId: `preview-answer-${index}`,
  title: `[示例] ${title}`, question: title, createdAt: exampleAnswer.createdAt - index * 60000,
}));

function App() {
  const [open, setOpen] = useState(true);
  const [collectionKind, setCollectionKind] = useState<'answers' | 'words'>('words');
  const [capture, setCapture] = useState<WordCardCapture | null>(null);
  const [status, setStatus] = useState('可以在左侧原文划选单词，再点击收藏。');
  const [count, setCount] = useState<number>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [importing, setImporting] = useState(false);
  const [collectionEnabled, setCollectionEnabled] = useState(true);
  const [quoteCount, setQuoteCount] = useState(previewControls.quoteCount);
  const [speechStarts, setSpeechStarts] = useState(0);
  const [surfaceEntrances, setSurfaceEntrances] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(440);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [answerCount, setAnswerCount] = useState(exampleAnswers.length);
  const visibleAnswers = exampleAnswers.slice(0, answerCount);
  useEffect(() => {
    const listener = (event: TransitionEvent) => {
      if (event.propertyName === 'transform' && event.target instanceof HTMLElement
        && event.target.matches('.collection-surface-panel') && event.target.closest('.collection-surface.is-open')) {
        setSurfaceEntrances((count) => count + 1);
      }
    };
    document.addEventListener('transitionrun', listener);
    return () => document.removeEventListener('transitionrun', listener);
  }, []);
  useEffect(() => {
    let playing = false;
    const observer = new MutationObserver(() => {
      const next = Boolean(document.querySelector('.word-card-audio.is-playing'));
      if (next && !playing) setSpeechStarts((value) => value + 1);
      playing = next;
    });
    observer.observe(document.getElementById('root')!, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    void browser.storage.local.get(WORD_COLLECTION_ENABLED_KEY).then((values) => setCollectionEnabled(values[WORD_COLLECTION_ENABLED_KEY] !== false));
    if (!contentMode) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const globals = globalThis as unknown as { defineContentScript?: <T>(definition: T) => T };
    const originalDefine = globals.defineContentScript;
    globals.defineContentScript = <T,>(definition: T) => definition;
    void import('../../entrypoints/content').then((module) => {
      if (disposed) return;
      const definition = module.default as unknown as { main(ctx: { onInvalidated(cleanup: () => void): void }): void };
      definition.main({ onInvalidated(cleanup) { cleanups.push(cleanup); } });
      setStatus('已加载真实网页划词入口：双击或划选单词，再点击选词上方的“收藏单词”。');
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : '真实网页划词入口加载失败'));
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cleanups.splice(0).reverse().forEach((invalidate) => invalidate());
      globals.defineContentScript = originalDefine;
    };
    window.addEventListener('pagehide', cleanup, { once: true });
    if (import.meta.hot) import.meta.hot.dispose(cleanup);
    return () => { window.removeEventListener('pagehide', cleanup); cleanup(); };
  }, []);
  useEffect(() => {
    const reload = () => { void loadWordCards().then((rows) => setCount(rows.length)); setQuoteCount(previewControls.quoteCount); };
    reload(); browser.runtime.onMessage.addListener(reload);
    return () => browser.runtime.onMessage.removeListener(reload);
  }, []);
  const selected = () => {
    const selection = window.getSelection();
    setCapture(selection ? captureWordSelection(selection, source) : null);
  };
  const save = async (value: WordCardCapture | null = capture) => {
    if (!value) { setStatus('请先在原文中划选一个英语单词或短语。'); return; }
    setPending(true);
    try {
      const result = await collectWord(value);
      setStatus(`${result.alreadySaved ? '已收藏，未重复创建' : '已保存到本地数据库'}：${result.card.word}`);
      setOpen(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : '保存失败'); }
    finally { setPending(false); }
  };
  const simulateSelection = () => {
    const node = document.getElementById('preview-unpredictable')?.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange(); range.selectNodeContents(node);
    selection.removeAllRanges(); selection.addRange(range);
    const value = captureWordSelection(selection, source);
    setCapture(value); void save(value);
  };
  const loadExamples = async () => {
    setPending(true);
    try {
      if ((await loadWordCards()).length) { setStatus('已有收藏，未载入示例，现有数据保持不变。'); return; }
      for (const [word, meaning, sentence] of examples) {
        const highlightStart = sentence!.indexOf(word!);
        await collectWord({ word: word!, meaning, meaningSource: 'manual', sentence: sentence!, highlightStart, highlightEnd: highlightStart + word!.length, source: { ...source, title: `[示例] ${source.title}` } });
      }
      setStatus('已载入 3 张示例词卡；刷新页面后仍保留。'); setOpen(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : '载入失败'); }
    finally { setPending(false); }
  };
  return <main className="word-preview">
    <style>{`
      body { margin:0; background:#eef0f3; }
      .word-preview { display:grid; grid-template-columns:minmax(420px,1fr) minmax(360px,440px); min-height:100vh; color:#273143; font:14px/1.6 system-ui,sans-serif; }
      .preview-reading { padding:42px clamp(24px,5vw,80px); max-width:960px; }
      .preview-reading h1 { font:400 clamp(34px,4vw,54px)/1.12 Georgia,serif; letter-spacing:-1.3px; margin:22px 0; }
      .preview-reading article { font:21px/1.8 Georgia,serif; margin:28px 0; user-select:text; }
      .preview-reading article p { margin:0 0 23px; }
      .preview-reading article span { text-decoration:underline dotted #a7b7dc; text-underline-offset:6px; }
      .preview-label { color:#64718a; font-size:12px; }
      .preview-controls { padding:19px; border:1px solid #d6dce6; border-radius:12px; background:#fff; display:flex; flex-wrap:wrap; gap:12px; }
      .preview-controls button,.preview-reopen { min-height:38px; border:1px solid #c8d4eb; border-radius:7px; background:#eef3fe; color:#315eea; padding:7px 12px; cursor:pointer; font:inherit; font-size:12px; }
      .preview-controls button:disabled { opacity:.5; cursor:default; }
      .preview-controls label { display:flex; align-items:center; gap:6px; font-size:12px; }
      .preview-controls p { margin:0; flex-basis:100%; font-size:12px; color:#64718a; }
      .preview-status { min-height:54px; padding:12px 0; color:#3c5d92; font-size:12px; }
      .preview-sidebar { position:sticky; top:0; height:100vh; min-height:750px; border-left:1px solid #d8dee9; background:#fff; }
      .preview-sidebar-header { height:56px; padding:0 20px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #e0e4e9; font-size:13px; }
      .preview-sidebar-empty { padding:30px; color:#64718a; font-size:13px; }
      @media(max-width:800px) { .word-preview { grid-template-columns:1fr; } .preview-sidebar { position:relative; height:900px; min-height:900px; border:1px solid #d8dee9; } }
    `}</style>
    <section className="preview-reading">
      <div className="preview-label">本地组件验证 · 原文片段 · 浏览器发音使用本机英语语音</div>
      <h1>Browser agents:<br/>what they are and how they work</h1>
      <a className="preview-label" href={source.url} target="_blank" rel="noreferrer">browser-use.com · 查看原文 ↗</a>
      <article onMouseUp={selected} onKeyUp={selected}>
        <p>A browser agent is software that uses an AI model to operate a web browser toward a goal. You describe the task, and the agent automatically opens the page, <span>navigates</span>, chooses actions, and checks the results before continuing.</p>
        <p>Agents are especially useful for <span id="preview-unpredictable">unpredictable</span> workflows because they can <span>adapt</span> to unexpected changes and <span>recover</span> from errors.</p>
      </article>
      <div className="preview-controls">
        {!contentMode && <><button type="button" disabled={!capture || pending} onMouseDown={(event) => event.preventDefault()} onClick={() => void save()}>收藏{capture ? `「${capture.word}」` : '选中单词'}</button>
        <button type="button" disabled={pending} onClick={simulateSelection}>模拟选中 unpredictable 并收藏</button></>}
        <button type="button" disabled={count !== 0 || pending} onClick={() => void loadExamples()}>载入示例（仅空库）</button>
        <button type="button" onClick={() => { setCollectionKind('words'); setOpen(true); }}>打开单词收藏</button>
        <label>侧栏宽度<select aria-label="验证侧栏宽度" value={sidebarWidth} onChange={(event) => setSidebarWidth(Number(event.target.value))}>{[280, 320, 360, 440].map((width) => <option key={width} value={width}>{width}px</option>)}</select></label>
        <label>侧栏高度<select aria-label="验证侧栏高度" value={sidebarHeight} onChange={(event) => setSidebarHeight(Number(event.target.value))}>{[0, 320, 420, 520, 800].map((height) => <option key={height} value={height}>{height ? `${height}px` : '窗口高度'}</option>)}</select></label>
        <label>示例问答<select aria-label="验证问答数量" value={answerCount} onChange={(event) => setAnswerCount(Number(event.target.value))}>{[0, 1, 3, 9].map((total) => <option key={total} value={total}>{total} 张</option>)}</select></label>
        <label><input type="checkbox" checked={collectionEnabled} onChange={(event) => { const enabled = event.target.checked; setCollectionEnabled(enabled); void browser.storage.local.set({ [WORD_COLLECTION_ENABLED_KEY]: enabled }); }} />网页划词收藏</label>
        <label><input type="checkbox" checked={failure} onChange={(event) => { previewControls.saveFailure = event.target.checked; setFailure(event.target.checked); }} />模拟保存失败</label>
        <label><input type="checkbox" checked={importing} onChange={(event) => { previewControls.importInProgress = event.target.checked; setImporting(event.target.checked); }} />模拟备份导入中</label>
        <p>预览使用真实收藏组件、{contentMode ? '网页 content script、' : ''}捕获逻辑、消息客户端与 IndexedDB。仅消息传输在本页模拟；数据属于 localhost，不连接扩展或 WorkOS。示例释义为手动演示数据。</p>
        {contentMode && <p data-testid="preview-quote-count">引用次数：{quoteCount}（开启单词收藏时，划选单词应保持为 0；关闭后恢复侧栏已打开时的自动引用）</p>}
        <p data-testid="preview-speech-starts">收藏面板入场：{surfaceEntrances} 次（分类切换不应增加）<br />词卡语音实际启动：{speechStarts} 次（浏览器 onstart）</p>
      </div>
      <p className="preview-status" role="status" aria-live="polite">{status} · 当前 {count ?? '…'} 张词卡</p>
    </section>
    <section className="preview-sidebar" style={{ width: sidebarWidth, maxWidth: '100%', justifySelf: 'end', ...(sidebarHeight ? { height: sidebarHeight, minHeight: sidebarHeight } : {}) }}><header className="preview-sidebar-header"><strong>页脉</strong><span>真实组件验证</span></header>
      {!open && <div className="preview-sidebar-empty"><p>单词收藏已关闭。</p><button className="preview-reopen" type="button" onClick={() => setOpen(true)}>重新打开</button></div>}
      <CollectionSurface open={open} active={collectionKind} answerCount={visibleAnswers.length} wordCount={count ?? 0} onChange={setCollectionKind} onClose={() => setOpen(false)}>
      <div className="collection-surface-page" hidden={collectionKind !== 'answers'}>
      <ReadingCardsPanel embedded open={open && collectionKind === 'answers'} cards={visibleAnswers} conversations={[]} removalUndo={null}
        onClose={() => setOpen(false)} onShowWords={() => setCollectionKind('words')}
        onRemove={() => setStatus('示例问答不执行删除。')} onUndoRemove={() => {}} onOpenSource={() => setStatus('来源见左侧原文链接。')}
        onExportCard={async (card) => { const result = exportReadingCardMarkdown(card); setStatus(`已导出 ${result.filename}`); }} onExportAll={async (cards) => { const result = exportAllReadingCardsMarkdown(cards); setStatus(`已导出 ${cards.length} 张示例问答：${result.filename}`); }}
        onStartConversation={() => undefined} onSaveSelected={async () => []} />
      </div>
      <div className="collection-surface-page" hidden={collectionKind !== 'words'}>
      <WordCardsPanel embedded onCountChange={setCount} open={open && collectionKind === 'words'} onClose={() => setOpen(false)} onShowAnswers={() => setCollectionKind('answers')} />
      </div>
      </CollectionSurface>
    </section>
  </main>;
}
const previewRoot = (import.meta.hot?.data.root as ReturnType<typeof createRoot> | undefined)
  ?? createRoot(document.getElementById('root')!);
previewRoot.render(<App />);
if (import.meta.hot) import.meta.hot.dispose((data) => { data.root = previewRoot; });
