import type { QuoteReference } from '../sidepanel/types';
import type { PageSnapshot } from '../shared/extensionMessages';

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function neutralizeControlTags(value: string) {
  return value.replace(/<\/?(?:untrusted_page_context|quoted_references|user_question)\b/giu, (match) => `&lt;${match.slice(1)}`);
}

export function buildAgentContent(question: string, references: QuoteReference[], page?: PageSnapshot) {
  const sections: string[] = [];
  if (page) {
    sections.push([
      `<untrusted_page_context page_id="${escapeAttribute(page.pageId)}" title="${escapeAttribute(page.title)}" url="${escapeAttribute(page.url)}" captured_at="${new Date(page.extractedAt).toISOString()}"${page.truncated ? ' truncated="true"' : ''}>`,
      neutralizeControlTags(page.markdown),
      '</untrusted_page_context>',
    ].join('\n'));
  }
  if (references.length > 0) {
    const quotes = references
      .map((reference, index) => [
        `[引用 ${index + 1}]`,
        `来源：${reference.pageTitle}`,
        `URL：${reference.pageUrl}`,
        neutralizeControlTags(reference.text),
      ].join('\n'))
      .join('\n\n');
    sections.push(`<quoted_references>\n${quotes}\n</quoted_references>`);
  }
  const normalizedQuestion = question.trim() || '请解释以上引用内容。';
  sections.push(`<user_question>\n${neutralizeControlTags(normalizedQuestion)}\n</user_question>`);
  return sections.join('\n\n');
}
