import { describe, expect, it } from 'vitest';
import { YEMAI_AGENT_MD_TEMPLATE } from './recommendedAgentTemplate';

describe('recommended Agent.md template', () => {
  it('documents the protocol, source behavior and trust boundary', () => {
    expect(YEMAI_AGENT_MD_TEMPLATE).toContain('[YEMAI_CONTEXT_V1]');
    expect(YEMAI_AGENT_MD_TEMPLATE).toContain('[END_YEMAI_CONTEXT]');
    expect(YEMAI_AGENT_MD_TEMPLATE).toContain('信任边界');
    expect(YEMAI_AGENT_MD_TEMPLATE).toContain('来源 URL');
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('cognition-candidate');
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('认知候选');
  });

  it('is a complete markdown file ready for direct copying', () => {
    expect(YEMAI_AGENT_MD_TEMPLATE.startsWith('# 页脉阅读助手')).toBe(true);
    expect(YEMAI_AGENT_MD_TEMPLATE.endsWith('\n')).toBe(true);
  });

  it('does not ask the Agent to decide when personal cognition should be formed', () => {
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('question` 工具');
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('@media interrupt');
    expect(YEMAI_AGENT_MD_TEMPLATE).not.toContain('微型确认');
  });
});
