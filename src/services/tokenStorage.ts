import { browser } from 'wxt/browser';

const WORKOS_TOKEN_KEY = 'workosToken';

export function normalizeWorkosToken(value: string) {
  return value.trim();
}

export function validateWorkosToken(value: string) {
  const token = normalizeWorkosToken(value);
  if (!token) return '请输入 WorkOS Token。';
  if (!token.startsWith('AP_')) return 'Token 应以 AP_ 开头。';
  return null;
}

export async function loadWorkosToken() {
  const stored = await browser.storage.local.get(WORKOS_TOKEN_KEY);
  const token = stored[WORKOS_TOKEN_KEY];
  return typeof token === 'string' ? normalizeWorkosToken(token) : '';
}

export async function saveWorkosToken(value: string) {
  const validationError = validateWorkosToken(value);
  if (validationError) throw new Error(validationError);
  const token = normalizeWorkosToken(value);
  await browser.storage.local.set({ [WORKOS_TOKEN_KEY]: token });
  return token;
}

export async function removeWorkosToken() {
  await browser.storage.local.remove(WORKOS_TOKEN_KEY);
}
