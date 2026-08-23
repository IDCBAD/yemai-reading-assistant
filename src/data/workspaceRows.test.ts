import { describe, expect, it } from 'vitest';
import type { Conversation, PageContext, WorkspaceState } from '../sidepanel/types';
import { attachmentContextItem, pageContextItem } from '../sidepanel/contextItems';
import { rowsToWorkspace, workspaceToRows } from './workspaceRows';

const page: PageContext = {
  title: 'IndexedDB 文章',
  site: 'example.com',
  url: 'https://example.com/article',
  status: 'read',
  sourceId: 'source-1',
  contentHash: 'revision-1',
};

function createWorkspace(): WorkspaceState {
  const conversation: Conversation = {
    id: 'conversation-1',
    title: '数据层测试',
    subtitle: '1 个页面',
    updatedAt: 20,
    page,
    pages: [page],
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: '正在生成的回答',
      createdAt: 21,
      status: 'streaming',
      stage: 'streaming',
      artifacts: [{
        id: 'artifact-1',
        kind: 'image',
        filename: '结果.png',
        url: 'https://example.com/result.png',
        status: 'available',
      }],
    }],
    draftInput: '草稿',
    draftContextItems: [
      pageContextItem(page),
      attachmentContextItem({
        id: 'attachment-1',
        filename: '输入.png',
        sizeLabel: '12 KB',
        status: 'ready',
        previewUrl: 'blob:must-not-persist',
      }),
    ],
  };
  return {
    conversations: [conversation],
    openTabs: [{ id: 'open-1', conversationId: conversation.id, openedAt: 30 }],
    activeOpenTabId: 'open-1',
  };
}

describe('normalized workspace rows', () => {
  it('splits messages, sources and artifacts without persisting transient previews', () => {
    const rows = workspaceToRows(createWorkspace(), 100);

    expect(rows.conversations).toHaveLength(1);
    expect(rows.messages).toHaveLength(1);
    expect(rows.sources).toHaveLength(1);
    expect(rows.artifacts).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('blob:must-not-persist');
    expect(rows.messages[0]).not.toHaveProperty('artifacts');
    expect(rows.artifacts[0]).toMatchObject({
      key: 'message-1:artifact-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      filename: '结果.png',
    });
  });

  it('reconstructs the workspace and applies interrupted-run recovery', () => {
    const rows = workspaceToRows(createWorkspace(), 100);
    const restored = rowsToWorkspace({
      conversations: rows.conversations,
      messages: rows.messages,
      sources: rows.sources,
      artifacts: rows.artifacts,
    }, rows.ui, 200);

    expect(restored?.activeOpenTabId).toBe('open-1');
    expect(restored?.conversations[0]?.pages[0]?.contentHash).toBe('revision-1');
    expect(restored?.conversations[0]?.messages[0]).toMatchObject({
      id: 'message-1',
      status: 'stopped',
      artifacts: [{ id: 'artifact-1', filename: '结果.png' }],
    });
  });
});
