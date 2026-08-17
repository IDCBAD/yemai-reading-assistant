import { describe, expect, it, vi } from 'vitest';
import {
  readWorkosLoginCredentials,
  WORKOS_APP_ORIGIN,
  WORKOS_LOGIN_STORAGE_KEYS,
} from './workosCredentials';

describe('readWorkosLoginCredentials', () => {
  it('reads only the three allowlisted WorkOS keys', () => {
    const values: Record<string, string> = {
      accessToken: 'token-value',
      uuid: 'user-value',
      organizationUuid: 'organization-value',
    };
    const getItem = vi.fn((key: string) => values[key] ?? null);

    expect(readWorkosLoginCredentials(WORKOS_APP_ORIGIN, getItem)).toEqual({
      ok: true,
      credentials: {
        accessToken: 'token-value',
        userUuid: 'user-value',
        organizationUuid: 'organization-value',
      },
    });
    expect(getItem.mock.calls.map(([key]) => key)).toEqual([
      WORKOS_LOGIN_STORAGE_KEYS.accessToken,
      WORKOS_LOGIN_STORAGE_KEYS.userUuid,
      WORKOS_LOGIN_STORAGE_KEYS.organizationUuid,
    ]);
  });

  it('rejects every origin outside the exact WorkOS app origin before reading storage', () => {
    const getItem = vi.fn(() => 'should-not-be-read');

    expect(readWorkosLoginCredentials('https://example.com', getItem)).toEqual({
      ok: false,
      error: '当前页面不是影刀 AI WorkOS。',
    });
    expect(getItem).not.toHaveBeenCalled();
  });

  it('reports missing fields without returning partial credentials', () => {
    const values: Record<string, string> = {
      accessToken: 'token-value',
      uuid: '',
      organizationUuid: 'organization-value',
    };

    expect(readWorkosLoginCredentials(
      WORKOS_APP_ORIGIN,
      (key) => values[key] ?? null,
    )).toEqual({
      ok: false,
      error: 'WorkOS 登录信息不完整，请确认已经登录后重试。',
      missingFields: ['userUuid'],
    });
  });

  it('does not expose storage errors', () => {
    expect(readWorkosLoginCredentials(WORKOS_APP_ORIGIN, () => {
      throw new Error('sensitive browser detail');
    })).toEqual({
      ok: false,
      error: '浏览器阻止了登录信息读取，请刷新 WorkOS 页面后重试。',
    });
  });
});
