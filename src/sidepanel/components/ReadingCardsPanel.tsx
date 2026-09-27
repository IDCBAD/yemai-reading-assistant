import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReadingCardRow } from '../../data/database';
import type { QaSaveResult } from '../../services/obsidianQa';
import { MAX_COLLECTION_MATERIAL_CHARACTERS, collectionContextText, collectionMaterials } from '../../data/collectionActions';
import {
  actionPresentation,
  type ActionFeedbackState,
  type ReadingCardRemovalUndo,
  type SemanticAction,
} from '../actionSemantics';
import { readingCardKind, readingCardQuestion, readingCardSourceAvailable } from '../readingCards';
import type { Conversation } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
import { finishUiPerformanceMeasure } from '../performanceTelemetry';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';
import { ReadingCardRiver, type ReadingCardOpenModality } from './ReadingCardRiver';

interface ReadingCardsPanelProps {
  open: boolean;
  cards: ReadingCardRow[];
  conversations: Conversation[];
  selectedCardId?: string;
  paused?: boolean;
  issue?: string;
  removalUndo: ReadingCardRemovalUndo | null;
  onClose: () => void;
  onReaderClose?: () => void;
  onRemove: (card: ReadingCardRow) => void;
  onUndoRemove: () => void;
  onOpenSource: (card: ReadingCardRow) => void;
  onExportCard: (card: ReadingCardRow) => Promise<void>;
  onExportAll: (cards: ReadingCardRow[]) => Promise<void>;
  onStartConversation: (cards: ReadingCardRow[]) => string | undefined;
  onSaveSelected: (cards: ReadingCardRow[]) => Promise<QaSaveResult[]>;
  collectionSend?: { conversationId: string; cardIds: string[]; status: 'draft' | 'pending' | 'received' | 'uncertain' } | null;
}

const SELECTED_CARDS_KEY = 'yemai-selected-reading-card-ids-v1';

