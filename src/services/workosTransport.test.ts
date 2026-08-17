import { describe, expect, it } from 'vitest';
import { hasWorkosRemoteTargetChanged } from './workosTransport';

const agentUuid = '11111111-1111-4111-8111-111111111111';

describe('WorkOS remote target identity', () => {
  it('requires a new conversation when legacy remote metadata has no Agent identity', () => {
    expect(hasWorkosRemoteTargetChanged(
      'remote-1',
      undefined,
      undefined,
      'public-v1',
      agentUuid,
    )).toBe(true);
  });

  it('requires a new remote conversation after changing the Agent UUID', () => {
    expect(hasWorkosRemoteTargetChanged(
      'remote-1',
      'internal-v2',
      agentUuid,
      'internal-v2',
      '22222222-2222-4222-8222-222222222222',
    )).toBe(true);
  });

  it('does not create a handoff before any remote conversation exists', () => {
    expect(hasWorkosRemoteTargetChanged(
      undefined,
      undefined,
      undefined,
      'internal-v2',
      '11111111-1111-4111-8111-111111111111',
    )).toBe(false);
  });
});
