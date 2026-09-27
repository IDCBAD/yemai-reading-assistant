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

  it('keeps assistant message segments separate and exposes only the latest non-tool-call answer', () => {
    const onText = vi.fn();
    const parser = new WorkosSseParser({ onText });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: { part: { id: 'text-1', messageID: 'message-1', type: 'text', text: '先填写下面的表单。' } },
    }));
    expect(onText).toHaveBeenLastCalledWith('先填写下面的表单。');

    parser.push(nestedEvent({
      type: 'message.updated',
      properties: { info: { id: 'message-1', role: 'assistant', finish: 'tool-calls' } },
    }));
    expect(onText).toHaveBeenLastCalledWith('');

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: { part: { id: 'text-2', messageID: 'message-2', type: 'text', text: '这是表单之后的最终回答。' } },
    }));
    parser.push(nestedEvent({
      type: 'message.updated',
      properties: { info: { id: 'message-2', role: 'assistant', finish: 'stop' } },
    }));

    expect(onText).toHaveBeenLastCalledWith('这是表单之后的最终回答。');
    expect(onText).not.toHaveBeenLastCalledWith('先填写下面的表单。这是表单之后的最终回答。');
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

  it('does not duplicate question interrupts as generic tool activities', () => {
    const onActivity = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onActivity });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'question-part',
          callID: 'question-call',
          type: 'tool',
          tool: 'question',
          state: { status: 'completed' },
        },
      },
    }));
    parser.push(nestedEvent({
      type: 'tool.execute.before',
      properties: { callId: 'question-call-2', tool: 'question' },
    }));

    expect(onActivity).not.toHaveBeenCalled();
  });

  it('projects generated files and images into safe artifacts', () => {
    const onArtifact = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onArtifact });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'file-1',
          type: 'file',
          filename: 'test.html',
          mimeType: 'text/html',
          fileReadUrl: 'https://files.example.com/test.html',
          debug: { token: 'must-not-reach-ui' },
        },
      },
    }));
    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'image-1',
          type: 'image',
          file: {
            filename: '小猫吃鱼.png',
            mime: 'image/png',
            url: 'https://files.example.com/cat.png',
            size: 2048,
          },
        },
      },
    }));

    expect(onArtifact).toHaveBeenCalledWith({
      id: 'file-1',
      kind: 'html',
      filename: 'test.html',
      url: 'https://files.example.com/test.html',
      mime: 'text/html',
      status: 'available',
    });
    expect(onArtifact).toHaveBeenLastCalledWith({
      id: 'image-1',
      kind: 'image',
      filename: '小猫吃鱼.png',
      url: 'https://files.example.com/cat.png',
      mime: 'image/png',
      size: 2048,
      status: 'available',
    });
    expect(JSON.stringify(onArtifact.mock.calls)).not.toContain('must-not-reach-ui');
  });

  it.each([
    {
      type: 'markdown',
      filename: 'test-simple.md',
      contentType: 'text/markdown; charset=utf-8',
      url: 'https://files.example.com/test-simple.md',
      kind: 'markdown',
      size: 128,
    },
    {
      type: 'html',
      filename: 'test-terminal.html',
      contentType: 'text/html; charset=utf-8',
      url: 'https://files.example.com/test-terminal.html',
      kind: 'html',
      size: 256,
    },
    {
      type: 'pdf',
      filename: 'test-3.pdf',
      contentType: 'application/pdf',
      url: 'https://files.example.com/test-3.pdf',
      kind: 'document',
      size: 512,
    },
    {
      type: 'image',
      filename: '%E9%9A%8F%E4%BE%BF%E4%B8%80%E5%BC%A0%E5%9B%BE.png',
      contentType: 'image/jpeg',
      url: 'https://files.example.com/%25E9%259A%258F%25E4%25BE%25BF%25E4%25B8%2580%25E5%25BC%25A0%25E5%259B%25BE.png',
      kind: 'image',
      size: 1024,
      expectedFilename: '随便一张图.png',
    },
  ])('projects WorkOS tool material for $type output', ({
    type,
    filename,
    contentType,
    url,
    kind,
    size,
    expectedFilename = filename,
  }) => {
    const onActivity = vi.fn();
    const onArtifact = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onActivity, onArtifact });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: `tool-${type}`,
          type: 'tool',
          state: {
            status: 'completed',
            input: 'must-not-reach-ui-input',
            output: 'must-not-reach-ui-output',
            title: '生成文件',
            metadata: {
              material: {
                uuid: `material-${type}`,
                type,
                filename,
                contentType,
                contentLength: size,
                url,
                metadata: { privateValue: 'must-not-reach-ui-metadata' },
              },
            },
          },
        },
      },
    }));

    expect(onArtifact).toHaveBeenCalledOnce();
    expect(onArtifact).toHaveBeenCalledWith({
      id: `material-${type}`,
      kind,
      filename: expectedFilename,
      url,
      mime: contentType,
      size,
      status: 'available',
    });
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain('must-not-reach-ui');
    expect(JSON.stringify(onArtifact.mock.calls)).not.toContain('must-not-reach-ui');
  });

  it('reads resource collections attached to a final text part and rejects unsafe URLs', () => {
    const onArtifact = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onArtifact });

    parser.push(nestedEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'text-1',
          type: 'text',
          text: '文件已经生成。',
          files: [
            { id: 'safe', name: 'report.md', url: 'https://files.example.com/report.md' },
            { id: 'unsafe', name: 'attack.html', url: 'javascript:alert(1)' },
          ],
        },
      },
    }));

    expect(onArtifact).toHaveBeenCalledTimes(1);
    expect(onArtifact).toHaveBeenCalledWith(expect.objectContaining({
      id: 'safe',
      kind: 'markdown',
      filename: 'report.md',
      url: 'https://files.example.com/report.md',
    }));
  });

  it('upserts repeated artifact updates instead of emitting duplicate identities', () => {
    const onArtifact = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onArtifact });
    const url = 'https://files.example.com/result.pdf';

    parser.push(nestedEvent({
      type: 'message.file.updated',
      properties: { file: { id: 'first', filename: 'result.pdf', url } },
    }));
    parser.push(nestedEvent({
      type: 'message.file.updated',
      properties: { file: { id: 'second', filename: 'result.pdf', url, size: 4096 } },
    }));

    expect(onArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'first',
      filename: 'result.pdf',
      url,
      size: 4096,
    }));
  });

  it('projects A2UI interrupts without exposing unknown fields or raw tool input', () => {
    const onInterrupt = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onInterrupt });

    parser.push(nestedEvent({
      type: 'interrupt',
      properties: {
        id: 'int_request1',
        sessionID: 'ses_session1',
        type: 'a2ui',
        payload: {
          title: '选择偏好',
          fields: [
            { type: 'text', label: '补充说明', default: '默认内容', private: 'must-not-reach-ui' },
            { type: 'single-select', label: '选择风格', default: '科技', options: [{ label: '科技' }, { label: '卡通' }] },
            { type: 'multi-select', label: '选择平台', default: ['Windows'], options: [{ label: 'Windows' }, { label: 'Linux' }] },
            { type: 'password', label: '未知字段', default: 'secret' },
          ],
        },
        tool: { messageID: 'msg_1', callID: 'call_1', input: 'must-not-reach-ui' },
      },
    }));

    expect(onInterrupt).toHaveBeenCalledWith({
      id: 'int_request1',
      sessionId: 'ses_session1',
      title: '选择偏好',
      fields: [
        { type: 'text', label: '补充说明', defaultValue: '默认内容' },
        { type: 'single-select', label: '选择风格', defaultValue: '科技', options: ['科技', '卡通'] },
        { type: 'multi-select', label: '选择平台', defaultValue: ['Windows'], options: ['Windows', 'Linux'] },
      ],
      toolMessageId: 'msg_1',
      toolCallId: 'call_1',
    });
    expect(JSON.stringify(onInterrupt.mock.calls)).not.toContain('must-not-reach-ui');
    expect(JSON.stringify(onInterrupt.mock.calls)).not.toContain('未知字段');
  });

  it('ignores retired cognition candidate interrupts', () => {
    const onInterrupt = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onInterrupt });
    const candidate = {
      type: 'judgment-principle',
      title: '先验证关键约束',
      currentUnderstanding: '先验证会决定可行性的约束。',
      changedFrom: '过去会先构建完整流程。',
      rationale: '避免在错误基础上扩建。',
      boundary: '只适用于关键约束。',
      unresolved: '不同环境仍需验证。',
      question: '它在什么情况下不适用？',
    };
    parser.push(nestedEvent({
      type: 'interrupt',
      properties: {
        id: 'int_cognition1', sessionID: 'ses_session1', type: 'a2ui',
        payload: {
          title: '可能形成了新的理解',
          purpose: 'cognition-candidate',
          purposeVersion: 1,
          cognition: candidate,
          fields: [{ type: 'text', label: '适用边界', default: '只适用于关键约束。' }],
        },
      },
    }));
    expect(onInterrupt).not.toHaveBeenCalled();

    onInterrupt.mockClear();
    parser.push(nestedEvent({
      type: 'interrupt',
      properties: {
        id: 'int_cognition2', sessionID: 'ses_session1', type: 'a2ui',
        payload: {
          title: '普通问题', purpose: 'cognition-candidate', purposeVersion: 2,
          cognition: candidate,
          fields: [{ type: 'text', label: '补充说明', default: '' }],
        },
      },
    }));
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('emits replied and rejected interrupt resolutions with safe answer values', () => {
    const onInterruptResolution = vi.fn();
    const parser = new WorkosSseParser({ onText: vi.fn(), onInterruptResolution });

    parser.push(nestedEvent({
      type: 'interrupt.replied',
      properties: {
        sessionID: 'ses_session1',
        requestID: 'int_request1',
        data: { 风格: '科技', 平台: ['Windows'], unsupported: { token: 'secret' } },
      },
    }));
    parser.push(nestedEvent({
      type: 'interrupt.rejected',
      properties: { sessionID: 'ses_session1', requestID: 'int_request2' },
    }));

    expect(onInterruptResolution).toHaveBeenNthCalledWith(1, {
      requestId: 'int_request1',
      sessionId: 'ses_session1',
      outcome: 'replied',
      data: { 风格: '科技', 平台: ['Windows'] },
    });
    expect(onInterruptResolution).toHaveBeenNthCalledWith(2, {
      requestId: 'int_request2',
      sessionId: 'ses_session1',
      outcome: 'rejected',
    });
    expect(JSON.stringify(onInterruptResolution.mock.calls)).not.toContain('secret');
  });
});
