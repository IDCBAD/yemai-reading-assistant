import { useEffect, useRef, useState } from 'react';
import type { CognitionComparisonResult, CognitionProjectionRow } from '../../cognition/cognitionLoop';
import { COGNITION_TYPE_LABELS } from '../../cognition/candidate';
import { KoboyoIcon } from './KoboyoIcon';

export interface CognitionDetails {
  filename: string;
  status: string;
  currentUnderstanding: string;
  events: string[];
}

export function CognitionReencounterNotice({
  matches,
  onCompare,
  onDismiss,
}: {
  matches: Array<CognitionProjectionRow & { score: number; reason: string }>;
  onCompare: (cognition: CognitionProjectionRow) => void;
  onDismiss: () => void;
}) {
  const primary = matches[0];
  if (!primary) return null;
  return (
    <aside className="cognition-reencounter" aria-label="相关个人认知">
      <span className="cognition-reencounter__pulse" aria-hidden="true" />
      <div>
        <small>发生了一次认知重遇</small>
        <strong>{primary.title}</strong>
        <p>{primary.reason}{matches.length > 1 ? `，另有 ${matches.length - 1} 条相关认知` : ''}</p>
      </div>
      <div className="cognition-reencounter__actions">
        <button type="button" className="pressable" onClick={() => onCompare(primary)}>与当前材料对照</button>
        <button type="button" className="pressable" onClick={onDismiss}>稍后</button>
      </div>
    </aside>
  );
}

