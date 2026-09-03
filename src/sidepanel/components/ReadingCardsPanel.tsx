import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReadingCardRow } from '../../data/database';
import {
  actionPresentation,
  type ActionFeedbackState,
  type ReadingCardRemovalUndo,
  type SemanticAction,
} from '../actionSemantics';
import { readingCardKind, readingCardSourceAvailable } from '../readingCards';
import type { Conversation } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
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
}: ReadingCardsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [readerModality, setReaderModality] = useState<ReadingCardOpenModality>('programmatic');
  const [exportFeedback, setExportFeedback] = useState<{
    key: string;
    state: Exclude<ActionFeedbackState, 'idle'>;
  } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const returnFocusIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selected = useMemo(() => cards.find((card) => card.id === selectedId), [cards, selectedId]);
  selectedIdRef.current = selectedId;

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
    setReaderModality('programmatic');
    setSelectedId(nextSelectedId);
    returnFocusIdRef.current = nextSelectedId;
  }, [open, selectedCardId]);

  useEffect(() => {
    if (selectedId && !cards.some((card) => card.id === selectedId)) {
      setSelectedId(null);
      onReaderClose?.();
    }
  }, [cards, onReaderClose, selectedId]);

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
        ?.querySelector<HTMLElement>('.reading-card-river__open, .reading-cards-close')
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
            'button:not(:disabled), a[href]',
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
          <div>
            <p className="eyebrow">Collection</p>
            <h2>收藏</h2>
          </div>
          <div className="reading-cards-header-actions">
            {cards.length > 0 && (
              <button
                className="reading-cards-export-all pressable"
                type="button"
                disabled={exportAllPresentation.spinning}
                onClick={() => runExport('all', 'export-all-cards', () => onExportAll(cards))}
                aria-live="polite"
              >
                <KoboyoIcon
                  name={exportAllPresentation.icon}
                  size={14}
                  className={exportAllPresentation.spinning ? 'is-spinning' : ''}
                />
                {exportAllPresentation.label}
              </button>
            )}
            <span className="reading-cards-count">{cards.length}</span>
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
          ) : (
            <ReadingCardRiver
              cards={cards}
              selectedCardId={selectedId}
              paused={paused}
              onOpenCard={openCard}
            />
          )}

          {selected && (
            <>
              <button
                className="reading-card-reader-scrim"
                type="button"
                tabIndex={-1}
                aria-label="返回收藏河流"
                onClick={closeReader}
              />
              <section className="reading-card-reader" aria-labelledby="reading-card-reader-title">
                <header className="reading-card-reader-header">
                  <button
                    className="reading-card-reader-back pressable"
                    type="button"
                    onClick={closeReader}
                    aria-label="返回收藏河流"
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <div>
                    <small>{readingCardKindLabel(selected)} · 收藏于 {formatMessageTimestamp(selected.createdAt).fullLabel}</small>
                    <h2 id="reading-card-reader-title">{selected.title}</h2>
                  </div>
                </header>

                <div className="reading-card-reader-body">
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
            <KoboyoIcon name="bookmark-minus" size={16} />
            <span>已移出收藏</span>
            <span className="reading-card-undo-timer" aria-hidden="true"><i key={removalUndo.expiresAt} /></span>
            <button className="pressable" type="button" onClick={onUndoRemove}>撤销</button>
          </div>
        )}
      </aside>
    </div>
  );
}
