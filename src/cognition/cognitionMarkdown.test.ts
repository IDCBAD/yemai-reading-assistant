import { describe, expect, it } from 'vitest';
import type { CognitionCandidate } from './cognitionLoop';
import { parseCognitionMarkdown, renderCognitionMarkdown } from './cognitionMarkdown';

const candidate: CognitionCandidate = {
  schemaVersion: 1,
  type: 'concept',
  title: '认知文件契约',
  currentUnderstanding: '受管理结构必须无歧义。',
  rationale: '否则外部编辑后无法安全写回。',
  boundary: '适用于页脉认知 Markdown。',
  question: '结构是否完整？',
  source: { conversationId: 'conversation-1', messageId: 'message-1' },
};

function validMarkdown() {
  return renderCognitionMarkdown(candidate, 'cognition-1', '2026-08-27T08:00:00.000Z', candidate.boundary);
}

describe('cognition Markdown validation', () => {
  it('classifies duplicate managed fields and section markers as malformed', () => {
    const duplicateIdentity = validMarkdown().replace('yemai_id: cognition-1', 'yemai_id: cognition-1\nyemai_id: another');
    const duplicateSection = validMarkdown().replace(
      '<!-- yemai:boundary:end -->',
      '<!-- yemai:boundary:end -->\n<!-- yemai:boundary:end -->',
    );
    const overlappingSections = validMarkdown()
      .replace('<!-- yemai:current:end -->', '')
      .replace('<!-- yemai:boundary:start -->', '<!-- yemai:boundary:start -->\n<!-- yemai:current:end -->');
    const unclosedFrontmatter = validMarkdown().replace('\n---\n\n#', '\n\n#');

    expect(parseCognitionMarkdown(duplicateIdentity)).toMatchObject({ kind: 'malformed' });
    expect(parseCognitionMarkdown(duplicateSection)).toMatchObject({ kind: 'malformed' });
    expect(parseCognitionMarkdown(overlappingSections)).toMatchObject({ kind: 'malformed' });
    expect(parseCognitionMarkdown(unclosedFrontmatter)).toMatchObject({ kind: 'malformed' });
  });

  it('rejects unsupported cognition types and statuses instead of guessing', () => {
    expect(parseCognitionMarkdown(validMarkdown().replace('type: concept', 'type: future-type'))).toMatchObject({ kind: 'malformed' });
    expect(parseCognitionMarkdown(validMarkdown().replace('status: current', 'status: mystery'))).toMatchObject({ kind: 'malformed' });
  });
});
