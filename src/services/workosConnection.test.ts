import { describe, expect, it } from 'vitest';
import {
  isActiveWorkosConnectionConfigured,
  validateInternalV2Credentials,
  validatePublicApiToken,
  type WorkosConnectionSettings,
} from './workosConnection';

describe('WorkOS connection validation', () => {
  it('keeps the public API token contract explicit', () => {
    expect(validatePublicApiToken('token')).toContain('AP_');
    expect(validatePublicApiToken(' AP_valid ')).toBeNull();
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
