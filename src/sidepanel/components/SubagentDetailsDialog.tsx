import { useLayoutEffect, useRef } from 'react';
import type { RunActivity } from '../types';
import { AssistantMarkdown } from './AssistantMarkdown';
import { CollectionReferenceDialog } from './CollectionReferenceDialog';
import { KoboyoIcon } from './KoboyoIcon';

const statusCopy = { pending: '等待运行', running: '正在运行', completed: '已完成', failed: '运行失败', stopped: '已停止' };

/** Only the child result returned by the provider is shown here. */
export function SubagentDetailsDialog({ activity, index, count, onPrevious, onNext, onClose }: {
  activity: RunActivity;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [activity.id]);
  const child = activity.subagent;
  return <CollectionReferenceDialog label="子任务详情" className="subagent-detail-dialog" onClose={onClose}>
    <header className="subagent-detail-header">
      <KoboyoIcon name="bot" size={18} />
      <div><strong>{activity.title}</strong><span>{child?.agentType ?? '子智能体'} · {statusCopy[activity.status]}</span></div>
      <button ref={closeButtonRef} data-collection-initial-focus type="button" className="preview-icon-button" aria-label="关闭子任务详情" onClick={onClose}>
        <KoboyoIcon name="cross" size={15} />
      </button>
    </header>
    <div ref={bodyRef} className="subagent-detail-body">
      {child?.prompt && <section><h3>任务</h3><p className="subagent-task-prompt">{child.prompt}</p></section>}
      <section><h3>结果</h3>{child?.answer
        ? <div className="assistant-content"><AssistantMarkdown content={child.answer} streaming={false} /></div>
        : <p className="subagent-detail-empty">{activity.status === 'pending' || activity.status === 'running'
          ? '等待子任务返回结果。' : '当前接口未返回子任务结果。'}</p>}
      </section>
      {child?.truncated && <p className="subagent-detail-empty">内容较长，当前显示部分内容。</p>}
    </div>
    <footer className="subagent-detail-footer">
      <button type="button" disabled={index === 0} onClick={() => {
        // Move focus before the clicked button becomes disabled at the list boundary.
        if (index === 1) closeButtonRef.current?.focus();
        onPrevious();
      }}>上一个</button>
      <span aria-live="polite">{index + 1} / {count}</span>
      <button type="button" disabled={index === count - 1} onClick={() => {
        if (index === count - 2) closeButtonRef.current?.focus();
        onNext();
      }}>下一个</button>
    </footer>
  </CollectionReferenceDialog>;
}
