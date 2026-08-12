import { describe, expect, it } from 'vitest';
import {
  isActiveWorkosConnectionConfigured,
  normalizeWorkosConnectionSettings,
  validateAgentUuid,
  validateInternalV2Credentials,
  validatePublicApiToken,
  type WorkosConnectionSettings,
} from './workosConnection';

describe('WorkOS connection validation', () => {
  it('keeps the public API token contract explicit', () => {
    expect(validatePublicApiToken('token')).toContain('AP_');
    expect(validatePublicApiToken(' AP_valid ')).toBeNull();
  });

  it('validates the shared Agent UUID', () => {
    expect(validateAgentUuid('not-a-uuid')).toBe('Agent UUID 格式不正确。');
    expect(validateAgentUuid('409b06a1-2e2a-4d8c-af3c-ec831c0c6449')).toBeNull();
  });

  it('migrates an existing connection to the original built-in Agent UUID', () => {
    expect(normalizeWorkosConnectionSettings({
      transport: 'public-v1',
      publicApiToken: 'AP_existing',
    })).toMatchObject({
      agentUuid: '409b06a1-2e2a-4d8c-af3c-ec831c0c6449',
      publicApiToken: 'AP_existing',
    });
  });

  it('requires every internal v2 identity field', () => {
    expect(validateInternalV2Credentials({
      accessToken: 'access',
      userUuid: '',
      organizationUuid: 'org',
    })).toBe('请输入 User UUID。');
  });

  it('checks only the selected transport for message readiness', () => {
    const settings: WorkosConnectionSettings = {
      agentUuid: '409b06a1-2e2a-4d8c-af3c-ec831c0c6449',
      transport: 'internal-v2',
      publicApiToken: '',
      internalV2: {
        accessToken: 'access',
        userUuid: 'user',
        organizationUuid: 'org',
      },
    };
    expect(isActiveWorkosConnectionConfigured(settings)).toBe(true);
    expect(isActiveWorkosConnectionConfigured({ ...settings, transport: 'public-v1' })).toBe(false);
  });
});
