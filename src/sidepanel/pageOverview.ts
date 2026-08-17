import { PAGE_OVERVIEW_SECTIONS } from './starterActions';

export type PageOverviewSectionName = typeof PAGE_OVERVIEW_SECTIONS[number];

export interface PageOverviewTreeNode {
  id: string;
  text: string;
  children: PageOverviewTreeNode[];
}

export interface PageOverviewConcept {
  id: string;
  name: string;
  description?: string;
}

export interface PageOverview {
  summary: string;
  outline: PageOverviewTreeNode[];
  takeaways: string[];
  concepts: PageOverviewConcept[];
  followUps: string[];
}

const SECTION_NAMES = new Set<string>(PAGE_OVERVIEW_SECTIONS);
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]\s+|\d+[.)、]\s*)(.+)$/;

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/g, '$1')
    .replace(/(?:\*|_)(.+?)(?:\*|_)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSectionHeading(line: string): { name: PageOverviewSectionName; inlineContent?: string } | null {
  const heading = line.match(/^\s{0,3}#{1,6}\s*(?:\d+(?:[.)、]|\s)\s*)?(.+?)\s*$/);
  const boldHeading = line.match(/^\s*(?:\d+(?:[.)、]|\s)\s*)?(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/);
  const candidate = (heading?.[1] ?? boldHeading?.[1])
    ?.trim()
    .replace(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/, '$1')
    .replace(/^\d+(?:[.)、]|\s)\s*/, '');
  if (!candidate) return null;

  for (const name of PAGE_OVERVIEW_SECTIONS) {
    if (candidate === name) return { name };
    if (candidate.startsWith(`${name}：`) || candidate.startsWith(`${name}:`)) {
      return { name, inlineContent: candidate.slice(name.length + 1).trim() };
    }
  }
  return null;
}

function collectSections(markdown: string) {
  const sections = new Map<PageOverviewSectionName, string[]>();
  let activeSection: PageOverviewSectionName | null = null;

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = readSectionHeading(line);
    if (heading) {
      activeSection = heading.name;
      if (!sections.has(activeSection)) sections.set(activeSection, []);
      if (heading.inlineContent) sections.get(activeSection)?.push(heading.inlineContent);
      continue;
    }
    if (activeSection) sections.get(activeSection)?.push(line);
  }

  return sections;
}

function appendContinuation(node: PageOverviewTreeNode | undefined, line: string) {
  if (!node) return false;
  const text = cleanInlineMarkdown(line);
  if (!text) return false;
  node.text = `${node.text} ${text}`.trim();
  return true;
}

export function parseOverviewTree(markdown: string): PageOverviewTreeNode[] {
  const roots: PageOverviewTreeNode[] = [];
  const stack: Array<{ indent: number; node: PageOverviewTreeNode }> = [];
  let sequence = 0;

  for (const rawLine of markdown.replace(/\t/g, '  ').split('\n')) {
    const match = rawLine.match(LIST_ITEM_PATTERN);
    if (!match) {
      const continuationTarget = stack[stack.length - 1]?.node;
      appendContinuation(continuationTarget, rawLine);
      continue;
    }

    const text = cleanInlineMarkdown(match[2] ?? '');
    if (!text) continue;
    const indent = (match[1] ?? '').length;
    const node: PageOverviewTreeNode = { id: `outline-${sequence}`, text, children: [] };
    sequence += 1;

    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }

  if (roots.length > 0) return roots;
  return markdown
    .split(/\n{2,}|\n/)
    .map(cleanInlineMarkdown)
    .filter(Boolean)
    .map((text, index) => ({ id: `outline-${index}`, text, children: [] }));
}

function parseList(markdown: string) {
  const nodes = parseOverviewTree(markdown);
  const values: string[] = [];
  const visit = (node: PageOverviewTreeNode) => {
    values.push(node.text);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return values;
}

function parseConcepts(markdown: string): PageOverviewConcept[] {
  return parseList(markdown).map((value, index) => {
    const separator = value.search(/[：:]/);
    if (separator < 0) return { id: `concept-${index}`, name: value };
    return {
      id: `concept-${index}`,
      name: value.slice(0, separator).trim(),
      description: value.slice(separator + 1).trim() || undefined,
    };
  });
}

export function parsePageOverview(markdown: string): PageOverview | null {
  const sections = collectSections(markdown);
  if (sections.size !== SECTION_NAMES.size) return null;

  const section = (name: PageOverviewSectionName) => (sections.get(name) ?? []).join('\n').trim();
  const summary = cleanInlineMarkdown(section('一句话主题'));
  const outline = parseOverviewTree(section('内容大纲'));
  const takeaways = parseList(section('关键结论'));
  const concepts = parseConcepts(section('重要概念'));
  const followUps = parseList(section('值得追问'));

  if (!summary || outline.length === 0 || takeaways.length === 0 || concepts.length === 0 || followUps.length === 0) {
    return null;
  }

  return { summary, outline, takeaways, concepts, followUps };
}
