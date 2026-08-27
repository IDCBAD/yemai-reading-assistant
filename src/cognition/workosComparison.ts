import type { WorkosConnectionSettings } from '../services/workosConnection';
import { createWorkosTransport } from '../services/workosTransportFactory';
import type { CognitionComparisonGateway, CognitionComparisonResult } from './cognitionLoop';

function parseComparison(text: string): CognitionComparisonResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  let value: unknown;
  try {
    value = JSON.parse((fenced ?? text).trim());
  } catch {
    throw new Error('Agent 没有返回可识别的认知对照结果。');
  }
  if (!value || typeof value !== 'object') throw new Error('Agent 返回的认知对照结果无效。');
  const result = value as Record<string, unknown>;
  if (!['keep', 'revise', 'wait'].includes(String(result.outcome)) || typeof result.rationale !== 'string') {
    throw new Error('Agent 返回了不受支持的认知对照结果。');
  }
  const revisedUnderstanding = typeof result.revisedUnderstanding === 'string'
    ? result.revisedUnderstanding.trim().slice(0, 4_000)
    : undefined;
  const revisedBoundary = typeof result.revisedBoundary === 'string'
    ? result.revisedBoundary.trim().slice(0, 4_000)
    : undefined;
  if (result.outcome === 'revise' && !revisedUnderstanding && !revisedBoundary) throw new Error('修订结果缺少新的当前理解或适用边界。');
  const optional = (key: 'support' | 'challenge' | 'boundaryChange') => typeof result[key] === 'string'
    ? result[key].trim().slice(0, 2_000)
    : undefined;
  return {
    outcome: result.outcome as CognitionComparisonResult['outcome'],
    rationale: result.rationale.trim().slice(0, 4_000),
    ...(revisedUnderstanding ? { revisedUnderstanding } : {}),
    ...(revisedBoundary ? { revisedBoundary } : {}),
    ...(optional('support') ? { support: optional('support') } : {}),
    ...(optional('challenge') ? { challenge: optional('challenge') } : {}),
    ...(optional('boundaryChange') ? { boundaryChange: optional('boundaryChange') } : {}),
  };
}

export class WorkosCognitionComparisonGateway implements CognitionComparisonGateway {
  constructor(private readonly settings: WorkosConnectionSettings) {}

  async compare(input: Parameters<CognitionComparisonGateway['compare']>[0]) {
    const transport = createWorkosTransport(this.settings);
    const conversation = await transport.createConversation(input.signal);
    let text = '';
    let failure: string | undefined;
    const prompt = [
      '比较一条用户已经确认的个人认知与当前材料。只返回 JSON，不要使用 Markdown。',
      '允许的格式：{"outcome":"keep|revise|wait","support":"支持点","challenge":"挑战点","boundaryChange":"边界变化","rationale":"结论依据","revisedUnderstanding":"revise 时与 revisedBoundary 至少一项非空","revisedBoundary":"修订后的适用边界"}',
      `个人认知：${input.currentUnderstanding}`,
      `当前适用边界：${input.boundary}`,
      input.recentEvents.length ? `最近事件：${input.recentEvents.join('\n')}` : '',
      `当前材料标题：${input.page.title}`,
      input.page.site ? `站点：${input.page.site}` : '',
      `当前材料 URL：${input.page.url}`,
      input.page.description ? `有限概览：${input.page.description}` : '',
      input.page.headings?.length ? `标题结构：${input.page.headings.slice(0, 12).join(' / ')}` : '',
      input.page.selection ? `用户明确选择的当前页片段：${input.page.selection}` : '',
    ].filter(Boolean).join('\n\n');
    await transport.executeStream(conversation, { content: prompt }, {
      onText: (chunk) => { text += chunk; },
      onError: (message) => { failure = message; },
    }, input.signal);
    if (failure) throw new Error(failure);
    return parseComparison(text);
  }
}
