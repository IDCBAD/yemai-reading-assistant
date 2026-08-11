import { describe, expect, it } from 'vitest';
import type { AgentCapabilityProfile, ReferenceSource } from '../shared/yemaiContext';
import { decideCurrentPageDelivery, type PreparedPageReference } from './contextDeliveryPolicy';

const agent: AgentCapabilityProfile = {
  profile_id: 'workos-test',
  memory_scope: 'conversation',
  web_read: 'public_url',
  context_input: 'markdown_text',
  snapshot_request: 'unsupported',
};

const source: ReferenceSource = {
  source_id: 'src-1',
  kind: 'current_page',
  title: 'Article',
  url: 'https://example.com/article',
  page_type: 'article',
  access_hint: 'public_web',
  revision_id: 'rev-1',
  captured_at: '2026-08-10T00:00:00.000Z',
};

const prepared: PreparedPageReference = {
  source,
  manifest: { outline: [], relevant_links: [], truncated: false },
  snapshot: {
    format: 'markdown',
    content: '# Article',
    scope: 'main_content',
    truncated: false,
  },
};

describe('context delivery policy', () => {
  it('does not send an excluded page', () => {
    expect(decideCurrentPageDelivery({ included: false, prepared, agent })).toEqual({
      mode: 'none',
      reason: 'excluded',
    });
  });

  it('introduces a new public source as a manifest', () => {
    expect(decideCurrentPageDelivery({ included: true, prepared, agent })).toMatchObject({
      mode: 'manifest',
      delivery: 'introduce',
      reason: 'new_source',
    });
  });

  it('reuses a revision already delivered in the same conversation', () => {
    expect(decideCurrentPageDelivery({
      included: true,
      prepared,
      agent,
      previous: { source_id: 'src-1', revision_id: 'rev-1', delivered_at: '2026-08-10T00:01:00.000Z' },
    })).toEqual({ mode: 'reuse', reason: 'same_revision_in_conversation' });
  });

  it('marks a changed revision as an update', () => {
    expect(decideCurrentPageDelivery({
      included: true,
      prepared: { ...prepared, source: { ...source, revision_id: 'rev-2' } },
      agent,
      previous: { source_id: 'src-1', revision_id: 'rev-1', delivered_at: '2026-08-10T00:01:00.000Z' },
    })).toMatchObject({
      mode: 'manifest',
      delivery: 'update',
      previous_revision_id: 'rev-1',
      reason: 'updated_source',
    });
  });

  it('uses a snapshot when the agent cannot read a browser-only source', () => {
    expect(decideCurrentPageDelivery({
      included: true,
      prepared: { ...prepared, source: { ...source, access_hint: 'browser_only' } },
      agent,
    })).toMatchObject({
      mode: 'snapshot',
      delivery: 'introduce',
      reason: 'agent_requires_snapshot',
    });
  });

  it('does not reuse context for a stateless agent', () => {
    expect(decideCurrentPageDelivery({
      included: true,
      prepared,
      agent: { ...agent, memory_scope: 'none' },
      previous: { source_id: 'src-1', revision_id: 'rev-1', delivered_at: '2026-08-10T00:01:00.000Z' },
    })).toMatchObject({
      mode: 'manifest',
      delivery: 'introduce',
    });
  });
});
