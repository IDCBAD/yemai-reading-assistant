import { describe, expect, it } from 'vitest';
import { buildAnswerContextMap, getMessageContextSources } from './answerContext';
import type { ChatMessage } from './types';

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return {
    content: '',
    createdAt: 1,
    status: 'complete',
    ...overrides,
  };
}

describe('answer context provenance', () => {
  it('collects the current page, quotes, and attachments in display order', () => {
    const userMessage = message({
      id: 'user-1',
      role: 'user',
      pageContext: {
        title: 'AI Agents in Depth',
        site: 'bojieli.github.io',
        url: 'https://bojieli.github.io/ai-agent-book/',
        status: 'ready',
      },
      references: [{
        id: 'quote-1',
        text: 'Agent Loop is the engine.',
        pageTitle: 'Agent Loop',
        pageUrl: 'https://example.com/agent-loop',
        createdAt: 1,
      }],
      attachments: [{
        id: 'file-1',
        filename: 'notes.md',
        sizeLabel: '12 KB',
        status: 'ready',
        url: 'https://example.com/notes.md',
      }],
    });

    expect(getMessageContextSources(userMessage).map((source) => source.kind)).toEqual([
      'page',
      'quote',
      'attachment',
    ]);
  });

  it('pairs an answer with the nearest preceding user snapshot', () => {
    const messages = [
      message({ id: 'user-1', role: 'user' }),
      message({ id: 'answer-1', role: 'assistant' }),
      message({
        id: 'user-2',
        role: 'user',
        attachments: [{
          id: 'file-2',
          filename: 'report.pdf',
          sizeLabel: '2 MB',
          status: 'ready',
          url: 'https://example.com/report.pdf',
        }],
      }),
      message({ id: 'answer-2', role: 'assistant' }),
    ];

    const contexts = buildAnswerContextMap(messages);
    expect(contexts.get('answer-1')).toEqual([]);
    expect(contexts.get('answer-2')?.[0]).toMatchObject({
      kind: 'attachment',
      attachment: { filename: 'report.pdf' },
    });
  });

  it('does not invent provenance for an orphaned assistant message', () => {
    const contexts = buildAnswerContextMap([
      message({ id: 'answer-1', role: 'assistant' }),
    ]);
    expect(contexts.get('answer-1')).toEqual([]);
  });
});
