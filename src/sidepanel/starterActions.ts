export interface StarterAction {
  id: 'capabilities' | 'page-overview' | 'key-takeaways';
  label: string;
  prompt: string;
}

export const PAGE_OVERVIEW_SECTIONS = Object.freeze([
  '一句话主题',
  '内容大纲',
  '关键结论',
  '重要概念',
  '值得追问',
] as const);

export const PAGE_OVERVIEW_PROMPT = [
  '总览当前网页。',
  `请严格使用 Markdown 二级标题，按「${PAGE_OVERVIEW_SECTIONS.join('、')}」五部分输出；`,
  '内容大纲按原文顺序用嵌套列表，关键结论与值得追问各列 3-5 条，重要概念使用「概念：解释」。',
  '只依据当前页面，区分页面事实与合理推断，信息不足时明确说明，不要补写页面没有的事实。',
].join('');

export const STARTER_ACTIONS: readonly StarterAction[] = Object.freeze([
  {
    id: 'capabilities',
    label: '介绍一下你的能力',
    prompt: '介绍一下你的能力',
  },
  {
    id: 'page-overview',
    label: '总览当前网页',
    prompt: PAGE_OVERVIEW_PROMPT,
  },
  {
    id: 'key-takeaways',
    label: '提炼值得记住的内容',
    prompt: '请从当前网页中提炼最值得记住的 3-5 个要点，并说明它们为什么重要。',
  },
]);
