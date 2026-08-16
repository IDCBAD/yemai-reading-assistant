import { describe, expect, it, vi } from 'vitest';
import { WorkosSseParser } from './workosSse';

function nestedEvent(event: unknown) {
  return `data: ${JSON.stringify({ data: JSON.stringify(event) })}\n\n`;
}

function runEvent(runId: string, eventName: string, event: unknown) {
  return `event: ${eventName}\ndata: ${JSON.stringify({ runId, data: JSON.stringify(event) })}\n\n`;
}

describe('WorkosSseParser', () => {
  it('parses fragmented nested SSE data and emits only text parts', () => {
    const onText = vi.fn();
    const onComplete = vi.fn();
    const parser = new WorkosSseParser({ onText, onComplete });
    const stream = [
      nestedEvent({
        type: 'message.part.updated',
        properties: { part: { id: 'reasoning-1', type: 'reasoning', text: '内部推理' } },
      }),
      nestedEvent({
        type: 'message.part.delta',
        properties: { partID: 'reasoning-1', field: 'text', delta: '不要展示' },
      }),
      nestedEvent({
        type: 'message.part.updated',
        properties: { part: { id: 'text-1', type: 'text', text: '' } },
      }),
      nestedEvent({
        type: 'message.part.delta',
        properties: { partID: 'text-1', field: 'text', delta: '你好' },
      }),
      nestedEvent({ type: 'xybot-stream-complete', properties: {} }),
    ].join('');

    parser.push(stream.slice(0, 17));
    parser.push(stream.slice(17, 91));
    parser.push(stream.slice(91));
    parser.finish();

    expect(onText).toHaveBeenLastCalledWith('你好');
    expect(onText.mock.calls.flat().join('')).not.toContain('内部推理');
    expect(onText.mock.calls.flat().join('')).not.toContain('不要展示');
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('buffers an early delta and lets a full update correct the text', () => {
    const onText = vi.fn();
    const parser = new WorkosSseParser({ onText });

    parser.push(nestedEvent({
      type: 'message.part.delta',
      properties: { partID: 'text-1', field: 'text', delta: '你' },
    }));
    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: { part: { id: 'text-1', type: 'text', text: '你' } },
    }));
    expect(onText).toHaveBeenLastCalledWith('你');
    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: { part: { id: 'text-1', type: 'text', text: '你好' } },
    }));
    parser.push(nestedEvent({
      type: 'message.part.delta',
      properties: { partID: 'text-1', field: 'text', delta: '！' },
    }));

    expect(onText).toHaveBeenLastCalledWith('你好！');
  });

  it('ignores stale events and only completes the expected v2 run', () => {
    const onText = vi.fn();
    const onComplete = vi.fn();
    const parser = new WorkosSseParser({ onText, onComplete }, { expectedRunId: 'run-current' });

    parser.push(runEvent('run-old', 'xybot-stream-complete', {}));
    expect(parser.isComplete).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();

    parser.push(runEvent('run-current', 'message', {
      type: 'message.part.updated',
      properties: { part: { id: 'answer', type: 'text', text: '当前回答' } },
    }));
    parser.push(runEvent('run-current', 'xybot-stream-complete', {}));

    expect(onText).toHaveBeenLastCalledWith('当前回答');
    expect(parser.isComplete).toBe(true);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('accepts v2 envelopes whose data payload is already an object', () => {
    const onText = vi.fn();
    const parser = new WorkosSseParser({ onText }, { expectedRunId: 'run-object' });
    parser.push(`event: message\ndata: ${JSON.stringify({
      runId: 'run-object',
      data: {
        type: 'message.part.updated',
        properties: { part: { id: 'answer', type: 'text', text: '对象载荷' } },
      },
    })}\n\n`);
    expect(onText).toHaveBeenLastCalledWith('对象载荷');
  });

  it('accepts text events without a run id on a run-scoped subscription', () => {
    const onText = vi.fn();
    const parser = new WorkosSseParser({ onText }, { expectedRunId: 'run-current' });

    parser.push(`event: message\ndata: ${JSON.stringify({
      data: JSON.stringify({
        type: 'message.part.updated',
        properties: { part: { id: 'answer', type: 'text', text: '正文仍应显示' } },
      }),
    })}\n\n`);

    expect(onText).toHaveBeenLastCalledWith('正文仍应显示');
  });

  it('reports failed terminal events without exposing unrelated payloads', () => {
    const onError = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onError });
    parser.push(nestedEvent({
      type: 'run.terminal',
      properties: { status: 'failed', message: '工具执行失败', debug: 'secret' },
    }));
    expect(onError).toHaveBeenCalledWith('工具执行失败');
  });

  it.each(['finished', 'finish', 'successful', 'succeeded', 'ok'])('accepts %s as a successful terminal status', (status) => {
    const onError = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onError });
    parser.push(nestedEvent({ type: 'run.terminal', properties: { status } }));
    expect(onError).not.toHaveBeenCalled();
  });

  it('projects tool parts into safe activity updates without raw input or output', () => {
    const onActivity = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onActivity });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          callID: 'call-1',
          type: 'tool',
          tool: '读取智能体人设',
          state: {
            status: 'running',
            input: { token: 'must-not-reach-ui' },
            time: { start: 1_722_000_000 },
          },
        },
      },
    }));
    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          callID: 'call-1',
          type: 'tool',
          tool: '读取智能体人设',
          state: {
            status: 'completed',
            output: 'must-not-reach-ui',
            time: { start: 1_722_000_000, end: 1_722_000_001.25 },
          },
        },
      },
    }));

    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(onActivity).toHaveBeenLastCalledWith({
      id: 'call-1',
      title: '读取智能体人设',
      status: 'completed',
      startedAt: 1_722_000_000_000,
      completedAt: 1_722_000_001_250,
    });
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain('must-not-reach-ui');
  });

  it('merges generic tool before and after events by call id', () => {
    const onActivity = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onActivity });

    parser.push(nestedEvent({
      type: 'tool.execute.before',
      properties: { callId: 'search-1', tool: '联网搜索', args: { query: 'private query' } },
    }));
    parser.push(nestedEvent({
      type: 'tool.execute.after',
      properties: { callId: 'search-1', tool: '联网搜索', output: 'private result' },
    }));

    const first = onActivity.mock.calls[0]![0];
    const last = onActivity.mock.calls[1]![0];
    expect(first).toMatchObject({ id: 'search-1', title: '联网搜索', status: 'running' });
    expect(last).toMatchObject({ id: 'search-1', title: '联网搜索', status: 'completed' });
    expect(last.startedAt).toBe(first.startedAt);
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain('private');
  });
});
