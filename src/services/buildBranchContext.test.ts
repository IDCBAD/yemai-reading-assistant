import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../sidepanel/types';
import { buildBranchContext, prependBranchContext } from './buildBranchContext';

describe('buildBranchContext', () => {
  it('keeps visible Markdown and references but excludes run metadata', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '解释这段内容',
        createdAt: 1,
        status: 'complete',
        references: [{ id: 'quote-1', text: '引用正文', pageTitle: '文章', pageUrl: 'https://example.com', createdAt: 1 }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '## 回答\n\n- 第一项',
        createdAt: 2,
        status: 'complete',
        activities: [{ id: 'tool-1', kind: 'tool', title: '私密工具', status: 'completed' }],
        errorMessage: 'debug detail',
      },
    ];

    const context = buildBranchContext(messages);
    expect(context).toContain('## 回答\\n\\n- 第一项');
    expect(context).toContain('引用正文');
    expect(context).not.toContain('私密工具');
    expect(context).not.toContain('debug detail');
  });

  it('prepends the branch once before the new user content', () => {
    expect(prependBranchContext('OLD_CONTEXT', 'NEW_QUESTION')).toBe('OLD_CONTEXT\n\nNEW_QUESTION');
    expect(prependBranchContext(undefined, 'NEW_QUESTION')).toBe('NEW_QUESTION');
  });
});
