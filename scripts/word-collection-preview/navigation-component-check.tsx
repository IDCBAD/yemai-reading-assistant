// Local component fixture: memory only, with the production navigation and CSS.
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { WordCard } from '../../src/shared/wordCards';
import { WordCardDirectory, WordCardNavigation } from '../../src/sidepanel/components/WordCardNavigation';
import '../../src/sidepanel/styles.css';
import '../../src/sidepanel/wordCards.css';

const words = [
  ['converting', '转换；转变'], ['tables', '表格；列表'], ['snapshot', '快照；简况'],
  ['application', '应用；申请'], ['interaction', '交互；相互作用'], ['stochastic', '随机的'],
  ['deterministic', '确定性的'], ['unclassified', '未分类的'], ['unpredictable', '难以预测的'],
  ['flexibility', '灵活性；适应性'], ['predictable', '可预测的'],
] as const;

const fixtureStyles = `
  body { overflow:auto; }
  .component-check { display:flex; align-items:flex-start; justify-content:center; gap:28px; min-height:100%; padding:24px; }
  .component-check-controls { width:224px; flex-shrink:0; padding-top:8px; color:#4d596b; font-size:13px; line-height:1.7; }
  .component-check-controls h1 { margin:0 0 6px; color:#242b37; font-size:20px; font-weight:600; }
  .component-check-controls p { margin:0 0 22px; }
  .component-check-controls fieldset { margin:0 0 20px; padding:0; border:0; }
  .component-check-controls legend { margin-bottom:6px; }
  .component-check-options { display:flex; gap:6px; }
  .component-check-options button { min-height:34px; padding:5px 12px; border:1px solid #dfe4eb; border-radius:6px; background:white; color:#4d596b; cursor:pointer; font:inherit; }
  .component-check-options button[aria-pressed=true] { color:#315eea; border-color:#9aafeb; background:#eef2ff; }
  .component-check-controls output { display:block; margin-bottom:18px; font:12px/1.9 ui-monospace,monospace; overflow-wrap:anywhere; }
  .component-check-controls small { display:block; color:#768295; font-size:12px; }
  .component-check-frame { height:min(560px,calc(100dvh - 48px)); min-height:340px; flex-shrink:0; border:1px solid #dfe4eb; border-radius:12px; overflow:hidden; box-shadow:0 8px 28px #14233d0a; }
  .component-check-header { flex-shrink:0; padding:14px 20px; border-bottom:1px solid #e6eaf0; color:#697588; font-size:12px; }
  .component-check .wordbook-content { padding-top:24px; }
  .component-check-card-label { margin:0 0 20px; color:#8792a2; font-size:11px; }
  @media(max-width:700px) { .component-check { flex-wrap:wrap; gap:16px; padding:16px; } .component-check-controls { width:100%; max-width:440px; } .component-check-controls p { margin-bottom:12px; } }
`;

function App() {
  const [count, setCount] = useState(11);
  const [width, setWidth] = useState(320);
  const [index, setIndex] = useState(1);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [animate, setAnimate] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const directoryId = 'component-check-directory';
  const cards = useMemo<WordCard[]>(() => Array.from({ length: count }, (_, position) => {
    const [word, meaning] = words[position % words.length]!;
    return {
      id: `fixture-${position + 1}`, captureKey: `fixture-capture-${position + 1}`,
      word, normalizedWord: word, meaning, sentence: `This sample sentence contains ${word}.`,
      sentenceTranslation: `这条模拟原句包含 ${word}。`,
      source: { kind: 'page', title: `模拟来源 · 编号 ${position + 1}`, url: 'https://example.invalid/component-check' },
      createdAt: 0, updatedAt: 0,
    };
  }), [count]);
  const selected = cards[index]!;
  const closeDirectory = () => {
    setDirectoryOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };

  return <main className="component-check">
    <style>{fixtureStyles}</style>
    <aside className="component-check-controls">
      <h1>组件检查</h1>
      <p>模拟数据 · 正式导航与目录组件</p>
      <fieldset><legend>模拟卡片数</legend><div className="component-check-options">{[11, 300].map((value) => <button type="button" key={value} aria-pressed={count === value} onClick={() => { setCount(value); setIndex(1); setDirectoryOpen(false); }}>{value} 张</button>)}</div></fieldset>
      <fieldset><legend>面板宽度</legend><div className="component-check-options">{[320, 440].map((value) => <button type="button" key={value} aria-pressed={width === value} onClick={() => setWidth(value)}>{value} px</button>)}</div></fieldset>
      <output aria-live="polite">id: {selected.id}<br />count: {count}<br />position: {index + 1}<br />width: {width} px</output>
      <small>点击页码打开目录。搜索单词、释义或「编号 300」；选中后跳转。Esc 关闭并回到页码。</small>
    </aside>
    <div className="component-check-frame" style={{ width }}>
      <section className="wordbook-panel is-embedded" aria-label="单词导航组件检查">
        <header className="component-check-header">单词收藏 · 卡片占位</header>
        <div className="wordbook-content" inert={directoryOpen || undefined} aria-hidden={directoryOpen || undefined}>
          <div className="wordbook-album"><div className="wordbook-back one" aria-hidden="true" /><div className="wordbook-back two" aria-hidden="true" />
            <article className="word-card">
              <p className="component-check-card-label">模拟卡片 {index + 1}</p>
              <h3 className={selected.word.length > 11 ? 'is-long' : ''} lang="en">{selected.word}</h3>
              <div className="word-card-meaning"><p>{selected.meaning}</p></div>
              <div className="word-card-context"><span>原句</span></div>
              <blockquote className="word-card-sentence">{selected.sentence}</blockquote>
              <p className="word-card-sentence-translation">{selected.sentenceTranslation}</p>
              <div className="word-card-footer"><span className="word-card-source">{selected.source.title}</span></div>
            </article>
          </div>
        </div>
        <div className="wordbook-navigation" inert={directoryOpen || undefined}>
          <WordCardNavigation index={index} total={count} disabled={false} expanded={directoryOpen} directoryId={directoryId} triggerRef={trigger}
            onNavigate={(step) => setIndex((current) => (current + step + count) % count)}
            onOpen={(keyboard) => { setAnimate(!keyboard); setDirectoryOpen(true); }} />
        </div>
        {directoryOpen && <WordCardDirectory id={directoryId} cards={cards} selectedId={selected.id} animate={animate} onClose={closeDirectory}
          onSelect={(id) => { setIndex(cards.findIndex((card) => card.id === id)); closeDirectory(); }} />}
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
