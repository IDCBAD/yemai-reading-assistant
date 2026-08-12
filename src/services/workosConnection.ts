import { browser } from 'wxt/browser';
import { DEFAULT_WORKOS_AGENT_UUID, type WorkosTransportKind } from './workosTransport';

const SETTINGS_KEY = 'workosConnectionSettings';
const LEGACY_TOKEN_KEY = 'workosToken';

export interface InternalV2Credentials {
  accessToken: string;
  userUuid: string;
  organizationUuid: string;
}

export interface WorkosConnectionSettings {
  agentUuid: string;
  transport: WorkosTransportKind;
  publicApiToken: string;
  internalV2: InternalV2Credentials;
}

export const EMPTY_WORKOS_CONNECTION_SETTINGS: WorkosConnectionSettings = {
  agentUuid: DEFAULT_WORKOS_AGENT_UUID,
  transport: 'public-v1',
  publicApiToken: '',
  internalV2: {
    accessToken: '',
    userUuid: '',
    organizationUuid: '',
  },
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWorkosConnectionSettings(value: unknown, legacyToken: unknown = ''): WorkosConnectionSettings {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_WORKOS_CONNECTION_SETTINGS, publicApiToken: clean(legacyToken) };
  }
  const record = value as Record<string, unknown>;
  const internal = record.internalV2 && typeof record.internalV2 === 'object'
    ? record.internalV2 as Record<string, unknown>
    : {};
  return {
    agentUuid: clean(record.agentUuid) || DEFAULT_WORKOS_AGENT_UUID,
    transport: record.transport === 'internal-v2' ? 'internal-v2' : 'public-v1',
    publicApiToken: clean(record.publicApiToken) || clean(legacyToken),
    internalV2: {
      accessToken: clean(internal.accessToken),
      userUuid: clean(internal.userUuid),
      organizationUuid: clean(internal.organizationUuid),
    },
  };
}

export function validateAgentUuid(value: string) {
  const uuid = clean(value);
  if (!uuid) return '请输入 WorkOS Agent UUID。';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    return 'Agent UUID 格式不正确。';
  }
  return null;
}

export function validatePublicApiToken(value: string) {
  const token = clean(value);
  if (!token) return '请输入 WorkOS API Token。';
  if (!token.startsWith('AP_')) return 'API Token 应以 AP_ 开头。';
  return null;
}

export function validateInternalV2Credentials(credentials: InternalV2Credentials) {
  if (!clean(credentials.accessToken)) return '请输入 WorkOS 登录 Access Token。';
  if (!clean(credentials.userUuid)) return '请输入 User UUID。';
  if (!clean(credentials.organizationUuid)) return '请输入 Organization UUID。';
  return null;
}

export function isActiveWorkosConnectionConfigured(settings: WorkosConnectionSettings) {
  return validateAgentUuid(settings.agentUuid) === null && (settings.transport === 'public-v1'
    ? validatePublicApiToken(settings.publicApiToken) === null
    : validateInternalV2Credentials(settings.internalV2) === null);
}

export async function loadWorkosConnectionSettings() {
  const stored = await browser.storage.local.get([SETTINGS_KEY, LEGACY_TOKEN_KEY]);
  return normalizeWorkosConnectionSettings(stored[SETTINGS_KEY], stored[LEGACY_TOKEN_KEY]);
}

export async function saveWorkosConnectionSettings(settings: WorkosConnectionSettings) {
  const normalized = normalizeWorkosConnectionSettings(settings);
  const agentError = validateAgentUuid(normalized.agentUuid);
  if (agentError) throw new Error(agentError);
  if (normalized.publicApiToken) {
    const error = validatePublicApiToken(normalized.publicApiToken);
    if (error) throw new Error(error);
  }
  if (normalized.transport === 'internal-v2') {
    const error = validateInternalV2Credentials(normalized.internalV2);
    if (error) throw new Error(error);
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: normalized });
  await browser.storage.local.remove(LEGACY_TOKEN_KEY);
  return normalized;
}

export async function removeWorkosCredentials(kind: WorkosTransportKind) {
  const current = await loadWorkosConnectionSettings();
  const next = kind === 'public-v1'
    ? { ...current, publicApiToken: '' }
    : { ...current, internalV2: { ...EMPTY_WORKOS_CONNECTION_SETTINGS.internalV2 } };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  await browser.storage.local.remove(LEGACY_TOKEN_KEY);
  return next;
}
