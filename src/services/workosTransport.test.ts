import { describe, expect, it } from 'vitest';
import { hasWorkosRemoteTargetChanged, WORKOS_INTERNAL_V2_BASE_URL } from './workosTransport';

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

  it('requires a new remote conversation for legacy internal-v2 records from the old API', () => {
    expect(hasWorkosRemoteTargetChanged(
      'remote-1',
      'internal-v2',
      agentUuid,
      'internal-v2',
      agentUuid,
      undefined,
    )).toBe(true);
    expect(hasWorkosRemoteTargetChanged(
      'remote-2',
      'internal-v2',
      agentUuid,
      'internal-v2',
      agentUuid,
      WORKOS_INTERNAL_V2_BASE_URL,
    )).toBe(false);
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
