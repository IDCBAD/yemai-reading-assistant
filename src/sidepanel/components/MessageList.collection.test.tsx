import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { MessageList } from './MessageList';

const noop = () => undefined;

function renderAnswer(message: ChatMessage) {
  return renderToStaticMarkup(<MessageList
    messages={[message]}
    savedMessageIds={new Set()}
    onUseStarter={noop}
    onEditUserMessage={noop}
    onRetry={noop}
    onBranch={noop}
    onToggleReadingCard={noop}
    onCollectAssistantExcerpt={noop}
    onOpenBranchOrigin={noop}
    onAddAssistantQuote={noop}
    onResolveDecision={noop}
  />);
}

describe('collection response status', () => {
  it('shows an unsent collection draft instead of a current-page starter', () => {
    const html = renderToStaticMarkup(<MessageList
      messages={[]}
      pendingCollectionCount={2}
      savedMessageIds={new Set()}
      onUseStarter={noop}
      onEditUserMessage={noop}
      onRetry={noop}
      onBranch={noop}
      onToggleReadingCard={noop}
      onCollectAssistantExcerpt={noop}
      onOpenBranchOrigin={noop}
      onAddAssistantQuote={noop}
      onResolveDecision={noop}
    />);
    expect(html).toContain('已带入 2 条收藏问答');
    expect(html).toContain('现在尚未发送给 WorkOS');
    expect(html).not.toContain('从当前页面开始');
  });

  it('does not call a send uncertain after WorkOS has returned answer text', () => {
    const html = renderAnswer({
      id: 'answer-1', role: 'assistant', content: 'WorkOS 已返回的回答',
      createdAt: 1, status: 'failed', collectionSend: true,
    });
    expect(html).toContain('WorkOS 已返回的回答');
    expect(html).not.toContain('无法确认这次提问是否提交成功');
    expect(html).toContain('内容可能不完整');
    expect(html).toContain('收藏完整回答');
    expect(html).not.toContain('重新发送');
  });

  it('keeps the send uncertain when no answer or artifact was received', () => {
    const html = renderAnswer({
      id: 'answer-2', role: 'assistant', content: '',
      createdAt: 1, status: 'failed', collectionSend: true,
    });
    expect(html).toContain('无法确认这次提问是否提交成功');
  });
});
