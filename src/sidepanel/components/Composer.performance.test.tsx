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
