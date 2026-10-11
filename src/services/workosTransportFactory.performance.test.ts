import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkosConnectionSettings } from './workosConnection';
import { createWorkosTransport } from './workosTransportFactory';

const internalTransport = vi.hoisted(() => ({
  construct: vi.fn(),
  createConversation: vi.fn(async () => 'conversation-id'),
  abortConversation: vi.fn(async (_conversationUuid: string, _signal?: AbortSignal) => undefined),
}));

vi.mock('./workosInternalV2', () => ({
  InternalV2Transport: class {
    readonly kind = 'internal-v2' as const;

    constructor(...args: unknown[]) {
      internalTransport.construct(...args);
    }

    createConversation = internalTransport.createConversation;
    abortConversation = internalTransport.abortConversation;
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
    internalTransport.abortConversation.mockClear();
  });

  it('loads the internal-v2 implementation only when its first request starts', async () => {
    const transport = createWorkosTransport(settings);

    expect(transport.kind).toBe('internal-v2');
    expect(internalTransport.construct).not.toHaveBeenCalled();

    await transport.createConversation();

    expect(internalTransport.construct).toHaveBeenCalledOnce();
    expect(internalTransport.createConversation).toHaveBeenCalledOnce();
  });

  it('forwards pause requests through the lazy transport without creating another conversation', async () => {
    const transport = createWorkosTransport(settings);
    const controller = new AbortController();
    await transport.abortConversation?.('current-conversation', controller.signal);
    expect(internalTransport.abortConversation).toHaveBeenCalledExactlyOnceWith('current-conversation', controller.signal);
    expect(internalTransport.createConversation).not.toHaveBeenCalled();
  });
});
