export type FileTypeKind =
  | 'image'
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'text'
  | 'presentation'
  | 'json'
  | 'generic';

export interface FileTypeInfo {
  kind: FileTypeKind;
  label: string;
  description: string;
}

const FILE_TYPES: Record<FileTypeKind, FileTypeInfo> = {
  image: { kind: 'image', label: 'IMG', description: '图片' },
  pdf: { kind: 'pdf', label: 'PDF', description: 'PDF 文档' },
  word: { kind: 'word', label: 'W', description: '文字文档' },
  spreadsheet: { kind: 'spreadsheet', label: 'XLS', description: '电子表格' },
  csv: { kind: 'csv', label: 'CSV', description: '表格数据' },
  markdown: { kind: 'markdown', label: 'MD', description: 'Markdown 文档' },
  html: { kind: 'html', label: '</>', description: 'HTML 网页' },
  text: { kind: 'text', label: 'TXT', description: '纯文本' },
  presentation: { kind: 'presentation', label: 'P', description: '演示文稿' },
  json: { kind: 'json', label: '{}', description: 'JSON 数据' },
  generic: { kind: 'generic', label: '•••', description: '文件' },
};

const EXTENSION_TYPES: Record<string, FileTypeKind> = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  xls: 'spreadsheet',
  xlsm: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  txt: 'text',
  ppt: 'presentation',
  pptx: 'presentation',
  json: 'json',
};

const MIME_TYPES: Record<string, FileTypeKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'text/csv': 'csv',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'text/plain': 'text',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/json': 'json',
  'text/json': 'json',
};

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

const PUBLIC_V1_UPLOAD_EXTENSIONS = Object.freeze([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'md', 'txt', 'json',
  ...IMAGE_EXTENSIONS,
]);

const INTERNAL_WEB_UPLOAD_EXTENSIONS = Object.freeze([
  ...PUBLIC_V1_UPLOAD_EXTENSIONS,
  'html', 'htm',
]);

export type FileUploadChannel = 'public-v1' | 'internal-v2';

export function getFileExtension(filename: string) {
  return filename.trim().match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
}

export function getFileType(filename: string, mime?: string): FileTypeInfo {
  const normalizedMime = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (isImageFile(filename, normalizedMime)) return FILE_TYPES.image;

  const kind = EXTENSION_TYPES[getFileExtension(filename)] ?? MIME_TYPES[normalizedMime] ?? 'generic';
  return FILE_TYPES[kind];
}

export function isImageFile(filename: string, mime?: string) {
  const normalizedMime = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

function extensionsForChannel(channel: FileUploadChannel) {
  return channel === 'internal-v2' ? INTERNAL_WEB_UPLOAD_EXTENSIONS : PUBLIC_V1_UPLOAD_EXTENSIONS;
}

export function attachmentAcceptForChannel(channel: FileUploadChannel) {
  return extensionsForChannel(channel).map((extension) => `.${extension}`).join(',');
}

export function isFileUploadSupported(filename: string, mime: string | undefined, channel: FileUploadChannel) {
  const extension = getFileExtension(filename);
  if (extension) return extensionsForChannel(channel).includes(extension);

  const type = getFileType(filename, mime);
  if (type.kind === 'image') {
    const normalizedMime = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    return ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp'].includes(normalizedMime);
  }
  const kindExtensions: Partial<Record<FileTypeKind, string[]>> = {
    pdf: ['pdf'],
    word: ['doc', 'docx'],
    spreadsheet: ['xls', 'xlsx', 'xlsm'],
    csv: ['csv'],
    markdown: ['md'],
    html: ['html'],
    text: ['txt'],
    json: ['json'],
  };
  return (kindExtensions[type.kind] ?? []).some((candidate) => extensionsForChannel(channel).includes(candidate));
}

export function isSupportedDocument(filename: string, mime?: string) {
  const extension = getFileExtension(filename);
  if (extension && extension in EXTENSION_TYPES) return true;
  const normalizedMime = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return Boolean(MIME_TYPES[normalizedMime]);
}

export function attachmentFormatLabel(filename: string, mime?: string) {
  const extension = getFileExtension(filename);
  if (extension) return extension.toLocaleUpperCase();
  return getFileType(filename, mime).description;
}
