import { KoboyoIcon } from './KoboyoIcon';
import type { PageContext, PageStatus } from '../types';

const STATUS_COPY: Record<PageStatus, string> = {
  'not-read': '尚未读入',
  reading: '正在读取',
  ready: '已读取，待发送',
  read: '已进入对话',
  changed: '页面已变化',
};

interface SourceBarProps {
  page: PageContext;
  pageReadEnabled: boolean;
  issue: string | null;
  onRefresh: () => void;
}

export function SourceBar({ page, pageReadEnabled, issue, onRefresh }: SourceBarProps) {
  return (
    <section className="source-bar" aria-label="当前页面">
      <span className="source-spine" aria-hidden="true" />
      <span className="source-glyph" aria-hidden="true">
        <KoboyoIcon name="globe" size={17} />
      </span>
      <div className="source-main">
        <div className="source-heading-row">
          <h2 className="source-title" title={`${page.site} · ${page.title}`}>
            {page.title}
            <span> / {page.site}</span>
          </h2>
          <span className={`source-status source-status--${page.status}`}>
            {page.status === 'read' && <KoboyoIcon name="solid-checkmark" size={10} />}
            {STATUS_COPY[page.status]}
          </span>
        </div>
        <p className={`source-url${issue ? ' has-issue' : ''}`} title={issue ?? page.url} role={issue ? 'status' : undefined}>
          {issue ?? new URL(page.url).hostname}
        </p>
      </div>
      <div className="source-actions">
        <button
          className="source-action pressable"
          type="button"
          onClick={onRefresh}
          aria-label={page.status === 'read' || page.status === 'ready' ? '重新读取页面' : '读取当前页面'}
          title={pageReadEnabled ? page.status === 'read' || page.status === 'ready' ? '重新读取页面' : '读取当前页面' : '当前页面不支持读取'}
          disabled={!pageReadEnabled || page.status === 'reading'}
        >
          <KoboyoIcon
            className={page.status === 'reading' ? 'is-spinning' : undefined}
            name="cycle"
            size={15}
          />
          <span>{page.status === 'read' || page.status === 'ready' ? '重新读取' : '读取页面'}</span>
        </button>
      </div>
    </section>
  );
}
