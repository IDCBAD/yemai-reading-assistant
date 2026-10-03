import { describe, expect, it, vi } from 'vitest';
import { projectSubagent } from './subagentProjection';
import { WorkosSseParser } from './workosSse';

const part = (status: string) => ({ id: 'task-part', type: 'tool', tool: 'task', callID: 'call-1',
  state: { status, input: { description: '阅读第一篇', subagent_type: 'general', prompt: '阅读 https://example.com/a，提炼核心观点。' },
    metadata: { sessionId: 'ses_child1' }, ...(status === 'completed' ? { output: 'task_id: ses_child1\n<task_result>## 核心观点\n材料由插件管理。</task_result>' } : {}) } });
const event = (value: unknown) => `data: ${JSON.stringify({ data: JSON.stringify({ type: 'message.part.updated', properties: { part: value } }) })}\n\n`;

describe('subagent result projection', () => {
  it('projects explicit task fields, strips the result wrapper, and never treats other tools as children', () => {
    expect(projectSubagent(part('completed'))).toEqual({ sessionId: 'ses_child1', agentType: 'general',
      prompt: '阅读 https://example.com/a，提炼核心观点。', answer: '## 核心观点\n材料由插件管理。' });
    expect(projectSubagent({ ...part('completed'), tool: 'webfetch' })).toBeUndefined();
    expect(projectSubagent({ tool: 'task', state: { status: 'running', output: '尚未确认的结果' } })).toEqual({});
  });

  it('bounds persisted content and accepts only opaque session identifiers', () => {
    const projected = projectSubagent({ tool: 'task', state: { status: 'completed', input: { prompt: '字'.repeat(12_001) },
      metadata: { sessionId: 'https://example.com/private' }, output: '字'.repeat(24_001) } });
    expect(projected?.sessionId).toBeUndefined();
    expect(projected?.prompt).toHaveLength(12_000);
    expect(projected?.answer).toHaveLength(24_000);
    expect(projected?.truncated).toBe(true);
  });

  it('updates the same activity with the actual child result without adding it to the main answer', () => {
    const onActivity = vi.fn(); const onText = vi.fn();
    const parser = new WorkosSseParser({ onActivity, onText });
    parser.push(event(part('running')));
    parser.push(event(part('completed')));
    expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'call-1', kind: 'subagent', status: 'completed',
      subagent: { sessionId: 'ses_child1', answer: '## 核心观点\n材料由插件管理。' } });
    expect(onActivity.mock.calls[0]?.[0].id).toBe(onActivity.mock.calls[1]?.[0].id);
    expect(onText).not.toHaveBeenCalled();
  });

  it('recognizes a legacy task event but leaves unavailable details empty', () => {
    const onActivity = vi.fn();
    const parser = new WorkosSseParser({ onActivity, onText: vi.fn() });
    parser.push(`data: ${JSON.stringify({ type: 'tool.after', properties: { callID: 'legacy-task', tool: 'task', status: 'completed', output: '原始工具输出' } })}\n\n`);
    expect(onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'legacy-task', kind: 'subagent', status: 'completed', subagent: {} }));
  });
});
