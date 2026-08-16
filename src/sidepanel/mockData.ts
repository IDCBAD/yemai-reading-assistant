import type { Conversation, PageContext, QuoteReference, WorkspaceState } from './types';
import { legacyDraftContextItems } from './contextItems';

export const CURRENT_PAGE: PageContext = {
  title: '引言',
  site: 'AI Agent 实践指南',
  url: 'https://bojieli.github.io/ai-agent-book/book/introduction/',
  status: 'not-read',
};

export const QUOTE_EXAMPLES: Omit<QuoteReference, 'id' | 'createdAt'>[] = [
  {
    text: 'Agent = LLM + 上下文 + 工具。三者缺一不可。',
    pageTitle: '引言',
    pageUrl: CURRENT_PAGE.url,
  },
  {
    text: '好的设计原则本就应该穿越模型的迭代周期，因为它们描述的是智能系统与世界交互的基本模式。',
    pageTitle: '引言',
    pageUrl: CURRENT_PAGE.url,
  },
  {
    text: '没有评估，就没有进步。评估让你能分辨一次改动究竟是真的变好了，还是只是运气。',
    pageTitle: '引言',
    pageUrl: CURRENT_PAGE.url,
  },
];

const INITIAL_CONVERSATION: Conversation = {
  id: 'conversation-draft',
  title: '新的阅读对话',
  subtitle: '1 个页面 · 尚未发送',
  updatedAt: Date.now(),
  isDraft: true,
  page: CURRENT_PAGE,
  pages: [CURRENT_PAGE],
  messages: [],
  draftInput: '',
  draftContextItems: legacyDraftContextItems(CURRENT_PAGE, undefined),
};

export const INITIAL_WORKSPACE: WorkspaceState = {
  conversations: [INITIAL_CONVERSATION],
  openTabs: [{ id: 'open-tab-draft-1', conversationId: INITIAL_CONVERSATION.id, openedAt: Date.now() }],
  activeOpenTabId: 'open-tab-draft-1',
};
