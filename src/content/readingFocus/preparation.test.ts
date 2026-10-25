import { describe, expect, it } from 'vitest';
import { preparationContent } from './preparation';
import type { ReadingFocusStatus } from './index';

const status: ReadingFocusStatus = { enabled: true, count: 13, phase: 'preparing', taskId: 'article', taskStatus: 'analyzing' };

describe('reading preparation feedback boundaries', () => {
  it('only reports receiving after the task actually enters receiving', () => {
    expect(preparationContent(status, 60).title).toBe('正在分析文章意群');
    expect(preparationContent({ ...status, taskStatus: 'receiving' }, 2).title).toBe('正在接收分析结果');
    expect(preparationContent(status, 2).note).toBe('');
    expect(preparationContent(status, 30).note).toContain('后台继续');
  });
  it('does not offer retry for an unknown remote task, and preserves an explicit stop', () => {
    const view = preparationContent({ ...status, phase: 'error', taskStatus: 'unknown' }, 300);
    expect(view.pending).toBe(false);
    expect(view.canRetry).toBe(false);
    expect(view.canStop).toBe(true);
    expect(view.note).toContain('暂不重复提交');
  });
  it('disables duplicate stop requests while stopping and offers retry only after a terminal result', () => {
    expect(preparationContent({ ...status, taskStatus: 'stopping' }, 60)).toMatchObject({ pending: true, canStop: false, canRetry: false, note: '' });
    for (const taskStatus of ['failed', 'stopped'] as const) {
      expect(preparationContent({ ...status, phase: 'error', taskStatus }, 0)).toMatchObject({ pending: false, canStop: false, canRetry: true });
    }
  });
  it('does not claim a stop request is being sent when the connection cannot stop remotely', () => {
    expect(preparationContent({ ...status, taskStatus: 'stopping', message: '当前通道不支持远端停止；将继续接收结果并缓存。' }, 5))
      .toMatchObject({ title: '正在等待分析结果', note: '当前连接不支持远端停止，结果返回后会缓存。', canStop: false });
  });
  it('distinguishes unsupported pages and partial completion from analysis in progress', () => {
    expect(preparationContent({ enabled: true, count: 0, phase: 'unsupported', message: '没有找到英文正文。' }, 0))
      .toMatchObject({ pending: false, failed: true, canStop: false, canRetry: false, note: '没有找到英文正文。' });
    expect(preparationContent({ ...status, phase: 'ready', taskStatus: 'ready', readyCount: 11, invalidCount: 2 }, 9).note)
      .toBe('已准备 11/13 段，其余段落仅提供聚焦。');
  });
});
