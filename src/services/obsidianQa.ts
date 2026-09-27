import type { ReadingCardRow } from '../data/database';
import { safeMarkdownFilename } from '../data/readingCardMarkdown';
import { readingCardQuestion } from '../sidepanel/readingCards';
import type { Conversation } from '../sidepanel/types';

export interface QaFile { name: string; content: string }
export interface QaDirectory {
  readonly name: string;
  listMarkdown(): Promise<QaFile[]>;
  createNew(name: string, content: string): Promise<void>;
}

export interface QaSaveResult {
  cardId: string;
  title: string;
  status: 'saved' | 'existing' | 'failed';
  detail: string;
}

function localDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readableTitle(title: string) {
  return title.replace(/[\r\n]+/g, ' ').trim() || '未命名问答';
}

function savedCardId(content: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const raw = frontmatter?.match(/^yemai_card_id:\s*(.+)$/m)?.[1]?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return raw;
  }
}

export function qaCardMarkdown(card: ReadingCardRow, question: string) {
  const sources = card.sources.map((source) => {
    const label = (source.title || source.site || source.url).replace(/[\[\]]/g, '\\$&');
    let url: string | undefined;
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.toString();
    } catch { /* Text-only source. */ }
    return `- ${url ? `[${label}](<${url}>)` : label}${source.site ? ` — ${source.site}` : ''}`;
  });
  return [
    '---',
    `yemai_card_id: ${JSON.stringify(card.id)}`,
    `created: ${localDate(card.createdAt)}`,
    '---',
    '',
    `# ${readableTitle(card.title)}`,
    '',
    '## 问题',
    '',
    question.trim(),
    '',
    `## ${card.kind === 'excerpt' ? '收藏的回答片段' : '回答'}`,
    '',
    card.bodyMarkdown.trim(),
    '',
    '## 来源',
    '',
    ...(sources.length ? sources : ['- 未记录']),
    '',
    `> 收藏时间：${new Date(card.createdAt).toISOString()}`,
    '',
  ].join('\n');
}

function availableName(card: ReadingCardRow, filenames: Set<string>) {
  const base = safeMarkdownFilename(`${localDate(card.createdAt)}-${readableTitle(card.title)}`).slice(0, -3);
  let candidate = `${base}.md`;
  let suffix = 2;
  while (filenames.has(candidate.toLocaleLowerCase())) {
    candidate = `${base}-${suffix}.md`;
    suffix += 1;
  }
  return candidate;
}

export async function saveQaCards(
  directory: QaDirectory,
  cards: ReadingCardRow[],
  conversations: Conversation[],
): Promise<QaSaveResult[]> {
  // A failed scan must stop all writes: otherwise an existing card could be duplicated.
  const existingFiles = await directory.listMarkdown();
  const filenames = new Set(existingFiles.map((file) => file.name.toLocaleLowerCase()));
  const ids = new Set(existingFiles.map((file) => savedCardId(file.content)).filter((id): id is string => Boolean(id)));
  const results: QaSaveResult[] = [];
  for (const card of cards) {
    if (ids.has(card.id)) {
      results.push({ cardId: card.id, title: card.title, status: 'existing', detail: '目录中已有同一收藏 ID 的文件' });
      continue;
    }
    const question = readingCardQuestion(card, conversations);
    if (!question) {
      results.push({ cardId: card.id, title: card.title, status: 'failed', detail: '找不到原始问题，未新建文件' });
      continue;
    }
    const filename = availableName(card, filenames);
    try {
      await directory.createNew(filename, qaCardMarkdown(card, question));
      filenames.add(filename.toLocaleLowerCase());
      ids.add(card.id);
      results.push({ cardId: card.id, title: card.title, status: 'saved', detail: filename });
    } catch (error) {
      results.push({ cardId: card.id, title: card.title, status: 'failed', detail: error instanceof Error ? error.message : '新建文件失败' });
    }
  }
  return results;
}
