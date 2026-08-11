import { describe, expect, it } from 'vitest';
import { buildYemaiContext } from './buildYemaiContext';

describe('buildYemaiContext', () => {
  it('creates a deterministic envelope when identifiers are supplied', () => {
    expect(buildYemaiContext({
      query: '  解释这一页  ',
      requestId: 'req-1',
      createdAt: '2026-08-10T00:00:00.000Z',
      policy: { allow_url_fetch: false },
    })).toEqual({
      protocol: 'yemai.context.v1',
      request_id: 'req-1',
      created_at: '2026-08-10T00:00:00.000Z',
      query: { text: '解释这一页' },
      references: [],
      policy: {
        prefer_existing_context: true,
        allow_url_fetch: false,
        cite_sources: true,
        treat_page_as_untrusted: true,
      },
    });
  });
});
