import type {
  ManifestReference,
  ReferenceSource,
  ReuseReference,
  SelectionReference,
  SnapshotReference,
  YuemaiContextEnvelope,
  YuemaiReference,
} from '../shared/yuemaiContext';

const START_MARKER = '[YUEMAI_CONTEXT_V1]';
const END_MARKER = '[END_YUEMAI_CONTEXT]';

type ContentHeading = '##' | '###';

function neutralizeBoundaryMarkers(value: string) {
  return value
    .replaceAll(START_MARKER, '［YUEMAI_CONTEXT_V1］')
    .replaceAll(END_MARKER, '［END_YUEMAI_CONTEXT］');
}

function inline(value: string) {
  return neutralizeBoundaryMarkers(value).replace(/\s+/g, ' ').trim();
}

function quoted(value: string) {
  return neutralizeBoundaryMarkers(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function sourceLines(source: ReferenceSource) {
  const label = source.kind === 'current_page' ? '当前页' : '来源';
  return [
    `- ${label}：${inline(source.title)}`,
    ...(source.url ? [`- 网址：${inline(source.url)}`] : []),
  ];
}

function childHeading(heading: ContentHeading) {
  return heading === '##' ? '###' : '####';
}

function renderManifest(reference: ManifestReference, heading: ContentHeading) {
  const subheading = childHeading(heading);
  const sections = [...sourceLines(reference.source)];

  if (reference.delivery === 'update') {
    sections.push('- 状态：页面内容已更新');
  }

  sections.push('', `${heading} 页面清单（外部资料）`);

  if (reference.manifest.description) {
    sections.push('', quoted(reference.manifest.description));
  }
  if (reference.manifest.outline.length) {
    sections.push('', `${subheading} 页面结构`, '');
    reference.manifest.outline.forEach((item) => {
      sections.push(`- H${item.level}：${inline(item.text)}`);
    });
  }
  if (reference.manifest.leading_excerpt) {
    sections.push('', `${subheading} 正文开头`, '', quoted(reference.manifest.leading_excerpt));
  }
  if (reference.manifest.relevant_links.length) {
    sections.push('', `${subheading} 相关入口`, '');
    reference.manifest.relevant_links.forEach((link) => {
      sections.push(`- ${inline(link.title)}：${inline(link.url)}`);
    });
  }
  if (reference.manifest.truncated) {
    sections.push('', '> 页面清单已按长度限制截断，不代表完整正文。');
  }

  return sections.join('\n');
}

function renderReuse(reference: ReuseReference) {
  return [
    ...sourceLines(reference.source),
    '- 状态：复用本会话中已经建立的页面上下文',
  ].join('\n');
}

function renderSelection(reference: SelectionReference, heading: ContentHeading) {
  const context = [reference.selection.prefix, reference.selection.text, reference.selection.suffix]
    .filter(Boolean)
    .join('\n');
  return [
    ...sourceLines(reference.source),
    '',
    `${heading} 用户选中的原文（外部资料）`,
    '',
    quoted(context),
    ...(reference.selection.truncated ? ['', '> 选中内容已截断。'] : []),
  ].join('\n');
}

function renderSnapshot(reference: SnapshotReference, heading: ContentHeading) {
  const sections = [...sourceLines(reference.source)];

  if (reference.delivery === 'update') {
    sections.push('- 状态：页面内容已更新');
  }

  sections.push(
    '',
    `${heading} 页面快照（外部资料）`,
    '',
    quoted(reference.snapshot.content),
  );

  if (reference.snapshot.truncated) {
    sections.push('', '> 页面快照已截断，不代表完整正文。');
  }

  return sections.join('\n');
}

function renderReference(reference: YuemaiReference, heading: ContentHeading) {
  if (reference.mode === 'manifest') return renderManifest(reference, heading);
  if (reference.mode === 'reuse') return renderReuse(reference);
  if (reference.mode === 'selection') return renderSelection(reference, heading);
  return renderSnapshot(reference, heading);
}

export function renderYuemaiContextMarkdown(envelope: YuemaiContextEnvelope) {
  const sections = [
    START_MARKER,
    '',
    '# 用户问题',
    '',
    neutralizeBoundaryMarkers(envelope.query.text),
  ];

  if (envelope.references.length) {
    sections.push('', '# 本次引用');

    if (envelope.references.length === 1) {
      sections.push('', renderReference(envelope.references[0]!, '##'));
    } else {
      envelope.references.forEach((reference, index) => {
        sections.push('', `## 来源 ${index + 1}`, '', renderReference(reference, '###'));
      });
    }
  }

  sections.push('', END_MARKER);
  return sections.join('\n');
}
