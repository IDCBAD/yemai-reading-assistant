// Throwaway: compare three word-card navigation structures on the existing preview server.
// Run: node scripts/serve-word-collection-preview.mjs; open /scripts/word-collection-preview/navigation-prototype.html?variant=A
// ?variant=A|B|C; all cards and interactions live in memory, without writes or translation calls.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CollectionTabs } from '../../src/sidepanel/components/CollectionTabs';
import { KoboyoIcon } from '../../src/sidepanel/components/KoboyoIcon';
import { WordAudioIcon } from '../../src/sidepanel/components/WordAudioIcon';
import '../../src/sidepanel/styles.css';
import '../../src/sidepanel/wordCards.css';
import './navigation-prototype.css';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '页码展开目录', B: '单行横向词条', C: '卡片 / 列表' };
const briefs = {
  A: '平时只翻卡，找词时再展开目录。阅读区的高度不受收藏数量影响。',
  B: '所有词条留在一行，横向滚动。保留直接点词的方式，适合收藏较少时。',
  C: '卡片用来阅读，列表用来挑选。点击列表中的单词回到对应词卡。',
};
const sampleWords = [
  ['converting', '转换；转变'], ['tables', '表格；列表'], ['snapshot', '快照；简况'],
  ['application', '应用；申请'], ['interaction', '交互；相互作用'], ['stochastic', '随机的'],
  ['deterministic', '确定性的'], ['unclassified', '未分类的'], ['unpredictable', '难以预测的'],
  ['flexibility', '灵活性；适应性'], ['predictable', '可预测的'],
] as const;

