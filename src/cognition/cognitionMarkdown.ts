import type { CognitionCandidate, CognitionEventType, CognitionProjectionRow } from './cognitionLoop';

const SECTION_NAMES = ['current', 'changed', 'rationale', 'boundary', 'unresolved', 'sources', 'evolution'] as const;
type SectionName = typeof SECTION_NAMES[number];
const COGNITION_TYPES = new Set(['concept', 'causal-model', 'judgment-principle', 'method', 'decision-basis', 'hypothesis']);
const COGNITION_STATUSES = new Set(['awaiting-validation', 'current', 'contested', 'superseded']);
const OWNED_FRONTMATTER_KEYS = new Set([
  'yemai_id', 'yemai_schema', 'title', 'type', 'status', 'created_at', 'updated_at',
  'source_conversation_id', 'source_message_id', 'source_url',
]);

export interface ParsedCognition {
  id: string;
  schemaVersion: number;
  type: string;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceUrl?: string;
  sections: Record<SectionName, string>;
}

export type ParseResult =
  | { kind: 'ordinary' }
  | { kind: 'malformed'; message: string }
  | { kind: 'managed'; cognition: ParsedCognition };

function yamlValue(value: string | number) {
  if (typeof value === 'number') return String(value);
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseYamlValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function section(markdown: string, name: SectionName) {
  const start = `<!-- yemai:${name}:start -->`;
  const end = `<!-- yemai:${name}:end -->`;
  const startIndexes = [...markdown.matchAll(new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((match) => match.index);
  const endIndexes = [...markdown.matchAll(new RegExp(end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((match) => match.index);
  if (startIndexes.length !== 1 || endIndexes.length !== 1) return undefined;
  const startIndex = startIndexes[0] ?? -1;
  const endIndex = endIndexes[0] ?? -1;
  if (startIndex < 0 || endIndex < startIndex + start.length) return undefined;
  return markdown.slice(startIndex + start.length, endIndex).trim();
}

function frontmatterBounds(markdown: string) {
  const opening = markdown.match(/^---(\r?\n)/);
  if (!opening) return undefined;
  const contentStart = opening[0].length;
  const closing = /\r?\n---\r?\n/g;
  closing.lastIndex = contentStart;
  const match = closing.exec(markdown);
  if (!match) return undefined;
  return {
    contentStart,
    contentEnd: match.index,
    closingStart: match.index,
    closingEnd: match.index + match[0].length,
  };
}

function hasValidManagedSectionLayout(markdown: string, contentStart: number) {
  let cursor = contentStart;
  for (const name of SECTION_NAMES) {
    const start = `<!-- yemai:${name}:start -->`;
    const end = `<!-- yemai:${name}:end -->`;
    const startIndex = markdown.indexOf(start);
    const endIndex = markdown.indexOf(end);
    if (startIndex < cursor || endIndex < startIndex + start.length) return false;
    cursor = endIndex + end.length;
  }
  return true;
}

export function parseCognitionMarkdown(markdown: string): ParseResult {
  const bounds = frontmatterBounds(markdown);
  if (!bounds) {
    const managedHint = /(^|\r?\n)yemai_(?:id|schema)\s*:/m.test(markdown);
    return markdown.startsWith('---') && managedHint
      ? { kind: 'malformed', message: 'Yemai frontmatter 未闭合。' }
      : { kind: 'ordinary' };
  }
  const frontmatter = new Map<string, string>();
  const duplicateOwnedKeys = new Set<string>();
  for (const line of markdown.slice(bounds.contentStart, bounds.contentEnd).split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (OWNED_FRONTMATTER_KEYS.has(key) && frontmatter.has(key)) duplicateOwnedKeys.add(key);
    frontmatter.set(key, parseYamlValue(line.slice(separator + 1)));
  }
  const managedHint = frontmatter.has('yemai_id') || frontmatter.has('yemai_schema');
  if (!managedHint) return { kind: 'ordinary' };
  const id = frontmatter.get('yemai_id');
  const schemaVersion = Number(frontmatter.get('yemai_schema'));
  const title = frontmatter.get('title');
  const type = frontmatter.get('type');
  const status = frontmatter.get('status');
  const createdAt = frontmatter.get('created_at');
  const updatedAt = frontmatter.get('updated_at');
  const sections = Object.fromEntries(SECTION_NAMES.map((name) => [name, section(markdown, name)])) as Record<SectionName, string | undefined>;
  if (duplicateOwnedKeys.size > 0) {
    return { kind: 'malformed', message: `受管理字段重复：${[...duplicateOwnedKeys].join('、')}。` };
  }
  if (!hasValidManagedSectionLayout(markdown, bounds.closingEnd)) {
    return { kind: 'malformed', message: '受管理区块顺序错误、交叉嵌套或重复。' };
  }
  if (!id || schemaVersion !== 1 || !title || !type || !status || !createdAt || !updatedAt
    || !COGNITION_TYPES.has(type) || !COGNITION_STATUSES.has(status)
    || SECTION_NAMES.some((name) => sections[name] === undefined)) {
    return { kind: 'malformed', message: '缺少受管理认知所需的字段或区块。' };
  }
  return {
    kind: 'managed',
    cognition: {
      id,
      schemaVersion,
      title,
      type,
      status,
      createdAt,
      updatedAt,
      sourceConversationId: frontmatter.get('source_conversation_id'),
      sourceMessageId: frontmatter.get('source_message_id'),
      sourceUrl: frontmatter.get('source_url'),
      sections: sections as Record<SectionName, string>,
    },
  };
}

function managedSection(name: SectionName, value: string, newline = '\n') {
  const normalized = value.trim().replace(/\r?\n/g, newline);
  return `<!-- yemai:${name}:start -->${newline}${normalized}${newline}<!-- yemai:${name}:end -->`;
}

function eventLine(at: string, type: CognitionEventType, summary: string) {
  return `- ${at} \`${type}\` ${summary.replace(/\s+/g, ' ').trim()}`;
}

export function safeMarkdownSource(title: string, value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const safeTitle = title.replace(/[\[\]]/g, '').trim() || url.hostname;
    return `[${safeTitle}](${url.toString().replace(/\)/g, '%29')})`;
  } catch {
    return undefined;
  }
}

export function renderCognitionMarkdown(candidate: CognitionCandidate, id: string, at: string, boundary: string) {
  const sourcePage = candidate.source.pageTitle
    ? safeMarkdownSource(candidate.source.pageTitle, candidate.source.pageUrl)
    : undefined;
  const sourceLines = [
    sourcePage ? `- ${sourcePage}` : undefined,
    `- 对话 ${candidate.source.conversationId} · 回答 ${candidate.source.messageId}`,
  ].filter(Boolean).join('\n');
  const frontmatter = [
    '---',
    `yemai_id: ${yamlValue(id)}`,
    'yemai_schema: 1',
    `title: ${yamlValue(candidate.title)}`,
    `type: ${yamlValue(candidate.type)}`,
    'status: current',
    `created_at: ${yamlValue(at)}`,
    `updated_at: ${yamlValue(at)}`,
    `source_conversation_id: ${yamlValue(candidate.source.conversationId)}`,
    `source_message_id: ${yamlValue(candidate.source.messageId)}`,
    ...(candidate.source.pageUrl ? [`source_url: ${yamlValue(candidate.source.pageUrl)}`] : []),
    '---',
  ];
  const formedId = `formed-${id}`;
  const formedSource = [sourcePage, `对话 ${candidate.source.conversationId} · 回答 ${candidate.source.messageId}`].filter(Boolean).join('；');
  const formedReason = candidate.confirmation?.trim() || '用户确认候选并完成类型对应的微型确认。';
  const formedSummary = `事件 ID：${formedId}；来源：${formedSource}；用户理由：${formedReason}；结果状态：current <!-- yemai:event:${formedId} -->`;
  return `${frontmatter.join('\n')}\n\n# ${candidate.title}\n\n${managedSection('current', candidate.currentUnderstanding)}\n\n${managedSection('changed', candidate.changedFrom ?? '尚未记录。')}\n\n${managedSection('rationale', candidate.rationale)}\n\n${managedSection('boundary', boundary)}\n\n${managedSection('unresolved', candidate.unresolved ?? '暂无。')}\n\n${managedSection('sources', sourceLines)}\n\n${managedSection('evolution', eventLine(at, 'formed', formedSummary))}\n`;
}

function replaceFrontmatterValue(markdown: string, key: string, value: string) {
  const bounds = frontmatterBounds(markdown);
  if (!bounds) return markdown;
  const head = markdown.slice(0, bounds.contentEnd);
  const tail = markdown.slice(bounds.closingStart);
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const pattern = new RegExp(`(^|\\r?\\n)${key}:[^\\r\\n]*(?=\\r?\\n|$)`);
  const nextHead = pattern.test(head)
    ? head.replace(pattern, `$1${key}: ${yamlValue(value)}`)
    : `${head}${newline}${key}: ${yamlValue(value)}`;
  return nextHead + tail;
}

function replaceSection(markdown: string, name: SectionName, value: string) {
  const start = `<!-- yemai:${name}:start -->`;
  const end = `<!-- yemai:${name}:end -->`;
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) throw new Error(`认知文件缺少 ${name} 受管理区块。`);
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  return `${markdown.slice(0, startIndex)}${managedSection(name, value, newline)}${markdown.slice(endIndex + end.length)}`;
}

export function appendCognitionEvent(
  markdown: string,
  at: string,
  eventType: CognitionEventType,
  summary: string,
  updates: {
    revisedUnderstanding?: string;
    revisedBoundary?: string;
    unresolved?: string;
    status?: string;
  } = {},
) {
  const parsed = parseCognitionMarkdown(markdown);
  if (parsed.kind !== 'managed') throw new Error('认知文件已损坏，已停止写入。');
  let next = markdown;
  if (eventType === 'revised' && updates.revisedUnderstanding) {
    next = replaceSection(next, 'current', updates.revisedUnderstanding);
  }
  if (eventType === 'revised' && updates.revisedBoundary) {
    next = replaceSection(next, 'boundary', updates.revisedBoundary);
  }
  if (updates.unresolved) {
    const unresolved = parsed.cognition.sections.unresolved === '暂无。'
      ? updates.unresolved
      : `${parsed.cognition.sections.unresolved}\n${updates.unresolved}`;
    next = replaceSection(next, 'unresolved', unresolved);
  }
  const evolution = `${parsed.cognition.sections.evolution}\n${eventLine(at, eventType, summary)}`;
  next = replaceSection(next, 'evolution', evolution);
  if (updates.status) next = replaceFrontmatterValue(next, 'status', updates.status);
  return replaceFrontmatterValue(next, 'updated_at', at);
}

export function cognitionProjection(filename: string, cognition: ParsedCognition, fileFingerprint?: string): CognitionProjectionRow {
  const searchableText = [
    cognition.title,
    cognition.type,
    cognition.sections.current,
    cognition.sections.rationale,
    cognition.sections.boundary,
    cognition.sourceUrl,
  ].filter(Boolean).join(' ');
  return {
    id: cognition.id,
    filename,
    title: cognition.title,
    type: cognition.type,
    status: cognition.status,
    updatedAt: cognition.updatedAt,
    searchableText,
    searchFields: {
      title: cognition.title,
      current: cognition.sections.current,
      boundary: cognition.sections.boundary,
      rationale: cognition.sections.rationale,
      unresolved: cognition.sections.unresolved,
      sources: cognition.sections.sources,
      events: cognition.sections.evolution,
    },
    fingerprint: fileFingerprint ?? fingerprint(searchableText + cognition.updatedAt),
    sourceUrl: cognition.sourceUrl,
  };
}

export function fingerprint(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function cognitionFilename(id: string, title: string) {
  const slug = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'cognition';
  return `${slug}--${id}.md`;
}
