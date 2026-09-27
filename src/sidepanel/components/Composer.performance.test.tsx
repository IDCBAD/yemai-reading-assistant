import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INITIAL_WORKSPACE } from '../mockData';
import { Composer } from './Composer';

describe('Composer tab switching feedback', () => {
  it('marks the requested tab as pending before its conversation content commits', () => {
    const firstConversation = INITIAL_WORKSPACE.conversations[0]!;
    const secondConversation = { ...firstConversation, id: 'conversation-two', title: '第二个会话' };
    const secondTab = { id: 'open-tab-two', conversationId: secondConversation.id, openedAt: Date.now() };
    const html = renderToStaticMarkup(
      <Composer
        tabs={[...INITIAL_WORKSPACE.openTabs, secondTab]}
        conversations={[firstConversation, secondConversation]}
        activeTabId={INITIAL_WORKSPACE.activeOpenTabId}
        pendingTabId={secondTab.id}
        input=""
        focusRequestId={0}
        contextItems={[]}
        activeConversationIds={new Set()}
        runSummary={null}
        historyOpen={false}
        connectionState="configured"
        fileUploadEnabled={false}
        fileAccept=""
        maxTabs={10}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onNewConversation={() => undefined}
        onToggleHistory={() => undefined}
        onInputChange={() => undefined}
        onContextIncludedChange={() => undefined}
        onRemoveContextItem={() => undefined}
        onRetryAttachment={() => undefined}
        onFilesSelected={() => undefined}
        onAttachmentUnavailable={() => undefined}
        smartSelectionActive={false}
        onStartSmartSelection={() => undefined}
        onSend={() => false}
        onStop={() => undefined}
      />,
    );

    expect(html).toContain('class="workspace-tab pressable is-pending"');
    expect(html).toContain('aria-busy="true"');
  });
});


describe('Composer running actions', () => {
  it.each([
    ['', true, false],
    ['下一问', true, true],
    ['', false, true],
  ])('shows the relevant actions for input=%s running=%s', (input, running, sendVisible) => {
    const summary = running ? { activeMessageId: 'answer', status: 'streaming' as const, stage: 'streaming' as const, label: '正在组织回答', orbState: 'shaping' as const, queuedCount: 1 } : null;
    const html = renderToStaticMarkup(<Composer
        tabs={INITIAL_WORKSPACE.openTabs}
        conversations={[INITIAL_WORKSPACE.conversations[0]!]}
        activeTabId={INITIAL_WORKSPACE.activeOpenTabId}
        input={input}
        focusRequestId={0}
        contextItems={[]}
        activeConversationIds={new Set()}
        runSummary={summary}
        historyOpen={false}
        connectionState="configured"
        fileUploadEnabled={false}
        fileAccept=""
        maxTabs={10}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onNewConversation={() => undefined}
        onToggleHistory={() => undefined}
        onInputChange={() => undefined}
        onContextIncludedChange={() => undefined}
        onRemoveContextItem={() => undefined}
        onRetryAttachment={() => undefined}
        onFilesSelected={() => undefined}
        onAttachmentUnavailable={() => undefined}
        smartSelectionActive={false}
        onStartSmartSelection={() => undefined}
        onSend={() => false}
        onStop={() => undefined}
      />,);
    expect(html.includes('aria-label="停止当前任务"')).toBe(running);
    expect(html.includes('class="send-button')).toBe(sendVisible);
    expect(html).not.toContain('正在组织回答');
    if (running) expect(html).toContain('1 条排队');
    if (running && input) expect(html).toContain('aria-label="加入队列"');
  });
});
