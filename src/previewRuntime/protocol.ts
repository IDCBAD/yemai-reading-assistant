/** This bridge grants no storage, extension, or arbitrary network operations. */
export const HTML_RUNTIME_CHANNEL = 'yemai-html-preview-v1';
export const MAX_COPY_CHARACTERS = 200_000;

export function runtimeMessage(value: unknown, session: string): value is {
  [key: string]: unknown;
  channel: typeof HTML_RUNTIME_CHANNEL; session: string; type: string; requestId?: string; text?: string;
} {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return message.channel === HTML_RUNTIME_CHANNEL && message.session === session
    && typeof message.type === 'string';
}

export function copyRequest(value: unknown, session: string): value is {
  channel: typeof HTML_RUNTIME_CHANNEL; session: string; type: 'copy'; requestId: string; text: string;
} {
  if (!runtimeMessage(value, session)) return false;
  return value.type === 'copy' && typeof value.requestId === 'string' && value.requestId.length <= 80
    && typeof value.text === 'string' && value.text.length <= MAX_COPY_CHARACTERS;
}
