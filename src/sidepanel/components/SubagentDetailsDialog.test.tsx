import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubagentDetailsDialog } from './SubagentDetailsDialog';

vi.mock('./CollectionReferenceDialog', () => ({ CollectionReferenceDialog: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

describe('subagent progress loss', () => {
  it.each([true, undefined] as const)('distinguishes unknown progress from a confirmed stop: %s', (progressUnconfirmed) => {
    const html = renderToStaticMarkup(<SubagentDetailsDialog
      activity={{ id: 'child', kind: 'subagent', title: '长任务', status: 'stopped', progressUnconfirmed }}
      index={0} count={1} onPrevious={() => undefined} onNext={() => undefined} onClose={() => undefined}
    />);
    if (progressUnconfirmed) {
      expect(html).toContain('状态未确认');
      expect(html).toContain('进度连接已断开，尚未收到子任务结果');
      expect(html).not.toContain('已停止');
    } else {
      expect(html).toContain('已停止');
      expect(html).not.toContain('状态未确认');
    }
  });
});