export function CognitionWorkbench({
  cognition,
  state,
  result,
  issue,
  details,
  onResolve,
  onClose,
}: {
  cognition: CognitionProjectionRow;
  state: 'comparing' | 'ready' | 'saving' | 'saved' | 'error';
  result?: CognitionComparisonResult;
  issue?: string;
  details?: CognitionDetails;
  onResolve: (outcome: CognitionComparisonResult['outcome'], revisedUnderstanding: string | undefined, revisedBoundary: string | undefined, userReason: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [outcome, setOutcome] = useState<CognitionComparisonResult['outcome']>(result?.outcome ?? 'wait');
  const [revision, setRevision] = useState(result?.revisedUnderstanding ?? '');
  const [boundaryRevision, setBoundaryRevision] = useState(result?.revisedBoundary ?? '');
  const [userReason, setUserReason] = useState('');

  useEffect(() => {
    if (result) {
      setOutcome(result.outcome);
      setRevision(result.revisedUnderstanding ?? '');
      setBoundaryRevision(result.revisedBoundary ?? '');
    }
  }, [result]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="cognition-workbench-layer" role="presentation">
      <div ref={dialogRef} className="cognition-workbench" role="dialog" aria-modal="true" aria-labelledby="cognition-workbench-title">
        <header>
          <div>
            <small>{COGNITION_TYPE_LABELS[cognition.type as keyof typeof COGNITION_TYPE_LABELS] ?? '个人认知'} · 对照工作台</small>
            <h2 id="cognition-workbench-title">{cognition.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button pressable" onClick={onClose} aria-label="返回原对话">
            <KoboyoIcon name="cross" size={16} />
          </button>
        </header>

        {state === 'comparing' && <div className="cognition-workbench__loading" role="status"><i className="activity-spinner" />正在比较当前材料与旧认知…</div>}
        {issue && <p className="cognition-workbench__issue" role="alert">{issue}</p>}
        {result && (
          <>
            <section className="cognition-workbench__comparison" aria-label="原认知与当前材料">
              <article>
                <small>原认知</small>
                <strong>{cognition.title}</strong>
                <p>{result.previousUnderstanding}</p>
                {result.previousBoundary && <small className="cognition-workbench__boundary">边界：{result.previousBoundary}</small>}
              </article>
              <span aria-hidden="true">↔</span>
              <article>
                <small>当前材料</small>
                <strong>{result.page?.title ?? '当前页面'}</strong>
                <p>{result.page?.description || result.page?.url}</p>
              </article>
            </section>
            <section className="cognition-workbench__analysis">
              <small>Agent 的结构化分析</small>
              <dl>
                {result.support && <div><dt>支持证据</dt><dd>{result.support}</dd></div>}
                {result.challenge && <div><dt>挑战证据</dt><dd>{result.challenge}</dd></div>}
                {result.boundaryChange && <div><dt>可能的边界变化</dt><dd>{result.boundaryChange}</dd></div>}
                <div><dt>关系判断</dt><dd>{result.rationale}</dd></div>
              </dl>
            </section>
            <fieldset className="cognition-workbench__choices" disabled={state === 'saving' || state === 'saved'}>
              <legend>最终决定由你确认</legend>
              {([
                ['keep', '保留原判断'],
                ['revise', '修订这条认知'],
                ['wait', '保存为待验证'],
              ] as const).map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="cognition-outcome" checked={outcome === value} onChange={() => setOutcome(value)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            {outcome === 'revise' && (
              <div className="cognition-workbench__revision-group">
                <label className="cognition-workbench__revision">
                  <span>修订后的当前理解</span>
                  <textarea rows={4} maxLength={4_000} value={revision} disabled={state === 'saving' || state === 'saved'} onChange={(event) => setRevision(event.target.value)} />
                </label>
                <label className="cognition-workbench__revision">
                  <span>修订后的适用边界</span>
                  <textarea rows={3} maxLength={4_000} value={boundaryRevision} disabled={state === 'saving' || state === 'saved'} onChange={(event) => setBoundaryRevision(event.target.value)} placeholder="可以只修订理解或只修订边界" />
                </label>
              </div>
            )}
            <label className="cognition-workbench__revision">
              <span>你的判断依据</span>
              <textarea rows={2} maxLength={2_000} value={userReason} disabled={state === 'saving' || state === 'saved'} onChange={(event) => setUserReason(event.target.value)} placeholder="为什么保留、修订或等待更多证据？" />
            </label>
          </>
        )}
        {state === 'saved' && details && (
          <section className="cognition-workbench__receipt" role="status">
            <strong>认知已更新</strong>
            <p>{details.currentUnderstanding}</p>
            <small>{details.filename}</small>
            <details>
              <summary>查看完整演化记录（{details.events.length}）</summary>
              <ol>{details.events.map((event, index) => <li key={`${index}-${event}`}>{event.replace(/<!--.*?-->/g, '').replace(/^-\s*/, '')}</li>)}</ol>
            </details>
          </section>
        )}
        <footer>
          <button type="button" className="secondary-button pressable" onClick={onClose}>{state === 'saved' ? '回到原对话' : '暂不处理'}</button>
          {result && state !== 'saved' && (
            <button type="button" className="save-token-button pressable" disabled={state === 'saving' || !userReason.trim() || (outcome === 'revise' && !revision.trim() && !boundaryRevision.trim())} onClick={() => onResolve(outcome, revision.trim() || undefined, boundaryRevision.trim() || undefined, userReason.trim())}>
              {state === 'saving' ? '正在写入…' : outcome === 'revise' ? '应用修订' : outcome === 'keep' ? '保留原认知' : '保存为待验证'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function CognitionLocalView({
  cognition,
  details,
  issue,
  onCompare,
  onClose,
}: {
  cognition: CognitionProjectionRow;
  details?: CognitionDetails;
  issue?: string;
  onCompare: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="cognition-workbench-layer" role="presentation">
      <div ref={dialogRef} className="cognition-workbench cognition-local-view" role="dialog" aria-modal="true" aria-labelledby="cognition-local-view-title">
        <header>
          <div>
            <small>{COGNITION_TYPE_LABELS[cognition.type as keyof typeof COGNITION_TYPE_LABELS] ?? '个人认知'} · 本地详情</small>
            <h2 id="cognition-local-view-title">{cognition.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button pressable" onClick={onClose} aria-label="关闭本地认知详情">
            <KoboyoIcon name="cross" size={16} />
          </button>
        </header>
        {!details && !issue && <div className="cognition-workbench__loading" role="status"><i className="activity-spinner" />正在读取本地认知…</div>}
        {issue && <p className="cognition-workbench__issue" role="alert">{issue}</p>}
        {details && (
          <>
            <section className="cognition-local-view__current">
              <small>当前理解</small>
              <p>{details.currentUnderstanding}</p>
            </section>
            <details className="cognition-local-view__evolution">
              <summary>演化记录（{details.events.length}）</summary>
              <ol>{details.events.map((event, index) => <li key={`${index}-${event}`}>{event.replace(/<!--.*?-->/g, '').replace(/^-\s*/, '')}</li>)}</ol>
            </details>
            <small className="cognition-local-view__source">本地文件：{details.filename}</small>
          </>
        )}
        <footer>
          <button type="button" className="secondary-button pressable" onClick={onClose}>稍后</button>
          <button type="button" className="save-token-button pressable" disabled={!details} onClick={onCompare}>与当前材料对照</button>
        </footer>
      </div>
    </div>
  );
}
