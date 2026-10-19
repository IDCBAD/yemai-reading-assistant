import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { MessageList } from './MessageList';

const noop = () => undefined;

describe('historical files in a later answer', () => {
  it('keeps the original file visible and puts a confirmed old replay in a closed, recoverable group', () => {
    const file = { id: 'old-file', kind: 'html' as const, filename: '此前解释.html', url: 'https://example.com/old.html', status: 'available' as const };
    const activity = { id: 'old-call', kind: 'tool' as const, title: '生成文件', status: 'completed' as const, completedAt: 10 };
    const messages: ChatMessage[] = [
      { id: 'old', role: 'assistant', content: '原始回答', createdAt: 1, status: 'complete', artifacts: [file], activities: [activity] },
      { id: 'new', role: 'assistant', content: '当前回答', createdAt: 20, runStartedAt: 20, status: 'complete', artifacts: [file], activities: [activity] },
    ];
    const html = renderToStaticMarkup(<MessageList messages={messages} savedMessageIds={new Set()}
      onUseStarter={noop} onEditUserMessage={noop} onRetry={noop} onBranch={noop} onToggleReadingCard={noop}
      onCollectAssistantExcerpt={noop} onOpenBranchOrigin={noop} onAddAssistantQuote={noop} onResolveDecision={noop} />);
    expect(html).toContain('<details class="assistant-artifact-history"><summary>此前交付的文件（1）</summary>');
    expect(html.match(/aria-label="预览 此前解释.html"/g)).toHaveLength(2);
    expect(html.indexOf('预览 此前解释.html')).toBeLessThan(html.indexOf('assistant-artifact-history'));
    expect(messages[1]?.artifacts).toEqual([file]);
  });
});
