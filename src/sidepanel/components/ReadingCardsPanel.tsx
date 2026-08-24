import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReadingCardRow } from '../../data/database';
import { readingCardSourceAvailable } from '../readingCards';
import type { Conversation } from '../types';
import { formatMessageTimestamp } from '../messageTimestamp';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';

interface ReadingCardsPanelProps {
  open: boolean;
  cards: ReadingCardRow[];
  conversations: Conversation[];
  selectedCardId?: string;
  issue?: string;
  onClose: () => void;
  onRemove: (card: ReadingCardRow) => void;
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

export function ReadingCardsPanel({
  open,
  cards,
  conversations,
  selectedCardId,
  issue,
  onClose,
  onRemove,
  onOpenSource,
  onExportCard,
  onExportAll,
}: ReadingCardsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const selected = useMemo(() => cards.find((card) => card.id === selectedId), [cards, selectedId]);
  selectedIdRef.current = selectedId;

  const showExportFeedback = (key: string) => {
    setExportFeedback(key);
    window.setTimeout(() => setExportFeedback((current) => current === key ? null : current), 1_500);
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
    setSelectedId(selectedCardId ?? null);
  }, [open, selectedCardId]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (selectedIdRef.current) setSelectedId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const selector = selected ? '.reading-cards-back' : '.reading-card-open, .reading-cards-close';
      panelRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selected]);

  if (!rendered) return null;

  return (
    <div className={`reading-cards-layer${visible ? ' is-open' : ''}`} aria-hidden={!open}>
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
        aria-label="阅读卡片"
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href]',
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
        <header className="reading-cards-header">
          <div>
            <p className="eyebrow">Saved answers</p>
            <h2>{selected ? selected.title : '阅读卡片'}</h2>
          </div>
          <div className="reading-cards-header-actions">
            {!selected && cards.length > 0 && (
              <button
                className="reading-cards-export-all pressable"
                type="button"
                onClick={() => {
                  void onExportAll(cards)
                    .then(() => showExportFeedback('all'))
                    .catch(() => undefined);
                }}
                aria-live="polite"
              >
                <KoboyoIcon name={exportFeedback === 'all' ? 'solid-checkmark' : 'file'} size={12} />
                {exportFeedback === 'all' ? '已下载' : '导出全部'}
              </button>
            )}
            {!selected && <span className="reading-cards-count">{cards.length} 项</span>}
            {selected && (
              <button className="reading-cards-back pressable" type="button" onClick={() => setSelectedId(null)}>
                返回列表
              </button>
            )}
            <button
              className="reading-cards-close pressable"
              type="button"
              onClick={onClose}
              aria-label="关闭阅读卡片"
            >
              <KoboyoIcon name="cross" size={13} />
            </button>
          </div>
        </header>

        {issue && <p className="reading-cards-issue" role="status">{issue}</p>}

        {selected ? (
          <article className="reading-card-detail">
            <div className="reading-card-detail-meta">
              <span>收藏于 {formatMessageTimestamp(selected.createdAt).fullLabel}</span>
              <span>{selected.sources.length} 个来源</span>
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
                onClick={() => {
                  void onExportCard(selected)
                    .then(() => showExportFeedback(selected.id))
                    .catch(() => undefined);
                }}
                aria-live="polite"
              >
                <KoboyoIcon name={exportFeedback === selected.id ? 'solid-checkmark' : 'file'} size={12} />
                {exportFeedback === selected.id ? '已下载' : '导出 Markdown'}
              </button>
              <button className="reading-card-remove-button pressable" type="button" onClick={() => onRemove(selected)}>
                <KoboyoIcon name="trash" size={12} />
                取消收藏
              </button>
            </footer>
          </article>
        ) : (
          <div className="reading-cards-list" aria-label="收藏的回答">
            {cards.length === 0 && (
              <div className="reading-cards-empty">
                <span><KoboyoIcon name="bookmark" size={19} /></span>
                <strong>还没有阅读卡片</strong>
                <p>在一条有价值的 Agent 回答下点击收藏，它会独立保存在这里。</p>
              </div>
            )}
            {cards.map((card) => (
              <article className="reading-card-row" key={card.id}>
                <button className="reading-card-open" type="button" onClick={() => setSelectedId(card.id)}>
                  <span className="reading-card-row-copy">
                    <strong>{card.title}</strong>
                    <span>{card.excerpt}</span>
                    <small className="reading-card-row-meta">
                      <PageFavicon
                        className="reading-card-row-favicon"
                        url={card.sources[0]?.url ?? ''}
                        title={card.sources[0]?.title || '页脉回答'}
                        site={card.sources[0]?.site}
                        size={14}
                      />
                      <span>{card.sources[0]?.site || card.sources[0]?.title || '页脉回答'}</span>
                      <time dateTime={new Date(card.createdAt).toISOString()}>
                        {formatMessageTimestamp(card.createdAt).label}
                      </time>
                    </small>
                  </span>
                </button>
                <IconTooltipButton
                  className="reading-card-row-remove pressable"
                  type="button"
                  onClick={() => onRemove(card)}
                  aria-label={`取消收藏：${card.title}`}
                  tooltip="取消收藏"
                >
                  <KoboyoIcon name="cross" size={10} />
                </IconTooltipButton>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
