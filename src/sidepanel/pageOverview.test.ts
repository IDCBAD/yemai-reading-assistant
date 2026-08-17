import { describe, expect, it } from 'vitest';
import { parseOverviewTree, parsePageOverview } from './pageOverview';

const completeOverview = `
## 一句话主题
这是一篇解释 **Agent 架构** 的文章。

## 内容大纲
- Agent 的组成
  - Model 负责推理
  - Harness 负责运行与治理
    - 工具调用属于 Harness
- Agent 的评估
  - 关注可持续演进

## 关键结论
- Agent 不等于单独的模型
- 评估体系要跟上模型演进

## 重要概念
- **Model**：负责理解与决策
- Harness：负责上下文、工具和状态

## 值得追问
1. 如何设计可靠的 Harness？
2. 怎样搭建评估体系？
`;

describe('page overview parser', () => {
  it('parses all five sections and preserves nested outline hierarchy', () => {
    const result = parsePageOverview(completeOverview);

    expect(result?.summary).toBe('这是一篇解释 Agent 架构 的文章。');
    expect(result?.outline).toHaveLength(2);
    expect(result?.outline[0]).toMatchObject({
      text: 'Agent 的组成',
      children: [{
        text: 'Model 负责推理',
        children: [],
      }, {
        text: 'Harness 负责运行与治理',
        children: [{ text: '工具调用属于 Harness', children: [] }],
      }],
    });
    expect(result?.takeaways).toEqual(['Agent 不等于单独的模型', '评估体系要跟上模型演进']);
    expect(result?.concepts).toEqual([
      { id: 'concept-0', name: 'Model', description: '负责理解与决策' },
      { id: 'concept-1', name: 'Harness', description: '负责上下文、工具和状态' },
    ]);
    expect(result?.followUps).toEqual(['如何设计可靠的 Harness？', '怎样搭建评估体系？']);
  });

  it('accepts numbered headings and content placed on the heading line', () => {
    const markdown = completeOverview
      .replace('## 一句话主题\n这是一篇解释 **Agent 架构** 的文章。', '### 1. 一句话主题：理解 Agent 的结构')
      .replace('## 内容大纲', '**2. 内容大纲**')
      .replace('## 关键结论', '**3. 关键结论**')
      .replace('## 重要概念', '**4. 重要概念**')
      .replace('## 值得追问', '**5. 值得追问**');

    expect(parsePageOverview(markdown)?.summary).toBe('理解 Agent 的结构');
  });

  it('accepts bold labels inside Markdown headings', () => {
    const markdown = completeOverview
      .replace('## 一句话主题', '## **一句话主题**')
      .replace('## 内容大纲', '## **2 内容大纲**');

    expect(parsePageOverview(markdown)?.outline[0]?.text).toBe('Agent 的组成');
  });

  it('returns null when the response cannot safely fill the dedicated view', () => {
    expect(parsePageOverview('## 一句话主题\n只有一句摘要')).toBeNull();
  });

  it('keeps wrapped list lines attached to their preceding item', () => {
    expect(parseOverviewTree('- 第一行\n  延续说明\n- 第二行').map((node) => node.text)).toEqual([
      '第一行 延续说明',
      '第二行',
    ]);
  });
});
