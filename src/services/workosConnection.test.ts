import { describe, expect, it } from 'vitest';
import {
  isActiveWorkosConnectionConfigured,
  EMPTY_WORKOS_CONNECTION_SETTINGS,
  normalizeWorkosConnectionSettings,
  validateAgentUuid,
  validateInternalV2Credentials,
  validatePublicApiToken,
  WORKOS_CONNECTION_SETTINGS_VERSION,
  type WorkosConnectionSettings,
} from './workosConnection';

describe('WorkOS connection validation', () => {
  it('keeps the public API token contract explicit', () => {
    expect(validatePublicApiToken('token')).toContain('AP_');
    expect(validatePublicApiToken(' AP_valid ')).toBeNull();
  });

  it('validates the shared Agent UUID', () => {
    expect(validateAgentUuid('not-a-uuid')).toBe('Agent UUID 格式不正确。');
    expect(validateAgentUuid('11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('starts new installations on the experimental channel without a bundled Agent UUID', () => {
    expect(normalizeWorkosConnectionSettings(null)).toMatchObject({
      agentUuid: '',
      transport: 'internal-v2',
    });
    expect(EMPTY_WORKOS_CONNECTION_SETTINGS.agentUuid).toBe('');
  });

  it('clears the legacy implicit Agent UUID while preserving connection fields', () => {
    expect(normalizeWorkosConnectionSettings({
      agentUuid: '11111111-1111-4111-8111-111111111111',
      transport: 'internal-v2',
      internalV2: {
        accessToken: 'access',
        userUuid: 'user',
        organizationUuid: 'org',
      },
    })).toMatchObject({
      agentUuid: '',
      transport: 'internal-v2',
      internalV2: {
        accessToken: 'access',
        userUuid: 'user',
        organizationUuid: 'org',
      },
    });
  });

  it('preserves an Agent UUID saved under the current settings schema', () => {
    expect(normalizeWorkosConnectionSettings({
      schemaVersion: WORKOS_CONNECTION_SETTINGS_VERSION,
      agentUuid: '11111111-1111-4111-8111-111111111111',
      transport: 'internal-v2',
    })).toMatchObject({
      agentUuid: '11111111-1111-4111-8111-111111111111',
      transport: 'internal-v2',
    });
  });

  it('keeps a legacy public API token on the public channel', () => {
    expect(normalizeWorkosConnectionSettings(null, 'AP_existing')).toMatchObject({
      agentUuid: '',
      transport: 'public-v1',
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
      schemaVersion: WORKOS_CONNECTION_SETTINGS_VERSION,
      agentUuid: '11111111-1111-4111-8111-111111111111',
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
