import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKOS_AGENT_UUID, hasWorkosRemoteTargetChanged } from './workosTransport';

describe('WorkOS remote target identity', () => {
  it('treats legacy remote metadata as the original v1 Agent', () => {
    expect(hasWorkosRemoteTargetChanged(
      'remote-1',
      undefined,
      undefined,
      'public-v1',
      DEFAULT_WORKOS_AGENT_UUID,
    )).toBe(false);
  });

  it('requires a new remote conversation after changing the Agent UUID', () => {
    expect(hasWorkosRemoteTargetChanged(
      'remote-1',
      'internal-v2',
      DEFAULT_WORKOS_AGENT_UUID,
      'internal-v2',
      '11111111-1111-4111-8111-111111111111',
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
