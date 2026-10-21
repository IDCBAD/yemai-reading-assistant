import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { WordCard } from '../../shared/wordCards';
import { KoboyoIcon } from './KoboyoIcon';

function PageArrow({ direction }: { direction: 'left' | 'right' }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d={direction === 'left' ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

interface WordCardNavigationProps {
  index: number;
  total: number;
  disabled: boolean;
  expanded: boolean;
  directoryId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onNavigate: (step: number, keyboard: boolean) => void;
  onOpen: (keyboard: boolean) => void;
}

export function WordCardNavigation({ index, total, disabled, expanded, directoryId, triggerRef, onNavigate, onOpen }: WordCardNavigationProps) {
  return <nav className="wordbook-pagination" aria-label="翻看单词">
    <button className="wordbook-page-arrow" type="button" disabled={disabled || total < 2} aria-label="上一个单词" onClick={(event) => onNavigate(-1, event.detail === 0)}><PageArrow direction="left" /></button>
    <button className="wordbook-directory-trigger" type="button" ref={triggerRef} disabled={disabled || !total}
      title="单词目录" aria-label={`打开单词目录，当前第 ${index + 1} 张，共 ${total} 张`}
      aria-expanded={expanded} aria-controls={directoryId} aria-haspopup="dialog" onClick={(event) => onOpen(event.detail === 0)}>
      <span className="wordbook-page-number"><strong>{String(index + 1).padStart(2, '0')}</strong><span>/</span><span>{String(total).padStart(2, '0')}</span></span>
      <svg className="wordbook-directory-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    <button className="wordbook-page-arrow" type="button" disabled={disabled || total < 2} aria-label="下一个单词" onClick={(event) => onNavigate(1, event.detail === 0)}><PageArrow direction="right" /></button>
  </nav>;
}

interface WordCardDirectoryProps {
  id: string;
  cards: WordCard[];
  selectedId?: string;
  animate: boolean;
  onClose: () => void;
  onSelect: (id: string, keyboard: boolean) => void;
}

export function WordCardDirectory({ id, cards, selectedId, animate, onClose, onSelect }: WordCardDirectoryProps) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const headingId = useId();
  const focusedCardId = useRef<string | undefined>(undefined);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return cards.filter((card) => [card.word, card.meaning ?? '', card.sentence, card.sentenceTranslation ?? '', card.source.title].some((text) => text.toLowerCase().includes(value)));
  }, [cards, query]);

  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    const container = list.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (container && selected) {
      // Scroll only the directory, leaving the card and surrounding page in place.
      container.scrollTop += selected.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - selected.offsetHeight) / 2;
    }
  }, []);

  useLayoutEffect(() => {
    if (focusedCardId.current && !filtered.some((card) => card.id === focusedCardId.current)
      && document.activeElement === document.body) {
      focusedCardId.current = undefined;
      input.current?.focus({ preventScroll: true });
    }
  }, [filtered]);

  return <div className={`word-directory-layer${animate ? '' : ' without-motion'}`} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter((control) => control.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  }}>
    <button className="word-directory-scrim" type="button" tabIndex={-1} aria-label="收起单词目录" onClick={onClose} />
    <section className="word-directory-sheet" role="dialog" aria-modal="true" aria-labelledby={headingId} id={id}>
      <header><h3 id={headingId}>单词目录 <span>{cards.length}</span></h3><button type="button" aria-label="关闭单词目录" onClick={onClose}><KoboyoIcon name="cross" size={15} /></button></header>
      <label className="wordbook-search word-directory-search"><KoboyoIcon name="search" size={15} /><span className="visually-hidden">搜索单词、释义或原句</span><input ref={input} type="search" value={query} placeholder="搜索单词、释义或原句" autoComplete="off" onChange={(event) => setQuery(event.target.value)} /></label>
      {filtered.length ? <ul className="word-directory-list" aria-label="收藏单词" ref={list}>
        {filtered.map((card) => <li key={card.id}><button type="button" aria-current={card.id === selectedId ? 'true' : undefined} onFocus={() => { focusedCardId.current = card.id; }} onClick={(event) => onSelect(card.id, event.detail === 0)}>
          <span className="word-directory-copy"><strong lang="en">{card.word}</strong><span>{card.meaning || card.sentence || card.source.title}</span></span>
          {card.id === selectedId && <svg className="word-directory-current" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-label="正在阅读"><path d="m3 8 3.2 3.2L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button></li>)}
      </ul> : <p className="word-directory-empty" role="status">没有找到单词</p>}
    </section>
  </div>;
}
