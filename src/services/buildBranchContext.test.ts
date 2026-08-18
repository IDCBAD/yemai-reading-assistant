import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../sidepanel/types';
import { pageContextItem, selectionContextItem } from '../sidepanel/contextItems';
import {
  buildBranchContext,
  buildTransportHandoffContext,
  prependBranchContext,
  TRANSPORT_HANDOFF_MAX_CHARS,
  TRANSPORT_HANDOFF_MAX_TURNS,
} from './buildBranchContext';

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
        pageContext: {
          title: '文章',
          site: 'example.com',
          url: 'https://example.com',
          status: 'read',
          sourceId: 'src-article',
          contentHash: 'rev-1',
          manifest: {
            description: '文章概览',
            outline: [],
            relevant_links: [],
            truncated: false,
          },
        },
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
    expect(context).toContain('src-article');
    expect(context).toContain('https://example.com');
    expect(context).toContain('文章概览');
    expect(context).not.toContain('私密工具');
    expect(context).not.toContain('debug detail');
  });

  it('prepends the branch once before the new user content', () => {
    expect(prependBranchContext('OLD_CONTEXT', 'NEW_QUESTION')).toBe('OLD_CONTEXT\n\nNEW_QUESTION');
    expect(prependBranchContext(undefined, 'NEW_QUESTION')).toBe('NEW_QUESTION');
  });
});

describe('buildTransportHandoffContext', () => {
  it('marks a channel switch without pretending it is a user-created branch', () => {
    const context = buildTransportHandoffContext([{
      id: 'message-1',
      role: 'user',
      content: '延续这个问题',
      createdAt: 1,
      status: 'complete',
    }]);

    expect(context).toContain('<conversation_transport_handoff_context');
    expect(context).toContain('切换了远程 Agent 或传输通道');
    expect(context).not.toContain('<conversation_branch_context');
  });

  it('replays page and selection provenance from unified context snapshots', () => {
    const context = buildBranchContext([{
      id: 'user-context-items',
      role: 'user',
      content: '继续解释',
      createdAt: 1,
      status: 'complete',
      contextItems: [
        pageContextItem({
          title: '上下文工程',
          site: 'example.com',
          url: 'https://example.com/context',
          status: 'read',
          sourceId: 'src-context',
        }),
        selectionContextItem({
          id: 'selection-1',
          text: '窗口有限，对话持续增长。',
          pageTitle: '上下文工程',
          pageUrl: 'https://example.com/context',
          createdAt: 1,
        }),
      ],
    }]);

    expect(context).toContain('src-context');
    expect(context).toContain('窗口有限，对话持续增长。');
  });

  it('bounds handoff history and keeps only the newest active page identity', () => {
    const messages: ChatMessage[] = Array.from({ length: 10 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `第 ${index} 条 ${'内容'.repeat(900)}`,
      createdAt: index,
      status: 'complete' as const,
      contextItems: index === 8 || index === 9
        ? [pageContextItem({
            title: index === 9 ? '当前页面' : '旧页面',
            site: 'example.com',
            url: index === 9 ? 'https://example.com/current' : 'https://example.com/old',
            status: 'read',
            sourceId: index === 9 ? 'src-current' : 'src-old',
            manifest: {
              description: '不应在交接中重复发送的页面清单',
              outline: [],
              relevant_links: [],
              truncated: false,
            },
          })]
        : [],
    }));

    const context = buildTransportHandoffContext(messages);
    const payload = JSON.parse(context.split('\n')[1]!) as {
      turns: Array<{ role: ChatMessage['role']; content: string; pageSourceId?: string }>;
      sources: Array<{ sourceId: string; manifest?: unknown }>;
      truncated?: boolean;
      omitted_turns?: number;
    };

    expect(context.length).toBeLessThanOrEqual(TRANSPORT_HANDOFF_MAX_CHARS);
    expect(payload.turns.length).toBeLessThanOrEqual(TRANSPORT_HANDOFF_MAX_TURNS);
    expect(payload.turns.at(-1)?.content).toContain('第 9 条');
    expect(payload.sources).toEqual([expect.objectContaining({ sourceId: 'src-current' })]);
    expect(payload.sources[0]?.manifest).toBeUndefined();
    expect(payload.truncated).toBe(true);
    expect(payload.omitted_turns).toBeGreaterThan(0);
    expect(context).not.toContain('不应在交接中重复发送的页面清单');
  });
});
