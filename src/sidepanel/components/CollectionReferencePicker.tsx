import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collectionMaterials } from '../../data/collectionActions';
import { commandPaletteHighlightParts } from '../commandPalette';
import { formatMessageTimestamp } from '../messageTimestamp';
import type { WorkspaceSearchSession } from '../searchSession';
import type { CollectionMaterial } from '../types';
import { workspaceSearchIndexCache } from '../workspaceSearchIndexCache';
import { CollectionReferenceDialog } from './CollectionReferenceDialog';
import { CollectionMaterialDetails } from './CollectionMaterialDetails';
import { KoboyoIcon } from './KoboyoIcon';

export function CollectionReferencePicker({ session, existingMaterials, onAdd, onClose }: {
  session: WorkspaceSearchSession;
  existingMaterials: CollectionMaterial[];
  onAdd: (cardIds: string[]) => string | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [issue, setIssue] = useState<string>();
  const [index, setIndex] = useState(() => workspaceSearchIndexCache.peek(session));
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const existingIds = useMemo(() => new Set(existingMaterials.map((material) => material.cardId)), [existingMaterials]);
  const results = useMemo(() => index
    ? deferredQuery.trim() ? index.search(deferredQuery, 24, 'reading-cards') : index.recent(24, 'reading-cards')
    : [], [deferredQuery, index]);
  const cardsById = useMemo(() => new Map(session.readingCards.map((card) => [card.id, card])), [session.readingCards]);
  const detailCard = detailId ? cardsById.get(detailId) : undefined;
  const detailMaterial = detailCard
    ? existingMaterials.find((material) => material.cardId === detailCard.id)
      ?? collectionMaterials([detailCard], session.workspace.conversations)[0]
    : undefined;

  useEffect(() => {
    if (index) return;
    const timer = window.setTimeout(() => setIndex(workspaceSearchIndexCache.getOrCreate(session)), 0);
    return () => window.clearTimeout(timer);
  }, [index, session]);
  useLayoutEffect(() => {
    if (detailId) return;
    if (previewTriggerRef.current?.isConnected) previewTriggerRef.current.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [detailId]);
  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => !existingIds.has(id)));
  }, [existingIds]);

  const add = (ids: string[]) => {
    const error = onAdd(ids);
    if (error) { setIssue(error); setDetailId(null); }
  };
  const toggle = (id: string) => {
    setIssue(undefined);
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  };
  const close = () => {
    if (detailId) { setDetailId(null); setIssue(undefined); }
    else onClose();
  };
  return <CollectionReferenceDialog label={detailMaterial ? '收藏问答详情' : '搜索收藏并加入当前问题'} onClose={close}>
    {detailMaterial ? <CollectionMaterialDetails material={detailMaterial} alreadyAdded={existingIds.has(detailMaterial.cardId)}
      onBack={() => setDetailId(null)} onClose={onClose} onAdd={() => add([detailMaterial.cardId])} /> : <>
      <div className="command-search-field collection-reference-search">
        <KoboyoIcon name="search" size={17} />
        <input ref={inputRef} type="search" value={query} data-collection-initial-focus
          aria-label="搜索收藏" placeholder="搜索收藏…" autoComplete="off"
          onChange={(event) => { setQuery(event.target.value); setIssue(undefined); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              resultsRef.current?.querySelector<HTMLElement>('input:not(:disabled),button')?.focus();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = results[0]?.readingCardId;
              if (first) setDetailId(first);
            }
          }} />
        <button className="preview-icon-button" type="button" onClick={onClose} aria-label="关闭收藏搜索">
          <KoboyoIcon name="cross" size={13} />
        </button>
      </div>
      <div className="command-results-heading" role="status" aria-live="polite">
        <span>{!index ? '正在准备搜索' : deferredQuery.trim() ? '匹配收藏' : '最近收藏'}</span><small>{results.length}</small>
      </div>
      <div className="command-results collection-reference-results" ref={resultsRef}>
        {!index ? <div className="command-empty">正在准备收藏搜索…</div> : !results.length
          ? <div className="command-empty"><strong>{session.readingCards.length ? '没有找到相关收藏' : '还没有收藏'}</strong>
            <span>{session.readingCards.length ? '试试标题、正文或来源里的关键词。' : '先收藏完整回答或回答片段，再带入提问。'}</span></div>
          : results.map((result) => {
            const cardId = result.readingCardId;
            if (!cardId || !cardsById.has(cardId)) return null;
            const added = existingIds.has(cardId);
            const timestamp = formatMessageTimestamp(result.updatedAt);
            return <div className="collection-reference-result" key={cardId}>
              <input type="checkbox" checked={added || selectedIds.includes(cardId)} disabled={added}
                aria-label={`选择收藏：${result.title}`} onChange={() => toggle(cardId)} />
              <div className="command-result-copy">
                <div className="collection-reference-result-title"><strong>
                  {commandPaletteHighlightParts(result.title, deferredQuery, result.matchedTerms).map((part, i) => part.match
                    ? <mark key={i}>{part.value}</mark> : <span key={i}>{part.value}</span>)}
                </strong><button type="button" className="collection-reference-view" aria-label={`查看收藏：${result.title}`}
                  onClick={(event) => { previewTriggerRef.current = event.currentTarget; setDetailId(cardId); }}>查看</button></div>
                {result.snippet && <span className="command-result-snippet">{result.snippet.length > 220 ? `${result.snippet.slice(0, 220)}…` : result.snippet}</span>}
                <div className="command-result-meta"><small>{added ? '已加入当前问题' : result.matchLabel ?? result.subtitle}</small>
                  <time dateTime={timestamp.dateTime} title={timestamp.fullLabel}>{timestamp.label}</time></div>
              </div>
            </div>;
          })}
      </div>
      {issue && <p className="collection-reference-issue" role="alert">{issue}</p>}
      <footer className="collection-reference-footer">
        <button className="collection-reference-add" type="button" disabled={!selectedIds.length}
          onClick={() => add(selectedIds)}>{selectedIds.length ? `加入当前问题 · ${selectedIds.length} 条` : '加入当前问题'}</button>
      </footer>
    </>}
  </CollectionReferenceDialog>;
}
