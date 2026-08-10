import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '../shared/extensionMessages';
import { buildAgentContent, preparePageReference } from './buildAgentContent';

const page: PageSnapshot = {
  pageId: 'page-1',
  sourceId: 'src-1',
  title: '源码精读笔记',
  site: 'example.com',
  url: 'https://example.com/book',
  status: 'read',
  markdown: '# 正文\n\n完整内容',
  contentHash: 'rev-1',
  extractedAt: Date.UTC(2026, 0, 1),
  quality: 'high',
  truncated: false,
  pageType: 'documentation',
  accessHint: 'public_web',
  manifest: {
    description: '一本源码精读笔记。',
    outline: [{ level: 1, text: '源码精读笔记' }],
    relevant_links: [],
    truncated: false,
  },
};

describe('buildAgentContent', () => {
  it('renders a manifest instead of the complete page for a public source', () => {
    const content = buildAgentContent({
      question: '总结这一页',
      quotes: [],
      page: {
        prepared: preparePageReference(page),
        decision: { mode: 'manifest', delivery: 'introduce', reason: 'new_source' },
      },
      requestId: 'req-1',
      createdAt: '2026-08-10T00:00:00.000Z',
    });

    expect(content).toContain('# 用户问题\n\n总结这一页');
    expect(content).toContain('- 网址：https://example.com/book');
    expect(content).toContain('一本源码精读笔记。');
    expect(content).not.toContain('完整内容');
  });

  it('keeps independent quotes with readable source metadata', () => {
    const content = buildAgentContent({
      question: '这两段有什么关系？',
      quotes: [
        { id: 'quote-1', text: '第一段引用', pageTitle: '页面 A', pageUrl: 'https://example.com/a', createdAt: 1 },
        { id: 'quote-2', text: '第二段引用', pageTitle: '页面 B', pageUrl: 'https://example.com/b', createdAt: 2 },
      ],
      requestId: 'req-2',
      createdAt: '2026-08-10T00:00:00.000Z',
    });

    expect(content).toContain('标题：页面 A');
    expect(content).toContain('> 第一段引用');
    expect(content).toContain('网址：https://example.com/b');
    expect(content).toContain('> 第二段引用');
  });

  it('reuses a page without repeating its manifest or markdown', () => {
    const content = buildAgentContent({
      question: '继续',
      quotes: [],
      page: {
        prepared: preparePageReference(page),
        decision: { mode: 'reuse', reason: 'same_revision_in_conversation' },
      },
      requestId: 'req-3',
      createdAt: '2026-08-10T00:00:00.000Z',
    });

    expect(content).toContain('沿用本会话中已提供的相同内容版本');
    expect(content).not.toContain('一本源码精读笔记。');
    expect(content).not.toContain('完整内容');
  });

  it('bounds a browser-only snapshot before rendering', () => {
    const browserOnly = {
      ...page,
      accessHint: 'browser_only' as const,
      markdown: '内'.repeat(20_000),
    };
    const prepared = preparePageReference(browserOnly);
    const content = buildAgentContent({
      question: '分析内部页面',
      quotes: [],
      page: {
        prepared,
        decision: { mode: 'snapshot', delivery: 'introduce', reason: 'agent_requires_snapshot' },
      },
      requestId: 'req-4',
      createdAt: '2026-08-10T00:00:00.000Z',
    });

    expect(prepared.snapshot?.content).toHaveLength(12_000);
    expect(content).toContain('页面快照已截断');
  });
});
