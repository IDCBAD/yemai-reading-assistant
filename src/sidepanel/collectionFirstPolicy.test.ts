// @ts-expect-error Vitest runs this source-contract test in Node; the extension bundle intentionally omits Node types.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest runs this source-contract test in Node; the extension bundle intentionally omits Node types.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { YEMAI_AGENT_MD_TEMPLATE } from '../services/recommendedAgentTemplate';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const messageListSource = readFileSync(fileURLToPath(new URL('./components/MessageList.tsx', import.meta.url)), 'utf8');
const directorySource = readFileSync(fileURLToPath(new URL('../cognition/cognitionLoop.ts', import.meta.url)), 'utf8');

describe('collection-first cognition policy', () => {
  it('does not turn Agent question replies into local cognition writes', () => {
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('cognition-candidate');
    expect(appSource).not.toContain('cognitionLoop.confirmCandidate');
    expect(appSource).not.toContain('cognitionCandidateFromDecision');
  });

  it('keeps generic question replies and the local directory connection available', () => {
    expect(appSource).toContain('transport.replyInterrupt');
    expect(directorySource).toContain('async connectDirectory(');
    expect(directorySource).toContain('async reconnectDirectory()');
  });

  it('makes collection and follow-up two explicit actions on an answer selection', () => {
    expect(messageListSource).toContain('收藏片段');
    expect(messageListSource).toContain('引用追问');
    expect(messageListSource).toContain('onCollectAssistantExcerpt');
  });

});
