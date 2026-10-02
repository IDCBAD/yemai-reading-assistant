import { memo, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describeCodeBlock } from '../codeBlockLanguage';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';
import { MermaidDiagram } from './MermaidDiagram';

function useCopyFeedback() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setState('idle');
      timerRef.current = null;
    }, 1600);
  };

  return { state, copy };
}

function MarkdownTable({ children, source }: { children: ReactNode; source: string }) {
  const { state, copy } = useCopyFeedback();
  const tableRef = useRef<HTMLTableElement>(null);
  const feedback = state === 'copied' ? '已复制表格' : state === 'failed' ? '复制失败，请重试' : '复制表格';

  return (
    <div className="markdown-table-shell">
      <div className="markdown-table-scroll" role="region" aria-label="回答表格，可横向滚动" tabIndex={0}>
        <table ref={tableRef}>{children}</table>
      </div>
      <IconTooltipButton
        className="markdown-table-copy pressable"
        type="button"
        onClick={() => void copy(source || tableRef.current?.innerText || '')}
        aria-label={feedback}
        tooltip={feedback}
      >
        <KoboyoIcon name={state === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
      </IconTooltipButton>
    </div>
  );
}

function CodeBlock({ children, language, streaming }: { children: string; language?: string; streaming: boolean }) {
  const { state, copy } = useCopyFeedback();
  const format = useMemo(() => describeCodeBlock(language, children), [language, children]);
  const [highlighted, setHighlighted] = useState<{ source: string; language: string; nodes: ReactNode } | null>(null);

  useEffect(() => {
    const codeLanguage = format.language;
    if (streaming || !codeLanguage || children.length > 20_000) return;
    let active = true;
    void import('../codeHighlight').then(({ highlightCode }) => {
      if (active) setHighlighted({ source: children, language: codeLanguage, nodes: highlightCode(children, codeLanguage) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [children, format.language, streaming]);

  const code = !streaming && highlighted?.source === children && highlighted.language === format.language
    ? highlighted.nodes
    : children;
  const feedback = state === 'copied' ? '已复制内容' : state === 'failed' ? '复制失败，请重试' : '复制内容';

  return (
    <div className="code-block" data-tone={format.tone}>
      <div className="code-block__header">
        <span className="code-block__language">{format.label}</span>
        <IconTooltipButton
          className="code-copy pressable"
          type="button"
          onClick={() => void copy(children)}
          aria-label={feedback}
          tooltip={feedback}
        >
          <KoboyoIcon name={state === 'copied' ? 'solid-checkmark' : 'copy'} size={14} />
        </IconTooltipButton>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Keep Markdown parsing independent of navigation, selection and action feedback.
export const AssistantMarkdown = memo(function AssistantMarkdown({ content, streaming, sourceUrl }: { content: string; streaming: boolean; sourceUrl?: string }) {
  const components = useMemo<Components>(() => ({
    ...(sourceUrl ? {
      a({ children, href }: { children?: ReactNode; href?: string }) {
        let url: string | undefined;
        try { const target = new URL(href ?? '', sourceUrl); if (target.protocol === 'https:') url = target.href; } catch { /* Leave invalid links as text. */ }
        return url ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
      img({ src, alt }: { src?: string; alt?: string }) {
        let url: string | undefined;
        try { const target = new URL(src ?? '', sourceUrl); if (target.protocol === 'https:') url = target.href; } catch { /* Do not load invalid image sources. */ }
        return url ? <img src={url} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>;
      },
    } : {}),
    table({ children, node }) {
      const start = node?.position?.start.offset;
      const end = node?.position?.end.offset;
      const source = typeof start === 'number' && typeof end === 'number'
        ? content.slice(start, end)
        : '';
      return <MarkdownTable source={source}>{children}</MarkdownTable>;
    },
    pre({ children }) {
      const child = isValidElement<{ children?: unknown; className?: string }>(children) ? children : null;
      const value = String(child?.props.children ?? '').replace(/\n$/, '');
      const language = child?.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase();
      if (language === 'mermaid' && !streaming) {
        return <MermaidDiagram source={value} />;
      }
      return <CodeBlock language={language} streaming={streaming}>{value}</CodeBlock>;
    },
    code({ children, className }) {
      return <code className={className ?? 'inline-code'}>{children}</code>;
    },
  }), [content, streaming, sourceUrl]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
});
