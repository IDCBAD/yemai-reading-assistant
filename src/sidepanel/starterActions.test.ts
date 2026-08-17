import { describe, expect, it } from 'vitest';
import { PAGE_OVERVIEW_PROMPT, PAGE_OVERVIEW_SECTIONS, STARTER_ACTIONS } from './starterActions';

describe('starter actions', () => {
  it('keeps stable and unique action ids', () => {
    const ids = STARTER_ACTIONS.map((action) => action.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['capabilities', 'page-overview', 'key-takeaways']);
  });

  it('uses the standardized prompt for the page overview action', () => {
    expect(STARTER_ACTIONS.find((action) => action.id === 'page-overview')).toMatchObject({
      label: '总览当前网页',
      prompt: PAGE_OVERVIEW_PROMPT,
    });
  });

  it('requests every overview section in a stable order', () => {
    let previousIndex = -1;

    PAGE_OVERVIEW_SECTIONS.forEach((section) => {
      const sectionIndex = PAGE_OVERVIEW_PROMPT.indexOf(section);
      expect(sectionIndex).toBeGreaterThan(previousIndex);
      previousIndex = sectionIndex;
    });
  });

  it('sets evidence and insufficiency boundaries for the overview', () => {
    expect(PAGE_OVERVIEW_PROMPT.length).toBeLessThanOrEqual(180);
    expect(PAGE_OVERVIEW_PROMPT).toContain('Markdown 二级标题');
    expect(PAGE_OVERVIEW_PROMPT).toContain('嵌套列表');
    expect(PAGE_OVERVIEW_PROMPT).toContain('3-5 条');
    expect(PAGE_OVERVIEW_PROMPT).toContain('概念：解释');
    expect(PAGE_OVERVIEW_PROMPT).toContain('只依据当前页面');
    expect(PAGE_OVERVIEW_PROMPT).toContain('页面事实与合理推断');
    expect(PAGE_OVERVIEW_PROMPT).toContain('信息不足时明确说明');
    expect(PAGE_OVERVIEW_PROMPT).toContain('不要补写页面没有的事实');
  });
});
