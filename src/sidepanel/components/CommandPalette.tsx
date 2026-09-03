import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createWorkspaceSearchIndex,
  type WorkspaceSearchResult,
  type WorkspaceSearchScope,
} from '../../search/workspaceSearch';
import { formatMessageTimestamp } from '../messageTimestamp';
import { commandPaletteHighlightParts, nextCommandPaletteIndex } from '../commandPalette';
import type { WorkspaceSearchSession } from '../searchSession';
import { KoboyoIcon } from './KoboyoIcon';

interface CommandPaletteProps {
  session: WorkspaceSearchSession;
  maxTabs: number;
  onClose: () => void;
  onSelect: (result: WorkspaceSearchResult, query: string) => void;
  suspended?: boolean;
}

function ResultText({ value, query, matchedTerms }: { value: string; query: string; matchedTerms: string[] }) {
  return commandPaletteHighlightParts(value, query, matchedTerms).map((part, index) => part.match
    ? <mark key={`${part.value}-${index}`}>{part.value}</mark>
    : <span key={`${part.value}-${index}`}>{part.value}</span>);
}

export function CommandPalette({
  session,
  maxTabs,
  onClose,
  onSelect,
  suspended = false,
}: CommandPaletteProps) {
  const { workspace, readingCards } = session;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<WorkspaceSearchScope>(session.initialScope);
  const deferredQuery = useDeferredValue(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLElement>(null);
  const searchIndex = useMemo(() => createWorkspaceSearchIndex(workspace, readingCards), [session]);
  const results = useMemo(
    () => deferredQuery.trim()
      ? searchIndex.search(deferredQuery, 24, scope)
      : searchIndex.recent(10, scope),
    [deferredQuery, scope, searchIndex],
  );
  const disabledIndexes = useMemo(() => new Set(results.flatMap((result, index) => {
    if (result.kind === 'reading-card') return [];
    const alreadyOpen = workspace.openTabs.some((tab) => tab.conversationId === result.conversationId);
    return !alreadyOpen && workspace.openTabs.length >= maxTabs ? [index] : [];
  })), [maxTabs, results, workspace.openTabs]);

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setScope(session.initialScope);
    setActiveIndex(0);
    inputRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    if (suspended) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [suspended]);

  useEffect(() => {
    const firstEnabled = results.findIndex((_, index) => !disabledIndexes.has(index));
    setActiveIndex(firstEnabled);
  }, [deferredQuery, disabledIndexes, results]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const chooseResult = (index: number) => {
    const result = results[index];
    if (!result || disabledIndexes.has(index)) return;
    onSelect(result, deferredQuery.trim());
  };

  return (
    <div
      className={`command-palette-layer${suspended ? ' is-suspended' : ''}`}
      aria-hidden={suspended}
      inert={suspended || undefined}
    >
      <button
        className="command-palette-scrim"
        type="button"
        tabIndex={-1}
        aria-label="关闭全局搜索"
        onClick={onClose}
      />
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        ref={paletteRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled)',
          ) ?? []);
          if (focusable.length === 0) return;
          const first = focusable[0]!;
          const last = focusable.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 className="visually-hidden" id="command-palette-title">
          {scope === 'reading-cards' ? '搜索收藏' : '搜索阅读历史'}
        </h2>
        <div className="command-search-field">
          <KoboyoIcon name="search" size={17} />
          <button
            className={`command-search-scope${scope === 'reading-cards' ? ' is-reading-cards' : ''}`}
            type="button"
            onClick={() => setScope((current) => current === 'all' ? 'reading-cards' : 'all')}
            aria-label={scope === 'reading-cards' ? '当前搜索收藏，切换到全部内容' : '当前搜索全部内容，切换到收藏'}
            title={scope === 'reading-cards' ? '切换到全部内容' : '切换到收藏'}
          >
            <KoboyoIcon name={scope === 'reading-cards' ? 'bookmark' : 'quote'} size={12} />
            <span>{scope === 'reading-cards' ? '收藏' : '全部'}</span>
          </button>
          <input
            ref={inputRef}
            value={query}
            type="search"
            name="workspace-search"
            autoComplete="off"
            spellCheck={false}
            placeholder={scope === 'reading-cards' ? '搜索收藏标题、正文或来源…' : '搜索会话、回答、网页或文件…'}
            aria-label={scope === 'reading-cards' ? '搜索收藏' : '搜索阅读历史'}
            aria-controls="command-palette-results"
            aria-activedescendant={activeIndex >= 0 ? `command-result-${activeIndex}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => nextCommandPaletteIndex(
                  current,
                  event.key === 'ArrowDown' ? 1 : -1,
                  results.length,
                  disabledIndexes,
                ));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                chooseResult(activeIndex);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results-heading" role="status" aria-live="polite">
          <span>{deferredQuery.trim()
            ? scope === 'reading-cards' ? '收藏匹配' : '匹配结果'
            : scope === 'reading-cards' ? '最近收藏' : '最近会话'}</span>
          <small>{results.length}</small>
        </div>
        <div
          className="command-results"
          id="command-palette-results"
          role="listbox"
          aria-label={deferredQuery.trim()
            ? scope === 'reading-cards' ? '收藏搜索结果' : '搜索结果'
            : scope === 'reading-cards' ? '最近收藏' : '最近会话'}
          ref={listRef}
        >
          {results.length === 0 ? (
            <div className="command-empty">
              <strong>{scope === 'reading-cards' ? '没有找到相关收藏' : '没有找到相关内容'}</strong>
              <span>{scope === 'reading-cards'
                ? '可以试试卡片标题、正文内容或来源名称。'
                : '可以试试会话标题、网页名称或回答中的关键词。'}</span>
              {scope === 'reading-cards' && deferredQuery.trim() && (
                <button type="button" onClick={() => setScope('all')}>在全部内容中搜索</button>
              )}
            </div>
          ) : results.map((result, index) => {
            const disabled = disabledIndexes.has(index);
            const timestamp = formatMessageTimestamp(result.updatedAt);
            return (
              <button
                className={`command-result${index === activeIndex ? ' is-active' : ''}`}
                id={`command-result-${index}`}
                data-result-index={index}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={disabled}
                disabled={disabled}
                onPointerMove={() => {
                  if (!disabled) setActiveIndex(index);
                }}
                onClick={() => chooseResult(index)}
                key={result.id}
              >
                <span className={`command-result-icon command-result-icon--${result.role ?? result.kind}`}>
                  <KoboyoIcon
                    name={result.kind === 'reading-card'
                      ? 'bookmark'
                      : result.kind === 'conversation'
                        ? 'quote'
                        : result.role === 'assistant' ? 'bot' : 'selection'}
                    size={14}
                  />
                </span>
                <span className="command-result-copy">
                  <span className="command-result-title">
                    <strong>
                      <ResultText value={result.title} query={deferredQuery} matchedTerms={result.matchedTerms} />
                    </strong>
                    {result.archived && <em>已归档</em>}
                  </span>
                  {result.snippet && (
                    <span className="command-result-snippet">
                      <ResultText
                        value={result.snippet}
                        query={deferredQuery}
                        matchedTerms={result.matchedTerms}
                      />
                    </span>
                  )}
                  <span className="command-result-meta">
                    <small>
                      {disabled
                        ? `已打开 ${maxTabs} 个工作页，请先关闭一个`
                        : result.archived
                          ? `${result.matchLabel ?? result.subtitle} · 打开时恢复`
                          : result.matchLabel ?? result.subtitle}
                    </small>
                    <time dateTime={timestamp.dateTime} title={timestamp.fullLabel}>{timestamp.label}</time>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <footer className="command-palette-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 打开</span>
          <span><kbd>⌘/Ctrl K</kbd> 搜索</span>
        </footer>
      </section>
    </div>
  );
}
