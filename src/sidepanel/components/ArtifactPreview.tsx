import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { artifactPreviewKind, decodePreviewText, formatPreviewJson, MAX_PREVIEW_BYTES, MAX_TEXT_BYTES, readPreviewBytes, safeArtifactUrl, staticReportDocument, TEXT_PAGE_SIZE } from '../artifactPreview';
import type { AssistantArtifact } from '../types';
import type { PreviewSheet } from '../spreadsheetPreview';
import { openPreviewTab } from '../previewTab';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ImageViewer } from './ImagePreview';
import { PreviewDialog } from './PreviewDialog';
import { KoboyoIcon } from './KoboyoIcon';
import { IconTooltipButton } from './IconTooltipButton';
import { PreviewHeader } from './PreviewHeader';

type ContentState = { status: 'loading' } | { status: 'error'; error: string }
  | { status: 'ready'; text: string; sheets?: PreviewSheet[]; sourceUrl: string };

function PreviewText({ text, language }: { text: string; language?: string }) {
  const [length, setLength] = useState(TEXT_PAGE_SIZE);
  const content = text.slice(0, length);
  const [highlight, setHighlight] = useState<{ source: string; nodes: ReactNode } | null>(null);
  useEffect(() => {
    if (!language || content.length > TEXT_PAGE_SIZE) return;
    let active = true;
    void import('../codeHighlight').then(({ highlightCode }) => {
      if (active) setHighlight({ source: content, nodes: highlightCode(content, language) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [content, language]);
  return <div className="preview-source"><pre tabIndex={0}><code>{highlight?.source === content ? highlight.nodes : content}</code></pre>
    {text.length > length && <button type="button" onClick={() => setLength((value) => value + TEXT_PAGE_SIZE)}>继续显示（已显示 {length.toLocaleString()} 个字符）</button>}
    {!text && <p className="preview-empty">文件内容为空。</p>}
  </div>;
}

function SpreadsheetView({ sheets }: { sheets: PreviewSheet[] }) {
  const [selected, setSelected] = useState(0);
  const [start, setStart] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const sheet = sheets[selected];
  if (!sheet) return <div className="preview-status">文件没有可显示的工作表。</div>;
  return <div className="preview-spreadsheet">
    <div ref={scroll} className="preview-sheet-scroll" role="region" aria-label={`${sheet.name}，可横向和纵向滚动`} tabIndex={0}>
      <table><thead><tr><th aria-label="行号" />{sheet.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
        <tbody>{sheet.rows.slice(start, start + 100).map((row, index) => <tr key={start + index}>
          <th scope="row">{sheet.rowOffset + start + index + 1}</th>{row.map((cell, column) => <td key={column} title={cell}>{cell}</td>)}
        </tr>)}</tbody>
      </table>
      {sheet.rows.length === 0 && <p className="preview-empty">工作表为空。</p>}
    </div>
    <footer className="preview-sheet-footer">
      {sheet.rows.length > 100 && <div className="preview-sheet-pagination">
        <button type="button" disabled={start === 0} onClick={() => { setStart((value) => Math.max(0, value - 100)); if (scroll.current) scroll.current.scrollTop = 0; }}>上一批</button>
        <span aria-live="polite">第 {sheet.rowOffset + start + 1}–{sheet.rowOffset + Math.min(start + 100, sheet.rows.length)} 行</span>
        <button type="button" disabled={start + 100 >= sheet.rows.length} onClick={() => { setStart((value) => value + 100); if (scroll.current) scroll.current.scrollTop = 0; }}>下一批</button>
      </div>}
      <div className="preview-sheet-tabs" aria-label="工作表">{sheets.map((item, index) => <button type="button" key={index} aria-pressed={index === selected} onClick={() => { setSelected(index); setStart(0); if (scroll.current) scroll.current.scrollTop = 0; }}>{item.name}</button>)}</div>
      <small>{sheet.truncated ? '仅预览前 2,000 行、100 列以内的数据，完整内容请下载。' : `${sheet.totalRows.toLocaleString()} 行 · ${sheet.columns.length} 列`}</small>
    </footer>
  </div>;
}

function ReportView({ text, url }: { text: string; url: string }) {
  const document = useMemo(() => staticReportDocument(text, url), [text, url]);
  return <div className="preview-report"><p>静态预览 · 交互功能请下载后使用</p>
    <iframe title="HTML 静态报告" sandbox="" referrerPolicy="no-referrer" srcDoc={document} />
  </div>;
}

export function ArtifactContent({ artifact }: { artifact: AssistantArtifact }) {
  const kind = artifactPreviewKind(artifact);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ContentState>({ status: 'loading' });
  const [raw, setRaw] = useState(false);
  const [copy, setCopy] = useState('复制内容');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(() => {
    if (kind === 'image' || !kind) return;
    const controller = new AbortController();
    let active = true;
    let worker: Worker | undefined;
    setState({ status: 'loading' }); setRaw(false);
    const timeout = setTimeout(() => {
      controller.abort(); worker?.terminate();
      if (active) { active = false; setState({ status: 'error', error: '读取或解析超时，请重试或下载后查看。' }); }
    }, 20_000);
    const ready = (value: Extract<ContentState, { status: 'ready' }>) => {
      clearTimeout(timeout); if (active) setState(value);
    };
    void (async () => {
      const url = safeArtifactUrl(artifact.url);
      if (!url || artifact.status !== 'available') throw new Error('文件暂不可用。');
      const table = kind === 'spreadsheet' || kind === 'csv';
      const limit = table ? MAX_PREVIEW_BYTES : MAX_TEXT_BYTES;
      if (artifact.size && artifact.size > limit) throw new Error('文件过大，请下载后查看。');
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (response.url && !safeArtifactUrl(response.url)) throw new Error('文件跳转到了不支持的地址。');
      const contentType = response.headers.get('content-type') ?? '';
      if (kind !== 'html' && /text\/html/i.test(contentType)) throw new Error('文件链接返回了网页，可能需要登录或链接已失效，请下载后查看。');
      const bytes = await readPreviewBytes(response, limit, controller.signal);
      if (!active) return;
      const text = kind === 'spreadsheet' ? '' : decodePreviewText(bytes, contentType);
      const sourceUrl = response.url || url;
      if (!table) { ready({ status: 'ready', text, sourceUrl }); return; }
      worker = new Worker(new URL('../spreadsheetPreview.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ sheets?: PreviewSheet[]; error?: string }>) => {
        worker?.terminate(); clearTimeout(timeout);
        if (!active) return;
        if (event.data.error) setState({ status: 'error', error: event.data.error });
        else ready({ status: 'ready', text, sheets: event.data.sheets ?? [], sourceUrl });
      };
      worker.onerror = () => { clearTimeout(timeout); worker?.terminate(); if (active) setState({ status: 'error', error: '表格解析失败，请下载后查看。' }); };
      const tableBytes = kind === 'csv' ? new TextEncoder().encode(text) : bytes;
      worker.postMessage({ bytes: tableBytes, csv: kind === 'csv' }, [tableBytes.buffer]);
    })().catch((error: unknown) => {
      clearTimeout(timeout);
      if (active) setState({ status: 'error', error: error instanceof TypeError
        ? '无法读取文件，可能是链接失效或该地址尚不支持在线预览。可以重试或下载后查看。'
        : error instanceof Error ? error.message : '预览失败，请下载后查看。' });
    });
    return () => { active = false; clearTimeout(timeout); controller.abort(); worker?.terminate(); };
  }, [artifact.url, artifact.status, artifact.size, kind, attempt]);
  const json = useMemo(() => state.status === 'ready' && kind === 'json' ? formatPreviewJson(state.text) : null, [state, kind]);
  if (kind === 'image') return <ImageViewer src={safeArtifactUrl(artifact.url) ?? safeArtifactUrl(artifact.thumbnailUrl)!} filename={artifact.filename} />;
  if (!kind) return <div className="preview-status">该格式暂不支持预览，请下载后查看。</div>;
  if (state.status === 'loading') return <div className="preview-status" role="status"><span className="activity-spinner" aria-hidden="true" />正在读取文件…</div>;
  if (state.status === 'error') return <div className="preview-status" role="alert"><p>{state.error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></div>;
  const markdownTooLong = kind === 'markdown' && state.text.length > 200_000;
  return <div className="artifact-file-content">
    {kind !== 'spreadsheet' && <div className="preview-content-tools">
      {['markdown', 'html', 'csv', 'json'].includes(kind) && <div className="preview-mode" aria-label="查看方式">
        <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>{kind === 'html' ? '页面' : kind === 'csv' ? '表格' : kind === 'json' ? '格式化' : '正文'}</button>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>{kind === 'html' ? '源码' : '原文'}</button>
      </div>}
      <IconTooltipButton className="preview-copy-button" type="button" aria-label={copy} tooltip={copy} onClick={() => {
        void navigator.clipboard.writeText(state.text).then(() => setCopy('已复制内容'), () => setCopy('复制失败'));
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopy('复制内容'), 1600);
      }}><KoboyoIcon name="copy" /><span aria-live="polite">{copy}</span></IconTooltipButton>
    </div>}
    {json && !json.valid && <p className="preview-notice" role="status">JSON 格式有误，已显示原文。</p>}
    {markdownTooLong && !raw && <p className="preview-notice">文档较长，已分段显示原文。完整内容可下载查看。</p>}
    <div className="preview-document-body">
      {!raw && kind === 'html' ? <ReportView text={state.text} url={state.sourceUrl} />
        : !raw && kind === 'markdown' && !markdownTooLong ? <div className="markdown-body preview-markdown"><AssistantMarkdown content={state.text} streaming={false} sourceUrl={state.sourceUrl} />{!state.text && <p className="preview-empty">文件内容为空。</p>}</div>
        : (kind === 'spreadsheet' || kind === 'csv' && !raw) ? <SpreadsheetView sheets={state.sheets ?? []} />
        : <PreviewText key={String(raw)} text={!raw && json ? json.text : state.text} language={kind === 'json' ? 'json' : kind === 'html' ? 'xml' : undefined} />}
    </div>
  </div>;
}

export function ArtifactPreview({ artifact, onClose, standalone = false }: { artifact: AssistantArtifact; onClose: () => void; standalone?: boolean }) {
  const [tabError, setTabError] = useState('');
  const [opening, setOpening] = useState(false);
  const url = safeArtifactUrl(artifact.url);
  const content = <>
    <PreviewHeader filename={artifact.filename} downloadUrl={url} onClose={onClose}
      closeLabel={standalone ? '关闭预览标签页' : '关闭产物预览'} opening={opening}
      onOpenTab={standalone ? undefined : () => {
        setOpening(true); setTabError('');
        void openPreviewTab(artifact).catch(() => setTabError('新标签页未能打开，请重试。')).finally(() => setOpening(false));
      }} />
    {tabError && <p className="preview-notice" role="alert">{tabError}</p>}
    <ArtifactContent key={artifact.id + artifact.url} artifact={artifact} />
  </>;
  return standalone ? <main className="artifact-preview-page" aria-label={`产物预览：${artifact.filename}`}>{content}</main>
    : <PreviewDialog label={`产物预览：${artifact.filename}`} onClose={onClose}>{content}</PreviewDialog>;
}
