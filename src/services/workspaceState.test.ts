import { describe, expect, it } from 'vitest';
import type { Conversation, WorkspaceState } from '../sidepanel/types';
import { createWorkspaceSnapshot, normalizeWorkspaceSnapshot, WORKSPACE_STATE_VERSION } from './workspaceState';

const page = { title: '文章', site: 'example.com', url: 'https://example.com', status: 'read' as const };

function conversation(): Conversation {
  return {
    id: 'conversation-1',
    remoteUuid: 'remote-1',
    title: '持久化测试',
    subtitle: '1 个页面 · 刚刚',
    updatedAt: 10,
    page,
    pages: [page],
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '未完成回答',
      createdAt: 11,
      status: 'streaming',
      stage: 'streaming',
      activities: [{ id: 'tool-1', kind: 'tool', title: '搜索', status: 'running', startedAt: 12 }],
    }],
    draftInput: '尚未发送的草稿',
    draftQuotes: [],
    draftAttachments: [],
  };
}

function workspace(): WorkspaceState {
  return {
    conversations: [conversation()],
    openTabs: [{ id: 'open-1', conversationId: 'conversation-1', openedAt: 20 }],
    activeOpenTabId: 'open-1',
  };
}

describe('workspace state v2', () => {
  it('preserves conversations, remote UUIDs, drafts and open tabs', () => {
    const restored = normalizeWorkspaceSnapshot(createWorkspaceSnapshot(workspace(), 100), 200);

    expect(restored?.version).toBe(WORKSPACE_STATE_VERSION);
    expect(restored?.activeOpenTabId).toBe('open-1');
    expect(restored?.openTabs[0]?.conversationId).toBe('conversation-1');
    expect(restored?.conversations[0]?.remoteUuid).toBe('remote-1');
    expect(restored?.conversations[0]?.draftInput).toBe('尚未发送的草稿');
  });

  it('marks interrupted streams and tools as stopped after reload', () => {
    const restored = normalizeWorkspaceSnapshot(createWorkspaceSnapshot(workspace()), 500);
    const message = restored?.conversations[0]?.messages[0];

    expect(message).toMatchObject({ status: 'stopped', stage: undefined });
    expect(message?.activities?.[0]).toMatchObject({ status: 'stopped', completedAt: 500 });
  });

  it('deduplicates conversations opened in multiple tabs and repairs the active tab', () => {
    const duplicate = workspace();
    duplicate.openTabs.push({ id: 'open-2', conversationId: 'conversation-1', openedAt: 21 });
    duplicate.activeOpenTabId = 'missing';
    const restored = normalizeWorkspaceSnapshot(createWorkspaceSnapshot(duplicate));

    expect(restored?.openTabs).toHaveLength(1);
    expect(restored?.activeOpenTabId).toBe('open-1');
  });

  it('persists archived history metadata', () => {
    const stored = workspace();
    stored.conversations.push({ ...conversation(), id: 'conversation-archived', archivedAt: 88 });
    const restored = normalizeWorkspaceSnapshot(createWorkspaceSnapshot(stored));

    expect(restored?.conversations.find((item) => item.id === 'conversation-archived')?.archivedAt).toBe(88);
  });

  it('rejects malformed or unsupported snapshots', () => {
    expect(normalizeWorkspaceSnapshot(null)).toBeNull();
    expect(normalizeWorkspaceSnapshot({ version: 99, conversations: [] })).toBeNull();
  });
});

describe('v1 migration', () => {
  it('merges sent messages, keeps the active draft and preserves a non-active draft in history', () => {
    const legacy = {
      version: 1,
      savedAt: 100,
      activeConversationId: 'legacy-1',
      conversations: [{
        id: 'legacy-1',
        remoteUuid: 'remote-legacy',
        title: '学习 Agent',
        subtitle: '2 个页面 · 刚刚',
        updatedAt: 90,
        activeTabId: 'legacy-tab-2',
        tabs: [{
          id: 'legacy-tab-1',
          page,
          messages: [{ id: 'm2', role: 'assistant', content: '第二条', createdAt: 20, status: 'complete' }],
          draftInput: '另一个页面的草稿',
          draftQuotes: [],
          draftAttachments: [],
        }, {
          id: 'legacy-tab-2',
          page: { ...page, title: '第二页', url: 'https://example.com/2' },
          messages: [{ id: 'm1', role: 'user', content: '第一条', createdAt: 10, status: 'complete' }],
          draftInput: '当前草稿',
          draftQuotes: [],
          draftAttachments: [],
        }],
      }],
    };

    const restored = normalizeWorkspaceSnapshot(legacy);
    const main = restored?.conversations.find((item) => item.id === 'legacy-1');
    const migratedDraft = restored?.conversations.find((item) => item.id === 'legacy-1-draft-legacy-tab-1');

    expect(restored?.version).toBe(2);
    expect(restored?.openTabs).toEqual([{ id: 'open-legacy-1', conversationId: 'legacy-1', openedAt: 100 }]);
    expect(main?.remoteUuid).toBe('remote-legacy');
    expect(main?.draftInput).toBe('当前草稿');
    expect(main?.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(main?.messages[0]?.pageContext?.url).toBe('https://example.com/2');
    expect(main?.pages).toHaveLength(2);
    expect(migratedDraft?.draftInput).toBe('另一个页面的草稿');
    expect(migratedDraft?.remoteUuid).toBeUndefined();
  });

  it('cleans repeated branch suffixes and assigns structural ordinals', () => {
    const makeLegacy = (id: string, title: string, updatedAt: number) => ({
      id,
      title,
      subtitle: '刚刚',
      updatedAt,
      activeTabId: `${id}-tab`,
      tabs: [{
        id: `${id}-tab`, page, messages: [], draftInput: '', draftQuotes: [], draftAttachments: [],
      }],
    });
    const restored = normalizeWorkspaceSnapshot({
      version: 1,
      savedAt: 100,
      activeConversationId: 'root',
      conversations: [
        makeLegacy('branch-2', '你好 · 分支 · 分支', 30),
        makeLegacy('root', '你好', 10),
        makeLegacy('branch-1', '你好 · 分支', 20),
      ],
    });

    expect(restored?.conversations.map((item) => item.title)).toEqual(['你好', '你好', '你好']);
    expect(restored?.conversations.find((item) => item.id === 'branch-1')?.branch).toMatchObject({
      rootConversationId: 'root', parentConversationId: 'root', ordinal: 1,
    });
    expect(restored?.conversations.find((item) => item.id === 'branch-2')?.branch).toMatchObject({
      rootConversationId: 'root', parentConversationId: 'branch-1', ordinal: 2,
    });
  });

  it('does not turn unrelated conversations with the same title into branches', () => {
    const makeLegacy = (id: string, updatedAt: number) => ({
      id,
      title: '相同标题',
      subtitle: '刚刚',
      updatedAt,
      activeTabId: `${id}-tab`,
      tabs: [{ id: `${id}-tab`, page, messages: [], draftInput: '', draftQuotes: [], draftAttachments: [] }],
    });
    const restored = normalizeWorkspaceSnapshot({
      version: 1,
      savedAt: 100,
      activeConversationId: 'one',
      conversations: [makeLegacy('one', 10), makeLegacy('two', 20)],
    });

    expect(restored?.conversations.map((item) => item.branch)).toEqual([undefined, undefined]);
  });
});
