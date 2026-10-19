import { describe, expect, it } from 'vitest';
import type { AssistantArtifact, ChatMessage } from './types';
import { replayedArtifactGroups } from './artifactHistory';

const file: AssistantArtifact = { id: 'material-1', kind: 'html', filename: '解释.html', url: 'https://files.example.com/1.html', status: 'available' };
const activity = { id: 'call-old', kind: 'tool' as const, title: '生成文件', status: 'completed' as const, completedAt: 20 };
const old: ChatMessage = { id: 'old', role: 'assistant', createdAt: 1, runStartedAt: 1, content: '原始交付', status: 'complete', artifacts: [file], activities: [activity] };
const later: ChatMessage = { id: 'later', role: 'assistant', createdAt: 30, runStartedAt: 30, content: '后续问题', status: 'complete', artifacts: [file], activities: [activity] };

describe('legacy replayed artifact presentation', () => {
  it('folds only exact old resources with evidence that the owner’s old tool was replayed', () => {
    const fresh = { ...file, id: 'material-new', url: 'https://files.example.com/new.html' };
    const messages = [old, { ...later, artifacts: [file, fresh] }];
    const before = JSON.stringify(messages);
    const groups = replayedArtifactGroups(messages);
    expect(groups.get('later')).toEqual({ current: [fresh], replayed: [file] });
    expect(groups.has('old')).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it.each([
    { ...later, activities: [{ ...activity, id: 'call-new', completedAt: 40 }] },
    { ...later, activities: [{ ...activity, completedAt: 40 }] },
    { ...later, runStartedAt: undefined },
    { ...later, artifacts: [{ ...file, id: 'new-id' }] },
    { ...later, artifacts: [{ ...file, url: 'https://files.example.com/new.html' }] },
    { ...later, artifacts: [{ ...file, url: undefined }] },
  ])('keeps legitimate deliveries and ambiguous history visible', (message) => {
    expect(replayedArtifactGroups([old, message]).size).toBe(0);
  });
});
