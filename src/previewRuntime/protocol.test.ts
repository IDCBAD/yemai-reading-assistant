import { describe, expect, it } from 'vitest';
import { copyRequest, HTML_RUNTIME_CHANNEL, MAX_COPY_CHARACTERS, runtimeMessage } from './protocol';

describe('unprivileged HTML messages', () => {
  const copy = { channel: HTML_RUNTIME_CHANNEL, session: 'current', type: 'copy', requestId: '1', text: '用户选择的内容' };
  it('rejects unrelated documents, expired sessions and non-object payloads', () => {
    for (const value of [null, 'copy', { ...copy, channel: 'other' }, { ...copy, session: 'old' }]) {
      expect(runtimeMessage(value, 'current')).toBe(false);
    }
    expect(copyRequest(copy, 'current')).toBe(true);
  });
  it('limits copy to bounded strings with a bounded request ID', () => {
    for (const patch of [{ text: {} }, { text: 'x'.repeat(MAX_COPY_CHARACTERS + 1) }, { requestId: 'x'.repeat(81) }, { type: 'read-clipboard' }]) {
      expect(copyRequest({ ...copy, ...patch }, 'current')).toBe(false);
    }
  });
});