function App() {
  const initial = new URLSearchParams(location.search).get('variant');
  const [variant, setVariant] = useState<Variant>(variants.includes(initial as Variant) ? initial as Variant : 'A');
  const [count, setCount] = useState(11);
  const [selectedId, setSelectedId] = useState(10);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState(false);
  const [directoryMotion, setDirectoryMotion] = useState(false);
  const [listView, setListView] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [cardMotion, setCardMotion] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => Array.from({ length: count }, (_, id) => {
    const [word, meaning] = sampleWords[(id + 11 - count % 11) % 11]!;
    return { id, word, meaning };
  }), [count]);
  const filtered = rows.filter((row) => `${row.word} ${row.meaning}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0]!;
  const position = Math.max(0, filtered.findIndex((row) => row.id === selected.id));
  const current = variant === 'A' || filtered.some((row) => row.id === selected.id) ? selected : filtered[0];

  const changeVariant = (next: Variant) => {
    setVariant(next); setDirectory(false); setListView(false); setQuery(''); setFeedback(''); setCardMotion(false);
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url);
  };
  const pick = (id: number, keyboard = false) => {
    setSelectedId(id); setCardMotion(!keyboard); setDirectory(false); setListView(false); setFeedback('');
    if (variant === 'A') { setQuery(''); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }
  };
  const navigate = (step: number, keyboard: boolean) => {
    if (filtered.length < 2) return;
    const id = filtered[(position + step + filtered.length) % filtered.length]!.id;
    setSelectedId(id); setCardMotion(!keyboard); setFeedback('');
  };
  useEffect(() => {
    if (!directory) return;
    directoryInput.current?.focus({ preventScroll: true });
    directoryInput.current?.parentElement?.nextElementSibling?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
  }, [directory]);
  useEffect(() => {
    if (variant === 'B') strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
  }, [variant, selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Escape' && directory) { event.preventDefault(); setDirectory(false); setQuery(''); trigger.current?.focus(); }
      if (target.closest('.nav-prototype-panel')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); changeVariant(variants[(variants.indexOf(variant) + (event.key === 'ArrowLeft' ? 2 : 1)) % 3]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, directory]);

  const search = (isDirectory = false) => <label className="nav-search">
    <KoboyoIcon name="search" size={15} /><input ref={isDirectory ? directoryInput : undefined} type="search" aria-label={isDirectory ? '搜索单词目录' : '搜索单词'} placeholder="搜索单词或释义" value={query} onChange={(event) => { setQuery(event.target.value); setCardMotion(false); }} />
  </label>;
  const wordRows = (closeOnPick: boolean) => <div className="nav-directory-rows" role="list" aria-label="单词目录">
    {filtered.length ? filtered.map((row) => <button type="button" key={row.id} role="listitem" aria-current={row.id === selected.id ? 'true' : undefined}
      onClick={(event) => closeOnPick ? pick(row.id, event.detail === 0) : setSelectedId(row.id)}>
      <span className="nav-row-number">{String(row.id + 1).padStart(2, '0')}</span>
      <span className="nav-row-copy"><strong lang="en">{row.word}</strong><span>{row.meaning}</span></span>
      {row.id === selected.id && <span className="nav-row-check" aria-label="正在阅读">✓</span>}
    </button>) : <p className="nav-no-result">没有找到单词</p>}
  </div>;
  const card = current ? <div className="wordbook-album"><div className="wordbook-back one" /><div className="wordbook-back two" />
    <article className={`word-card${cardMotion ? ' is-arriving' : ''}`} key={current.id}>
      <h3 className={current.word.length > 11 ? 'is-long' : ''}>{current.word}</h3>
      <div className="word-card-pronunciation"><span className="word-card-phonetic"><abbr title="美式英语">US</abbr>{current.word === 'predictable' ? '/pɹɪˈdɪktəbəɫ/' : '—'}</span><button className="word-card-audio" aria-label="发音演示" title="此原型不播放语音" onClick={() => setFeedback('此原型只演示导航')}><WordAudioIcon /></button></div>
      <div className="word-card-meaning"><p>{current.meaning}</p></div>
      <div className="word-card-context"><span>原句</span><button aria-label="原句发音演示" onClick={() => setFeedback('此原型只演示导航')}><WordAudioIcon /></button></div>
      <blockquote className="word-card-sentence">{current.word === 'predictable' ? <>Use an API when available, or a script when the workflow is <mark>predictable</mark>.</> : <>This sample card shows the saved word <mark>{current.word}</mark> in a sentence.</>}</blockquote>
      <p className="word-card-sentence-translation">{current.word === 'predictable' ? '有 API 时使用 API，流程可预测时使用脚本。' : `这张示例卡片展示了收藏词 ${current.word}。`}</p>
      <div className="word-card-footer"><span className="word-card-source"><KoboyoIcon name="link" size={12} />{current.word === 'predictable' ? 'browser-use.com ↗' : '模拟例句'}</span></div>
    </article>
  </div> : <p className="nav-no-result">没有找到单词</p>;
  const previousNext = <>
    <button className="nav-page-arrow" disabled={filtered.length < 2} aria-label="上一个单词" onClick={(event) => navigate(-1, event.detail === 0)}>‹</button>
    {variant === 'A' ? <button className="nav-page-index" ref={trigger} aria-label={`打开单词目录，当前第 ${selected.id + 1} 张，共 ${count} 张`} aria-expanded={directory} aria-controls="nav-directory" title="单词目录"
      onClick={(event) => { setQuery(''); setDirectoryMotion(event.detail !== 0); setDirectory(true); }}><span>{String(selected.id + 1).padStart(2, '0')} <i>/ {count}</i></span><span className="nav-index-glyph" aria-hidden="true">⌄</span></button>
      : <span className="nav-page-label">{current ? String(position + 1).padStart(2, '0') : '00'} <i>/ {filtered.length}</i></span>}
    <button className="nav-page-arrow" disabled={filtered.length < 2} aria-label="下一个单词" onClick={(event) => navigate(1, event.detail === 0)}>›</button>
  </>;

  return <main className="nav-prototype">
    <section className="nav-prototype-brief">
      <span className="nav-prototype-eyebrow">页脉 · 导航原型</span>
      <h1>词卡导航</h1>
      <p className="nav-prototype-intro">保留单词卡片，只调整找词和翻卡的方式。</p>
      <div className="nav-variant-options">{variants.map((key) => <button type="button" key={key} aria-pressed={key === variant} onClick={() => changeVariant(key)}><span>{key}</span><div><strong>{names[key]}{key === 'A' && <small>推荐</small>}</strong><p>{briefs[key]}</p></div></button>)}</div>
      <div className="nav-density"><span>模拟收藏数量</span><div>{[11, 80, 300].map((size) => <button key={size} aria-pressed={size === count} onClick={() => { setCount(size); setSelectedId(size - 1); setQuery(''); }}>{size}</button>)}</div></div>
      <p className="nav-prototype-boundary">仅导航原型 · 模拟数据，不读写你的收藏。多张同词卡用于模拟来自不同原句的收藏。</p>
      <output className="nav-prototype-state">{variant} · {count} 张 · 第 {selected.id + 1} 张 · {directory ? '目录已展开' : listView ? '列表' : '卡片'}</output>
    </section>
    <section className={`nav-prototype-panel wordbook-panel nav-variant-${variant}`} aria-label="单词收藏导航演示" onKeyDown={(event) => {
      if ((event.target as HTMLElement).closest('input')) return;
      if (directory || listView) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1, true); }
    }}>
      <div className="nav-app-header"><strong>页脉</strong></div>
      <CollectionTabs active="words" count={count} onClose={() => setFeedback('关闭仅作演示')}>
        <button className="collection-audio-toggle" aria-label="自动发音演示" onClick={() => setFeedback('此原型只演示导航')}><WordAudioIcon muted /></button>
      </CollectionTabs>
      {variant === 'C' && <div className="nav-view-toggle"><button aria-pressed={!listView} onClick={() => setListView(false)}>卡片</button><button aria-pressed={listView} onClick={() => { setListView(true); setQuery(''); }}>列表</button></div>}
      {variant !== 'A' && <div className="nav-global-search">{search()}</div>}
      {variant === 'C' && listView ? <div className="nav-list-view">{wordRows(true)}</div> : <>
        <div className="nav-card-scroll">{card}</div>
        <footer className="nav-reading-footer"><nav aria-label="翻看单词">{previousNext}</nav>
          {variant === 'B' && <div className="nav-word-strip" ref={strip} aria-label="横向单词目录">{filtered.map((row) => <button key={row.id} aria-pressed={current?.id === row.id} onClick={(event) => pick(row.id, event.detail === 0)}>{row.word}</button>)}</div>}
        </footer>
      </>}
      {directory && <div className={`nav-directory-layer${directoryMotion ? '' : ' without-motion'}`} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDirectory(false); setQuery(''); trigger.current?.focus(); }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input')].filter((control) => control.tabIndex >= 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <button className="nav-directory-scrim" tabIndex={-1} aria-label="收起单词目录" onClick={() => { setDirectory(false); setQuery(''); trigger.current?.focus(); }} />
        <section className="nav-directory-sheet" id="nav-directory" role="dialog" aria-modal="true" aria-label="单词目录">
          <header><strong>单词目录 <span>{count}</span></strong><button aria-label="关闭单词目录" onClick={() => { setDirectory(false); setQuery(''); trigger.current?.focus(); }}><KoboyoIcon name="cross" size={15} /></button></header>
          {search(true)}{wordRows(true)}
        </section>
      </div>}
      <span className="nav-demo-feedback" role="status">{feedback}</span>
    </section>
    {import.meta.env.DEV && <nav className="nav-prototype-switcher" aria-label="切换原型方案"><button aria-label="上一个方案" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 2) % 3]!)}>←</button><span>{variant} · {names[variant]}</span><button aria-label="下一个方案" onClick={() => changeVariant(variants[(variants.indexOf(variant) + 1) % 3]!)}>→</button></nav>}
  </main>;
}

const root = (import.meta.hot?.data.root as ReturnType<typeof createRoot> | undefined) ?? createRoot(document.getElementById('root')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose((data) => { data.root = root; });
