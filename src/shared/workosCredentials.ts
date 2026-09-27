export const WORKOS_APP_ORIGIN = 'https://workos.yingdao.com';
export const WORKOS_APP_URL_PATTERN = `${WORKOS_APP_ORIGIN}/*`;

export const WORKOS_LOGIN_STORAGE_KEYS = {
  accessToken: 'accessToken',
  userUuid: 'uuid',
  organizationUuid: 'organizationUuid',
} as const;

export interface WorkosLoginCredentials {
  accessToken: string;
  userUuid: string;
  organizationUuid: string;
}

export type WorkosCredentialField = keyof WorkosLoginCredentials;

export type WorkosCredentialsResponse =
  | { ok: true; credentials: WorkosLoginCredentials }
  | { ok: false; error: string; missingFields?: WorkosCredentialField[] };

type StorageReader = (key: string) => string | null;

function clean(value: string | null) {
  return value?.trim() ?? '';
}

export function readWorkosLoginCredentials(
  origin: string,
  getItem: StorageReader,
): WorkosCredentialsResponse {
  if (origin !== WORKOS_APP_ORIGIN) {
    return { ok: false, error: '当前页面不是影刀 AI WorkOS。' };
  }

  try {
    const credentials: WorkosLoginCredentials = {
      accessToken: clean(getItem(WORKOS_LOGIN_STORAGE_KEYS.accessToken)),
      userUuid: clean(getItem(WORKOS_LOGIN_STORAGE_KEYS.userUuid)),
      organizationUuid: clean(getItem(WORKOS_LOGIN_STORAGE_KEYS.organizationUuid)),
    };
    const missingFields = (Object.keys(credentials) as WorkosCredentialField[])
      .filter((field) => !credentials[field]);
    if (missingFields.length) {
      return {
        ok: false,
        error: 'WorkOS 登录信息不完整，请确认已经登录后重试。',
        missingFields,
      };
    }
    return { ok: true, credentials };
  } catch {
    return { ok: false, error: '浏览器阻止了登录信息读取，请刷新 WorkOS 页面后重试。' };
  }
}
