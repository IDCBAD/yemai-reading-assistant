import { useId, useState } from 'react';
import type { AnswerContextSource } from '../answerContext';
import { attachmentFormatLabel } from '../fileTypes';
import { FileTypeIcon } from './FileTypeIcon';
import { KoboyoIcon } from './KoboyoIcon';
import { PageFavicon } from './PageFavicon';

interface AnswerContextTraceProps {
  sources: AnswerContextSource[];
}

function compactText(value: string, maximum = 70) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum).trimEnd()}…` : normalized;
}

function sourceTitle(source: AnswerContextSource) {
  if (source.kind === 'page') return source.page.title || source.page.site || source.page.url;
  if (source.kind === 'quote') return source.quote.pageTitle || compactText(source.quote.text, 36);
  if (source.kind === 'attachment') return source.attachment.filename;
  return source.title;
}

function pageDeliveryLabel(source: Extract<AnswerContextSource, { kind: 'page' }>) {
  if (source.issue) return '仅链接';
  if (source.delivery === 'reuse') return '会话沿用';
  return '已提供';
}

function ContextSourceIcon({ source }: { source: AnswerContextSource }) {
  if (source.kind === 'page') {
    return (
      <PageFavicon
        url={source.page.url}
        title={source.page.title}
        site={source.page.site}
        size={18}
      />
    );
  }
  if (source.kind === 'quote') {
    return (
      <span className="answer-context-quote-icon" aria-hidden="true">
        <KoboyoIcon name="quote" size={14} />
      </span>
    );
  }
  if (source.kind === 'memory' || source.kind === 'link') {
    return (
      <span className="answer-context-quote-icon" aria-hidden="true">
        <KoboyoIcon name={source.kind === 'link' ? 'link' : 'archive'} size={14} />
      </span>
    );
  }
  return (
    <FileTypeIcon
      filename={source.attachment.filename}
      mime={source.attachment.mime}
      variant="token"
      className="answer-context-file-icon"
    />
  );
}

function ContextSourceRow({ source }: { source: AnswerContextSource }) {
  if (source.kind === 'page') {
    const detail = source.issue
      ? source.issue
      : `当前网页 · ${source.page.site || source.page.url}`;
    return (
      <div className="answer-context-source">
        <ContextSourceIcon source={source} />
        <span className="answer-context-source-copy">
          <strong>{sourceTitle(source)}</strong>
          <small title={detail}>{detail}</small>
        </span>
        <span className={`answer-context-source-status${source.issue ? ' has-issue' : ''}`}>
          {pageDeliveryLabel(source)}
        </span>
      </div>
    );
  }

  if (source.kind === 'quote') {
    return (
      <div className="answer-context-source">
        <ContextSourceIcon source={source} />
        <span className="answer-context-source-copy">
          <strong>{sourceTitle(source)}</strong>
          <small title={source.quote.text}>划词引用 · {compactText(source.quote.text)}</small>
        </span>
        <span className="answer-context-source-status">已提供</span>
      </div>
    );
  }

  if (source.kind === 'memory' || source.kind === 'link') {
    const detail = source.kind === 'memory' ? source.excerpt : source.url;
    return (
      <div className="answer-context-source">
        <ContextSourceIcon source={source} />
        <span className="answer-context-source-copy">
          <strong>{source.title}</strong>
          <small title={detail}>{source.kind === 'memory' ? '历史记忆' : detail}</small>
        </span>
        <span className="answer-context-source-status">已提供</span>
      </div>
    );
  }

  const format = attachmentFormatLabel(source.attachment.filename, source.attachment.mime);
  return (
    <div className="answer-context-source">
      <ContextSourceIcon source={source} />
      <span className="answer-context-source-copy">
        <strong>{source.attachment.filename}</strong>
        <small>{format} · {source.attachment.sizeLabel}</small>
      </span>
      <span className="answer-context-source-status">已上传</span>
    </div>
  );
}

export function AnswerContextTrace({ sources }: AnswerContextTraceProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const firstSource = sources[0];
  if (!firstSource) return null;

  const firstTitle = sourceTitle(firstSource);
  const summary = sources.length === 1 ? firstTitle : `${firstTitle} 等 ${sources.length} 项`;

  return (
    <section className="answer-context-trace" aria-label="本次回答的输入上下文">
      <button
        className="answer-context-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="answer-context-label">本次上下文</span>
        <span className="answer-context-count" aria-label={`${sources.length} 项`}>{sources.length}</span>
        <span className="answer-context-summary" title={summary}>{summary}</span>
        <span className={`disclosure-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="answer-context-detail" id={detailId}>
          <p>随问题提供</p>
          <div className="answer-context-source-list">
            {sources.map((source) => <ContextSourceRow source={source} key={source.id} />)}
          </div>
        </div>
      )}
    </section>
  );
}
