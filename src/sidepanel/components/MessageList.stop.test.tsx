import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { MessageList } from './MessageList';

const noop = () => undefined;
function renderMessage(message: ChatMessage) {
  return renderToStaticMarkup(<MessageList
    messages={[message]}
    savedMessageIds={new Set()}
    onUseStarter={noop} onEditUserMessage={noop} onRetry={noop} onBranch={noop}
    onToggleReadingCard={noop} onCollectAssistantExcerpt={noop} onOpenBranchOrigin={noop}
    onAddAssistantQuote={noop} onResolveDecision={noop}
  />);
}
function renderStop(stopStatus: ChatMessage['stopStatus'], errorMessage?: string) {
  return renderMessage({ id: 'answer', role: 'assistant', content: '已经收到的回答', createdAt: 1,
    status: 'stopped', stopStatus, errorMessage });
}

describe('WorkOS pause feedback', () => {
  it('shows the pending pause even when partial answer text is already present', () => {
    const html = renderStop('pending');
    expect(html).toContain('正在请求 WorkOS 暂停');
    expect(html).toContain('已经收到的回答');
    expect(html).not.toContain('已接受暂停请求');
  });
  it('describes API acceptance without claiming all remote tools have stopped', () => {
    const html = renderStop('accepted');
    expect(html).toContain('WorkOS 已接受暂停请求');
    expect(html).not.toContain('WorkOS 已停止');
  });
  it('shows unconfirmed remote stops as visible alerts without losing partial text', () => {
    const html = renderStop('failed', '已停止接收，无法确认 WorkOS 是否暂停。');
    expect(html).toContain('role="alert"');
    expect(html).toContain('无法确认 WorkOS 是否暂停');
    expect(html).toContain('已经收到的回答');
  });
});

describe('lost WorkOS progress connection', () => {
  it('keeps partial output and marks unfinished tools as unconfirmed without claiming failure or stop', () => {
    const html = renderMessage({ id: 'answer', role: 'assistant', content: '已经收到的回答', createdAt: 1,
      status: 'stopped', runStartedAt: 1_000, runFinishedAt: 204_000,
      remoteRunUnconfirmed: { conversationUuid: 'remote', runId: 'run', transport: 'internal-v2',
        agentUuid: 'agent', apiBase: 'api', disconnectedAt: 204_000 },
      activities: [
        { id: 'child', kind: 'subagent', title: '长任务', status: 'stopped', progressUnconfirmed: true, startedAt: 5_000 },
        { id: 'tool', kind: 'tool', title: 'bash', status: 'stopped', progressUnconfirmed: true, startedAt: 6_000 },
        { id: 'complete', kind: 'tool', title: 'webfetch', status: 'completed', startedAt: 1_000, completedAt: 2_500 },
      ] });
    expect(html).toContain('已经收到的回答');
    expect(html).toContain('WorkOS 任务状态未确认');
    expect(html).toContain('状态未确认');
    expect(html).toContain('已接收进度');
    expect(html).toContain('1.5 秒');
    expect(html).not.toContain('已停止');
    expect(html).not.toContain('运行失败');
    expect(html).not.toContain('个失败');
    expect(html).not.toContain('stop-generating-square');
    expect(html).not.toContain('重新发送');
    expect(html).not.toContain('本轮已运行');
  });
});
