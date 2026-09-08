import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkosConnectionSettings } from './workosConnection';
import { createWorkosTransport } from './workosTransportFactory';

const internalTransport = vi.hoisted(() => ({
  construct: vi.fn(),
  createConversation: vi.fn(async () => 'conversation-id'),
}));

vi.mock('./workosInternalV2', () => ({
  InternalV2Transport: class {
    readonly kind = 'internal-v2' as const;

    constructor(...args: unknown[]) {
      internalTransport.construct(...args);
    }

    createConversation = internalTransport.createConversation;
  },
}));

const settings: WorkosConnectionSettings = {
  schemaVersion: 2,
  agentUuid: '00000000-0000-4000-8000-000000000001',
  transport: 'internal-v2',
  publicApiToken: '',
  internalV2: {
    accessToken: 'access-token',
    userUuid: 'user-id',
    organizationUuid: 'organization-id',
  },
};

describe('workos transport loading', () => {
  beforeEach(() => {
    internalTransport.construct.mockClear();
    internalTransport.createConversation.mockClear();
  });

  it('loads the internal-v2 implementation only when its first request starts', async () => {
    const transport = createWorkosTransport(settings);

    expect(transport.kind).toBe('internal-v2');
    expect(internalTransport.construct).not.toHaveBeenCalled();

    await transport.createConversation();

    expect(internalTransport.construct).toHaveBeenCalledOnce();
    expect(internalTransport.createConversation).toHaveBeenCalledOnce();
  });
});