function restoreSelectedCards(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SELECTED_CARDS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function safeArtifactUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readingCardKindLabel(card: ReadingCardRow) {
  return readingCardKind(card) === 'excerpt' ? '回答片段' : '完整回答';
}

export function ReadingCardsPanel({
  open,
  cards,
  conversations,
  selectedCardId,
  paused = false,
  issue,
  removalUndo,
  onClose,
  onReaderClose,
  onRemove,
  onUndoRemove,
  onOpenSource,
  onExportCard,
  onExportAll,
  onStartConversation,
  onSaveSelected,
  collectionSend,
}: ReadingCardsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'river' | 'list'>('river');
  const [selectedIds, setSelectedIds] = useState<string[]>(restoreSelectedCards);
  const [saveReport, setSaveReport] = useState<QaSaveResult[] | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchIssue, setBatchIssue] = useState<string | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(open);
  const [readerModality, setReaderModality] = useState<ReadingCardOpenModality>('programmatic');
  const [exportFeedback, setExportFeedback] = useState<{
    key: string;
    state: Exclude<ActionFeedbackState, 'idle'>;
  } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const preserveSelectionOnCloseRef = useRef(false);
  const openRef = useRef(open);
  const returnFocusIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selected = useMemo(() => cards.find((card) => card.id === selectedId), [cards, selectedId]);
  const batchCards = useMemo(() => cards.filter((card) => selectedIds.includes(card.id)), [cards, selectedIds]);
  const sendCharacters = useMemo(() => collectionContextText(collectionMaterials(batchCards, conversations)).length, [batchCards, conversations]);
  selectedIdRef.current = selectedId;
  openRef.current = open;

  useLayoutEffect(() => {
    if (open) finishUiPerformanceMeasure('reading-cards-shell');
  }, [open]);

  const exportPresentation = (key: string, action: SemanticAction) => actionPresentation(
    action,
    exportFeedback?.key === key ? exportFeedback.state : 'idle',
  );

  const runExport = (key: string, action: SemanticAction, callback: () => Promise<void>) => {
    if (exportFeedback?.key === key && exportFeedback.state === 'working') return;
    setExportFeedback({ key, state: 'working' });
    void callback()
      .then(() => {
        setExportFeedback({ key, state: 'success' });
        window.setTimeout(() => setExportFeedback((current) => current?.key === key ? null : current), 800);
      })
      .catch(() => {
        setExportFeedback({ key, state: 'error' });
        window.setTimeout(() => setExportFeedback((current) => current?.key === key ? null : current), 1_200);
      });
  };

  useEffect(() => {
    let frame: number | undefined;
    let timer: number | undefined;
    if (open) {
      setRendered(true);
      frame = window.requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      timer = window.setTimeout(() => setRendered(false), 180);
    }
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const nextSelectedId = selectedCardId ?? null;
    setView('river');
    setReaderModality('programmatic');
    setSelectedId(nextSelectedId);
    returnFocusIdRef.current = nextSelectedId;
  }, [open, selectedCardId]);

  useEffect(() => {
    if (open) return;
    if (preserveSelectionOnCloseRef.current) {
      preserveSelectionOnCloseRef.current = false;
      return;
    }
    setSelectedIds([]);
    setSaveReport(null);
    setBatchIssue(null);
  }, [open]);

  useEffect(() => {
    if (selectedId && !cards.some((card) => card.id === selectedId)) {
      setSelectedId(null);
      onReaderClose?.();
    }
  }, [cards, onReaderClose, selectedId]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => cards.some((card) => card.id === id)));
  }, [cards]);

  useEffect(() => {
    if (collectionSend?.status !== 'received') return;
    const sent = new Set(collectionSend.cardIds);
    setSelectedIds((current) => current.filter((id) => !sent.has(id)));
  }, [collectionSend?.conversationId, collectionSend?.status]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_CARDS_KEY, JSON.stringify(selectedIds));
    } catch { /* Selection remains available for this sidepanel session. */ }
  }, [selectedIds]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (paused) return;
      event.preventDefault();
      if (selectedIdRef.current) {
        setSelectedId(null);
        onReaderClose?.();
      }
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, onReaderClose, open, paused]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (selected) {
        panelRef.current?.querySelector<HTMLElement>('.reading-card-reader-back')?.focus();
        return;
      }
      const returnTarget = returnFocusIdRef.current
        ? [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-reading-card-id]') ?? [])]
            .find((node) => node.dataset.readingCardId === returnFocusIdRef.current)
            ?.querySelector<HTMLElement>('button')
        : null;
      if (returnTarget) {
        returnTarget.dataset.riverFocusReturn = 'true';
        returnTarget.focus({ preventScroll: true });
        delete returnTarget.dataset.riverFocusReturn;
        return;
      }
      panelRef.current
        ?.querySelector<HTMLElement>('.reading-card-river__open, .reading-card-list-open, .reading-cards-close')
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selected]);

  const openCard = (cardId: string, modality: ReadingCardOpenModality) => {
    returnFocusIdRef.current = cardId;
    setReaderModality(modality);
    setSelectedId(cardId);
  };

  const closeReader = () => {
    setSelectedId(null);
    onReaderClose?.();
  };

  const switchView = (nextView: 'river' | 'list') => {
    if (selectedId) closeReader();
    setView(nextView);
  };

  const toggleSelection = (cardId: string) => {
    setSelectedIds((current) => current.includes(cardId)
      ? current.filter((id) => id !== cardId)
      : [...current, cardId]);
    setSaveReport(null);
    setBatchIssue(null);
  };

  const sendBatch = () => {
    if (!batchCards.length || batchBusy) return;
    if (sendCharacters > MAX_COLLECTION_MATERIAL_CHARACTERS) {
      setBatchIssue(`所选问答过长，请缩小选择，为接下来的问题留出空间。`);
      return;
    }
    const issue = onStartConversation(batchCards);
    if (!issue) preserveSelectionOnCloseRef.current = true;
    setBatchIssue(issue ?? null);
  };

  const saveBatch = async () => {
    if (!batchCards.length || batchBusy) return;
    setBatchBusy(true);
    setBatchIssue(null);
    setSaveReport(null);
    try {
      const results = await onSaveSelected(batchCards);
      setSaveReport(results);
      const failed = new Set(results.filter((result) => result.status === 'failed').map((result) => result.cardId));
      setSelectedIds((current) => openRef.current ? current.filter((id) => failed.has(id)) : []);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setBatchIssue(error instanceof Error ? error.message : '保存失败，请重试。');
      }
    } finally {
      setBatchBusy(false);
    }
  };

  if (!rendered) return null;
  const exportAllPresentation = exportPresentation('all', 'export-all-cards');
  const selectedExportPresentation = selected
    ? exportPresentation(selected.id, 'export-card-markdown')
    : null;

  return (
    <div
      className={`reading-cards-layer${visible ? ' is-open' : ''}`}
      aria-hidden={!open || paused}
      inert={paused || undefined}
    >
      <button
        className="reading-cards-scrim"
        type="button"
        tabIndex={-1}
        onClick={() => open && onClose()}
        aria-label="关闭收藏"
      />
      <aside
        className="reading-cards-panel"
        role="dialog"
        aria-modal="true"
        aria-label="收藏卡片"
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href]',
          ) ?? []).filter((element) => element.tabIndex >= 0 && !element.closest('[inert]'));
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
        <header className="reading-cards-header">
          <div className="reading-cards-header-title">
            <h2>收藏 <span className="reading-cards-count">{cards.length}</span></h2>
          </div>
          <div className="reading-cards-view-switch" role="group" aria-label="收藏视图">
            <button type="button" className={view === 'river' ? 'is-active' : ''} aria-pressed={view === 'river'} onClick={() => switchView('river')}>瀑布流</button>
            <button type="button" className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => switchView('list')}>列表{selectedIds.length > 0 ? ` · ${selectedIds.length}` : ''}</button>
          </div>
          <div className="reading-cards-header-actions">
            {cards.length > 0 && (
              <button
                className="reading-cards-export-all pressable"
                type="button"
                aria-label={exportAllPresentation.label}
                disabled={exportAllPresentation.spinning}
                onClick={() => runExport('all', 'export-all-cards', () => onExportAll(cards))}
                aria-live="polite"
              >
                <KoboyoIcon
                  name={exportAllPresentation.icon}
                  size={14}
                  className={exportAllPresentation.spinning ? 'is-spinning' : ''}
                />
                <span>{exportAllPresentation.label}</span>
              </button>
            )}
            <button
              className="reading-cards-close pressable"
              type="button"
              onClick={onClose}
              aria-label="关闭收藏"
            >
              <KoboyoIcon name="cross" size={13} />
            </button>
          </div>
        </header>

        <div className="reading-cards-notice">
          {issue && <p className="reading-cards-issue" role="status">{issue}</p>}
        </div>
        <div className={`reading-cards-stage${selected ? ' has-reader' : ''}${readerModality === 'keyboard' ? ' is-keyboard-open' : ''}`}>
          {cards.length === 0 ? (
            <div className="reading-cards-empty">
              <span><KoboyoIcon name="bookmark" size={19} /></span>
              <strong>还没有收藏</strong>
              <p>收藏完整回答，或划选其中的结论保存为片段。</p>
            </div>
          ) : view === 'river' ? (
            <ReadingCardRiver
              cards={cards}
              selectedCardId={selectedId}
              paused={paused}
              onOpenCard={openCard}
              onRemoveCard={onRemove}
            />
          ) : (
            <div className="reading-cards-list-layout">
              <div className="reading-cards-list" aria-label="收藏列表">
                {cards.map((card) => (
                  <div className={`reading-card-list-row${selectedIds.includes(card.id) ? ' is-selected' : ''}`} key={card.id}>
                    <input type="checkbox" aria-label={`选择 ${card.title}`} checked={selectedIds.includes(card.id)} onChange={() => toggleSelection(card.id)} />
                    <button type="button" className="reading-card-list-open" onClick={() => openCard(card.id, 'pointer')}>
                      <small>{readingCardKindLabel(card)}{!readingCardQuestion(card, conversations) ? ' · 原问题缺失' : ''}</small>
                      <strong>{card.title}</strong>
                      <span>{readingCardQuestion(card, conversations) || '旧收藏找不到原始问题'}</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="reading-cards-batch-actions">
                {saveReport && <div className="reading-cards-save-report" role="status">
                  <strong>保存结果</strong>
                  {saveReport.map((result) => <p key={result.cardId}>{result.status === 'saved' ? '已新建' : result.status === 'existing' ? '已存在' : '未保存'} · {result.title}：{result.detail}</p>)}
                </div>}
                {batchIssue && <p className="reading-cards-issue" role="alert">{batchIssue}</p>}
                {collectionSend?.status === 'uncertain' && <p className="reading-cards-batch-uncertain">上次发送结果待确认，原选择已保留，不会自动重发。</p>}
                <div className="reading-cards-batch-meta"><span>已选 {selectedIds.length} 条</span><span>{selectedIds.length > 0 ? `${sendCharacters} / ${MAX_COLLECTION_MATERIAL_CHARACTERS} 字资料` : '勾选后可批量操作'}</span></div>
                <div className="reading-cards-batch-buttons">
                  <button type="button" disabled={!selectedIds.length || batchBusy} onClick={sendBatch}>用所选收藏开启新会话</button>
                  <button type="button" disabled={!selectedIds.length || batchBusy} onClick={() => void saveBatch()}>{batchBusy ? '正在保存…' : '保存到 Obsidian'}</button>
                </div>
                {selectedIds.length > 0 && <button type="button" className="reading-cards-clear-selection" onClick={() => setSelectedIds([])}>清空选择</button>}
              </div>
            </div>
          )}

          {selected && (
            <>
              <button
                className="reading-card-reader-scrim"
                type="button"
                tabIndex={-1}
                aria-label={view === 'list' ? '返回收藏列表' : '返回收藏瀑布流'}
                onClick={closeReader}
              />
              <section className="reading-card-reader" aria-labelledby="reading-card-reader-title">
                <header className="reading-card-reader-header">
                  <button
                    className="reading-card-reader-back pressable"
                    type="button"
                    onClick={closeReader}
                    aria-label={view === 'list' ? '返回收藏列表' : '返回收藏瀑布流'}
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <div>
                    <small>{readingCardKindLabel(selected)} · 收藏于 {formatMessageTimestamp(selected.createdAt).fullLabel}</small>
                    <h2 id="reading-card-reader-title">{selected.title}</h2>
                  </div>
                </header>

                <div className="reading-card-reader-body">
                  <section className="reading-card-section reading-card-question">
                    <h3>原始问题</h3>
                    <p>{readingCardQuestion(selected, conversations) || '原问题缺失；不会由 WorkOS 猜测或补造。'}</p>
                  </section>
                  <div className="reading-card-detail-meta">
                    <span>{selected.sources.length} 个来源</span>
                    <span>{selected.artifacts.length > 0 ? `${selected.artifacts.length} 个产物` : '正文快照'}</span>
                  </div>
                  {selected.bodyMarkdown ? (
                    <div className="reading-card-markdown markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.bodyMarkdown}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="reading-card-artifact-only">这张卡片保存了一组 Agent 产物。</p>
                  )}

                  {selected.artifacts.length > 0 && (
                    <section className="reading-card-section">
                      <h3>产物</h3>
                      <div className="reading-card-artifacts">
                        {selected.artifacts.map((artifact) => {
                          const url = safeArtifactUrl(artifact.url);
                          return url ? (
                            <a href={url} target="_blank" rel="noreferrer" key={artifact.id}>
                              <KoboyoIcon name="file" size={13} />
                              <span>{artifact.filename}</span>
                            </a>
                          ) : (
                            <span key={artifact.id}>
                              <KoboyoIcon name="file" size={13} />
                              <span>{artifact.filename}</span>
                            </span>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {selected.sources.length > 0 && (
                    <section className="reading-card-section">
                      <h3>来源</h3>
                      <div className="reading-card-sources">
                        {selected.sources.map((source) => {
                          const url = safeArtifactUrl(source.url);
                          const content = (
                            <>
                              <PageFavicon
                                className="reading-card-source-favicon"
                                url={source.url}
                                title={source.title}
                                site={source.site}
                                size={16}
                              />
                              <span className="reading-card-source-copy">
                                <strong>{source.title}</strong>
                                <small>{source.site || source.url}</small>
                              </span>
                            </>
                          );
                          return url
                            ? <a href={url} target="_blank" rel="noreferrer" key={source.url}>{content}</a>
                            : <span key={source.url || source.title}>{content}</span>;
                        })}
                      </div>
                    </section>
                  )}
                </div>

                <footer className="reading-card-detail-actions">
                  <button
                    className="reading-card-source-button pressable"
                    type="button"
                    disabled={!readingCardSourceAvailable(selected, conversations)}
                    onClick={() => onOpenSource(selected)}
                  >
                    <KoboyoIcon name="quote" size={13} />
                    {readingCardSourceAvailable(selected, conversations) ? '回到原对话' : '原对话已删除'}
                  </button>
                  <button
                    className="reading-card-export-button pressable"
                    type="button"
                    disabled={selectedExportPresentation?.spinning}
                    onClick={() => runExport(
                      selected.id,
                      'export-card-markdown',
                      () => onExportCard(selected),
                    )}
                    aria-live="polite"
                  >
                    <KoboyoIcon
                      name={selectedExportPresentation?.icon ?? 'document-download'}
                      size={14}
                      className={selectedExportPresentation?.spinning ? 'is-spinning' : ''}
                    />
                    {selectedExportPresentation?.label ?? '导出 Markdown'}
                  </button>
                  <button className="reading-card-remove-button pressable" type="button" onClick={() => onRemove(selected)}>
                    <KoboyoIcon name="bookmark-minus" size={14} />
                    取消收藏
                  </button>
                </footer>
              </section>
            </>
          )}
        </div>
        {removalUndo && (
          <div className="reading-card-undo is-visible" role="status" aria-live="polite">
            <KoboyoIcon name="bookmark-minus" size={14} />
            <span>已取消收藏</span>
            <button
              type="button"
              onClick={() => {
                const restoredId = removalUndo.card.id;
                onUndoRemove();
                window.requestAnimationFrame(() => {
                  const card = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-reading-card-id]') ?? [])]
                    .find((node) => node.dataset.readingCardId === restoredId);
                  card?.querySelector<HTMLButtonElement>('.reading-card-river__open')?.focus({ preventScroll: true });
                });
              }}
            >撤销</button>
          </div>
        )}
      </aside>
    </div>
  );
}
