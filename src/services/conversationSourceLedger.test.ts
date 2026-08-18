import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '../shared/extensionMessages';
import type { Conversation, PageContext } from '../sidepanel/types';
import { buildAgentContent, preparePageReference, WORKOS_AGENT_CAPABILITIES } from './buildAgentContent';
import { findConversationSourceDelivery, markPageDelivered } from './conversationSourceLedger';
import { decideCurrentPageDelivery } from './contextDeliveryPolicy';

const snapshot: PageSnapshot = {
  pageId: 'page-workos',
  title: '影刀 AI WorkOS',
  site: 'yingdao.com',
  url: 'https://www.yingdao.com/workos',
  status: 'read',
  sourceId: 'source-workos',
  contentHash: 'revision-1',
  extractedAt: 10,
  markdown: '# WorkOS\n\n完整正文',
  manifest: {
    description: 'WorkOS 帮助文档',
    outline: [{ level: 2, text: '产品使命' }],
    relevant_links: [],
    truncated: false,
  },
  pageType: 'documentation',
  accessHint: 'public_web',
  quality: 'high',
  truncated: false,
};

const page: PageContext = {
  title: snapshot.title,
  site: snapshot.site,
  url: snapshot.url,
  status: 'read',
  sourceId: snapshot.sourceId,
  contentHash: snapshot.contentHash,
  manifest: snapshot.manifest,
};

function conversation(pages: PageContext[]): Conversation {
  return {
    id: 'conversation-local',
    remoteUuid: 'conversation-remote-1',
    remoteTransport: 'internal-v2',
    remoteAgentUuid: 'agent-1',
    title: 'WorkOS 培训',
    subtitle: '1 个页面',
    updatedAt: 1,
    page: pages[0] ?? page,
    pages,
    messages: [],
    draftInput: '',
    draftContextItems: [],
  };
}

describe('conversation source ledger', () => {
  it('turns a repeated page into a compact reuse reference', () => {
    const prepared = preparePageReference(snapshot);
    const current = conversation([
      page,
      markPageDelivered(page, 'conversation-remote-1', 100),
    ]);
    const previous = findConversationSourceDelivery(current, prepared, 'conversation-remote-1');
    const decision = decideCurrentPageDelivery({
      included: true,
      prepared,
      previous,
      agent: WORKOS_AGENT_CAPABILITIES,
    });
    const content = buildAgentContent({ question: '把时间压缩到 30 分钟', quotes: [], page: { prepared, decision } });

    expect(decision).toEqual({ mode: 'reuse', reason: 'same_revision_in_conversation' });
    expect(content).toContain('复用本会话中已经建立的页面上下文');
    expect(content).not.toContain('页面清单（外部资料）');
    expect(content).not.toContain('WorkOS 帮助文档');
  });

  it('does not reuse a delivery from another remote conversation', () => {
    const prepared = preparePageReference(snapshot);
    const current = conversation([markPageDelivered(page, 'conversation-remote-old', 100)]);

    expect(findConversationSourceDelivery(current, prepared, 'conversation-remote-new')).toBeUndefined();
  });

  it('accepts legacy deliveries without a remote scope in the unchanged conversation', () => {
    const prepared = preparePageReference(snapshot);
    const current = conversation([{ ...page, sentAt: 100 }]);

    expect(findConversationSourceDelivery(current, prepared, 'conversation-remote-1'))
      .toEqual({
        source_id: 'source-workos',
        revision_id: 'revision-1',
        delivered_at: new Date(100).toISOString(),
      });
  });

  it('normalizes a legacy source id when the URL still identifies the same page', () => {
    const prepared = preparePageReference(snapshot);
    const current = conversation([{ ...page, sourceId: 'legacy-source-id', sentAt: 100 }]);

    expect(findConversationSourceDelivery(current, prepared, 'conversation-remote-1')?.source_id)
      .toBe('source-workos');
  });

  it('reuses one document across different heading anchors', () => {
    const prepared = preparePageReference({ ...snapshot, url: `${snapshot.url}#tools`, sourceId: 'source-current' });
    const current = conversation([{
      ...page,
      url: `${snapshot.url}#observation-space`,
      sourceId: 'source-legacy-anchor',
      sentAt: 100,
    }]);
    const previous = findConversationSourceDelivery(current, prepared, 'conversation-remote-1');
    const decision = decideCurrentPageDelivery({
      included: true,
      prepared,
      previous,
      agent: WORKOS_AGENT_CAPABILITIES,
    });

    expect(decision).toEqual({ mode: 'reuse', reason: 'same_revision_in_conversation' });
  });

  it('recovers a successful delivery from a message snapshot when the page index is stale', () => {
    const prepared = preparePageReference(snapshot);
    const delivered = markPageDelivered(page, 'conversation-remote-1', 200);
    const current = conversation([page]);
    current.messages.push({
      id: 'message-1',
      role: 'user',
      content: '总结网页',
      createdAt: 1,
      status: 'complete',
      contextItems: [{
        id: 'context-page-1',
        kind: 'page',
        included: true,
        status: 'ready',
        createdAt: 1,
        page: delivered,
        role: 'current',
        delivery: 'introduce',
      }],
    });

    expect(findConversationSourceDelivery(current, prepared, 'conversation-remote-1')?.delivered_at)
      .toBe(new Date(200).toISOString());
  });
});
