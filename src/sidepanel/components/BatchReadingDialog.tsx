import { useMemo, useState } from 'react';
import type { LinkContextItem } from '../types';
import { MAX_BATCH_LINKS, parseReadingLinks } from '../batchReading';
import { CollectionReferenceDialog } from './CollectionReferenceDialog';
import { KoboyoIcon } from './KoboyoIcon';

export function BatchReadingDialog({ existingCount, onAdd, onClose }: {
  existingCount: number;
  onAdd: (links: Array<LinkContextItem['link']>) => string | undefined;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const parsed = useMemo(() => parseReadingLinks(input), [input]);
  const selected = parsed.links.filter((link) => !excluded.has(link.url));
  return <CollectionReferenceDialog label="批量阅读" onClose={onClose} className="batch-reading-dialog">
    <header className="batch-reading-header"><strong>批量阅读</strong>
      <button type="button" className="icon-button pressable" aria-label="关闭批量阅读" onClick={onClose}><KoboyoIcon name="cross" size={15} /></button>
    </header>
    <div className="batch-reading-body">
      <textarea data-collection-initial-focus aria-label="网页链接" placeholder="粘贴链接，每行一个" value={input} maxLength={15_000}
        onChange={(event) => { setInput(event.target.value); setError(undefined); }} />
      <div className="batch-reading-count">每组最多 {MAX_BATCH_LINKS} 个网页{existingCount ? ` · 已加入 ${existingCount} 个` : ''}</div>
      {(parsed.duplicates > 0 || parsed.invalid > 0) && <p className="batch-reading-note" role="status">
        {parsed.duplicates > 0 && `已合并 ${parsed.duplicates} 个重复链接。`}{parsed.invalid > 0 && `${parsed.invalid} 项未识别为可用链接。`}
      </p>}
      <div className="batch-reading-links">{parsed.links.map((link) => <div className="batch-reading-link" key={link.url}>
        <input type="checkbox" aria-label={`选择 ${link.url}`} checked={!excluded.has(link.url)} onChange={(event) => {
          const next = new Set(excluded); if (event.target.checked) next.delete(link.url); else next.add(link.url); setExcluded(next); setError(undefined);
        }} />
        <div><input aria-label={`网页名称 ${link.url}`} value={titles[link.url] ?? link.title} maxLength={160}
          onChange={(event) => setTitles((current) => ({ ...current, [link.url]: event.target.value }))} />
          <span>{link.url}</span></div>
      </div>)}</div>
      {error && <p className="batch-reading-error" role="alert">{error}</p>}
    </div>
    <footer className="collection-reference-footer"><button type="button" className="collection-reference-add" disabled={!selected.length}
      onClick={() => { const issue = onAdd(selected.map((link) => ({ ...link, title: titles[link.url] ?? link.title }))); if (issue) setError(issue); }}>
      加入当前问题{selected.length ? ` (${selected.length})` : ''}
    </button></footer>
  </CollectionReferenceDialog>;
}
