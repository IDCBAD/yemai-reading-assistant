export interface WorkosSseCallbacks {
  onText: (text: string) => void;
  onActivity?: (activity: WorkosToolActivity) => void;
  onArtifact?: (artifact: WorkosArtifact) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
}

export interface WorkosSseParserOptions {
  expectedRunId?: string;
}

export type WorkosToolStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Deliberately safe projection of a WorkOS tool event. Raw arguments, model
 * reasoning and tool output never cross this boundary into the UI state.
 */
export interface WorkosToolActivity {
  id: string;
  title: string;
  status: WorkosToolStatus;
  startedAt?: number;
  completedAt?: number;
}

export type WorkosArtifactKind = 'image' | 'html' | 'markdown' | 'document' | 'archive' | 'file';

/** Safe, allow-listed projection of a WorkOS output file. */
export interface WorkosArtifact {
  id: string;
  kind: WorkosArtifactKind;
  filename: string;
  url?: string;
  mime?: string;
  size?: number;
  thumbnailUrl?: string;
  status: 'available' | 'failed';
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapPayload(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === 'string') {
      const parsed = parseJson(current);
      if (parsed === current) return current;
      current = parsed;
      continue;
    }
    if (isRecord(current) && typeof current.data === 'string') {
      const parsed = parseJson(current.data);
      if (parsed !== current.data) {
        current = parsed;
        continue;
      }
    }
    if (isRecord(current) && isRecord(current.data)) {
      current = current.data;
      continue;
    }
    break;
  }
  return current;
}

function firstString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return undefined;
}

function firstNumber(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key])) return record[key] as number;
  }
  return undefined;
}

function normalizeTimestamp(value: number | undefined) {
  if (value === undefined) return undefined;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function safeLabel(value: string | undefined) {
  if (!value) return undefined;
  const label = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label || label.startsWith('{') || label.startsWith('[')) return undefined;
  return label.slice(0, 48);
}

function safeFilename(value: string | undefined) {
  if (!value) return undefined;
  let decoded = value;
  // WorkOS may return a percent-encoded filename, while its material URL may
  // contain the same basename encoded a second time. Decode at most twice so
  // the UI gets a readable label without treating arbitrary output as data.
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return safeLabel(decoded);
}

function toolStatus(value: string | undefined, fallback: WorkosToolStatus): WorkosToolStatus {
  switch (value?.toLowerCase().replace(/_/g, '-')) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'running':
    case 'started':
    case 'in-progress':
      return 'running';
    case 'completed':
    case 'complete':
    case 'success':
    case 'succeeded':
    case 'done':
      return 'completed';
    case 'error':
    case 'failed':
    case 'failure':
      return 'failed';
    default:
      return fallback;
  }
}

function isToolPart(type: string) {
  const normalized = type.toLowerCase();
  return normalized === 'tool' || normalized === 'tool-call' || normalized === 'tool-invocation';
}

const ARTIFACT_PART_TYPES = new Set([
  'artifact',
  'attachment',
  'document',
  'file',
  'image',
  'media',
  'output-file',
  'resource',
]);

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const DOCUMENT_EXTENSIONS = new Set(['csv', 'doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsm', 'xlsx']);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'rar', 'tar', 'zip']);

function safeRemoteUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function fileExtension(filename: string) {
  return filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
}

function filenameFromUrl(value: string | undefined) {
  if (!value) return undefined;
  const basename = new URL(value).pathname.split('/').pop();
  if (!basename) return undefined;
  return safeFilename(basename);
}

function artifactKind(partType: string, filename: string, mime?: string): WorkosArtifactKind {
  const normalizedMime = mime?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const extension = fileExtension(filename);
  if (partType === 'image' || normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (normalizedMime === 'text/html' || extension === 'html' || extension === 'htm') return 'html';
  if (normalizedMime === 'text/markdown' || normalizedMime === 'text/x-markdown'
    || extension === 'md' || extension === 'markdown') return 'markdown';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(extension)
    || normalizedMime.startsWith('application/pdf')
    || normalizedMime.includes('officedocument')
    || normalizedMime.includes('msword')
    || normalizedMime.includes('ms-excel')
    || normalizedMime.includes('ms-powerpoint')) return 'document';
  return 'file';
}

function artifactRecords(value: UnknownRecord) {
  const candidates: UnknownRecord[] = [value];
  for (const key of ['artifact', 'attachment', 'document', 'file', 'image', 'media', 'resource']) {
    if (isRecord(value[key])) candidates.push(value[key] as UnknownRecord);
  }
  for (const key of ['artifacts', 'attachments', 'documents', 'files', 'images', 'resources']) {
    const collection = value[key];
    if (Array.isArray(collection)) {
      collection.forEach((item) => {
        if (isRecord(item)) candidates.push(item);
      });
    }
  }
  return candidates;
}

function projectArtifact(record: UnknownRecord, fallbackType: string, fallbackId?: string): WorkosArtifact | undefined {
  const url = safeRemoteUrl(firstString(record, [
    'downloadUrl', 'downloadURL', 'fileReadUrl', 'fileUrl', 'imageUrl', 'ossUrl', 'previewUrl', 'src', 'url',
  ]));
  const thumbnailUrl = safeRemoteUrl(firstString(record, ['thumbnailUrl', 'thumbUrl', 'thumbnail', 'previewImageUrl']));
  const filename = safeFilename(firstString(record, ['filename', 'fileName', 'name', 'title']))
    ?? filenameFromUrl(url)
    ?? (fallbackType === 'image' ? '生成图片' : '生成文件');
  const mime = safeLabel(firstString(record, ['contentType', 'fileType', 'mime', 'mimeType']));
  const id = firstString(record, ['artifactId', 'attachmentId', 'fileId', 'id', 'uuid'])
    ?? fallbackId
    ?? `${fallbackType}:${url ?? filename}`;
  const rawStatus = firstString(record, ['status', 'state'])?.toLowerCase();
  const status = rawStatus && ['error', 'failed', 'failure'].includes(rawStatus) ? 'failed' as const : 'available' as const;
  if (!url && !thumbnailUrl && status !== 'failed') return undefined;
  const size = firstNumber(record, ['contentLength', 'fileSize', 'size', 'sizeBytes']);
  return {
    id,
    kind: artifactKind(fallbackType, filename, mime),
    filename,
    ...(url ? { url } : {}),
    ...(mime ? { mime } : {}),
    ...(size !== undefined && size >= 0 ? { size } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    status,
  };
}

function isSuccessfulTerminalStatus(status: string) {
  const normalized = status.toLowerCase().replace(/[\s_-]/g, '');
  return [
    'success',
    'successful',
    'succeeded',
    'completed',
    'complete',
    'done',
    'finish',
    'finished',
    'ok',
  ].includes(normalized);
}

export class WorkosSseParser {
  private buffer = '';
  private textParts = new Map<string, string>();
  private partOrder: string[] = [];
  private partTypes = new Map<string, string>();
  private pendingDeltas = new Map<string, string[]>();
  private toolActivities = new Map<string, WorkosToolActivity>();
  private artifacts = new Map<string, WorkosArtifact>();
  private completed = false;

  constructor(
    private readonly callbacks: WorkosSseCallbacks,
    private readonly options: WorkosSseParserOptions = {},
  ) {}

  get isComplete() {
    return this.completed;
  }

  push(chunk: string) {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      this.processBlock(block);
      boundary = this.buffer.indexOf('\n\n');
    }
  }

  finish() {
    if (this.buffer.trim()) this.processBlock(this.buffer);
    this.buffer = '';
  }

  private processBlock(block: string) {
    const lines = block.split('\n');
    const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') this.complete();
      return;
    }

    const rawPayload = parseJson(data);
    const envelope = isRecord(rawPayload) ? rawPayload : undefined;
    const payload = unwrapPayload(rawPayload);
    if (!isRecord(payload)) return;
    const runId = (envelope ? firstString(envelope, ['runId', 'runID']) : undefined)
      ?? firstString(payload, ['runId', 'runID']);
    // Some v2 message events do not carry a runId even though the matching
    // completion event does. Reject only an explicitly different run so we do
    // not discard valid text from the current subscription.
    if (this.options.expectedRunId && runId && runId !== this.options.expectedRunId) return;
    this.processEvent(eventName, payload);
  }

  private processEvent(eventName: string | undefined, event: UnknownRecord) {
    const properties = isRecord(event.properties)
      ? event.properties
      : isRecord(event.payload)
        ? event.payload
        : event;
    const eventType = firstString(event, ['type', 'event', 'name']) ?? eventName ?? '';

    if (eventType === 'message.part.updated') {
      const part = isRecord(properties.part) ? properties.part : properties;
      const partId = firstString(part, ['id', 'partID', 'partId']);
      const partType = firstString(part, ['type', 'partType']);
      if (!partId || !partType) return;
      const normalizedPartType = partType.toLowerCase();
      this.partTypes.set(partId, normalizedPartType);
      if (isToolPart(normalizedPartType)) {
        this.processToolPart(partId, part);
        this.pendingDeltas.delete(partId);
        return;
      }
      if (ARTIFACT_PART_TYPES.has(normalizedPartType)) {
        this.processArtifactRecords(part, normalizedPartType, partId);
        this.pendingDeltas.delete(partId);
        return;
      }
      // Some WorkOS versions attach output resources to the final text part.
      this.processArtifactCollections(part, normalizedPartType, partId);
      if (normalizedPartType !== 'text') {
        this.pendingDeltas.delete(partId);
        return;
      }
      if (!this.partOrder.includes(partId)) this.partOrder.push(partId);
      const snapshot = firstString(part, ['text', 'content']);
      if (snapshot !== undefined) this.textParts.set(partId, snapshot);
      const pending = this.pendingDeltas.get(partId);
      if (pending?.length) {
        if (snapshot === undefined || snapshot.length === 0) {
          this.textParts.set(partId, `${this.textParts.get(partId) ?? ''}${pending.join('')}`);
        }
        this.pendingDeltas.delete(partId);
      }
      this.emitText();
      return;
    }

    if (eventType.toLowerCase().includes('tool')) {
      this.processToolEvent(eventType, properties);
      return;
    }

    const normalizedEventType = eventType.toLowerCase();
    if ([...ARTIFACT_PART_TYPES].some((type) => normalizedEventType.includes(type))) {
      this.processArtifactRecords(properties, normalizedEventType);
      return;
    }

    if (eventType === 'message.part.delta') {
      const partId = firstString(properties, ['partID', 'partId', 'id']);
      const delta = firstString(properties, ['delta', 'text', 'content']);
      const field = firstString(properties, ['field']);
      if (!partId || delta === undefined || (field && field !== 'text')) return;
      const partType = this.partTypes.get(partId);
      if (partType === 'text') {
        this.textParts.set(partId, `${this.textParts.get(partId) ?? ''}${delta}`);
        this.emitText();
      } else if (!partType) {
        this.pendingDeltas.set(partId, [...(this.pendingDeltas.get(partId) ?? []), delta]);
      }
      return;
    }

    if (eventType === 'run.terminal') {
      const status = firstString(properties, ['status', 'state']);
      if (status && !isSuccessfulTerminalStatus(status)) {
        this.callbacks.onError?.(firstString(properties, ['message', 'error']) ?? 'Agent 执行失败。');
      }
      return;
    }

    if (eventType === 'xybot-stream-complete' || eventType === 'stream.complete') {
      this.complete();
      return;
    }

    if (eventType === 'text') {
      const text = firstString(properties, ['text', 'content', 'delta']);
      if (text !== undefined) this.callbacks.onText(text);
    }
  }

  private emitText() {
    const text = this.partOrder.map((partId) => this.textParts.get(partId) ?? '').join('');
    this.callbacks.onText(text);
  }

  private processToolPart(partId: string, part: UnknownRecord) {
    const state = isRecord(part.state) ? part.state : undefined;
    const time = state && isRecord(state.time)
      ? state.time
      : isRecord(part.time)
        ? part.time
        : undefined;
    const id = firstString(part, ['callID', 'callId', 'toolCallId']) ?? partId;
    const title = this.readToolTitle(part, state);
    const rawStatus = state
      ? firstString(state, ['status', 'state'])
      : firstString(part, ['status', 'state']);
    const startedAt = normalizeTimestamp(time ? firstNumber(time, ['start', 'startedAt', 'startTime']) : undefined);
    const completedAt = normalizeTimestamp(time ? firstNumber(time, ['end', 'completedAt', 'endTime']) : undefined);
    const status = toolStatus(rawStatus, completedAt ? 'completed' : 'running');
    this.emitToolActivity({ id, title, status, startedAt, completedAt });

    // WorkOS v2 delivers generated files inside a completed tool part rather
    // than as a standalone file/artifact part. Only project the explicit,
    // structured material allow-list; never inspect raw input/output strings.
    const metadata = state && isRecord(state.metadata) ? state.metadata : undefined;
    const material = metadata && isRecord(metadata.material) ? metadata.material : undefined;
    if (material) {
      const materialType = firstString(material, ['type']) ?? 'file';
      this.processArtifactRecords(material, materialType, `${partId}:material`);
    }
  }

  private processArtifactCollections(record: UnknownRecord, fallbackType: string, fallbackId?: string) {
    const collectionKeys = ['artifacts', 'attachments', 'documents', 'files', 'images', 'resources'];
    if (!collectionKeys.some((key) => Array.isArray(record[key]) || isRecord(record[key]))) return;
    this.processArtifactRecords(record, fallbackType, fallbackId);
  }

  private processArtifactRecords(record: UnknownRecord, fallbackType: string, fallbackId?: string) {
    const candidates = artifactRecords(record);
    candidates.forEach((candidate, index) => {
      const candidateFallbackId = index === 0 || candidates.length === 2 ? fallbackId : undefined;
      const artifact = projectArtifact(candidate, fallbackType, candidateFallbackId);
      if (!artifact) return;
      const previous = this.artifacts.get(artifact.id);
      const next: WorkosArtifact = {
        ...previous,
        ...artifact,
        filename: artifact.filename || previous?.filename || '生成文件',
        url: artifact.url ?? previous?.url,
        thumbnailUrl: artifact.thumbnailUrl ?? previous?.thumbnailUrl,
      };
      const dedupeKey = next.url
        ? [...this.artifacts.values()].find((item) => item.url === next.url)?.id
        : undefined;
      if (dedupeKey && dedupeKey !== next.id) {
        const duplicate = this.artifacts.get(dedupeKey);
        const merged = { ...duplicate, ...next, id: dedupeKey };
        this.artifacts.set(dedupeKey, merged);
        this.callbacks.onArtifact?.(merged);
        return;
      }
      this.artifacts.set(next.id, next);
      this.callbacks.onArtifact?.(next);
    });
  }

  private processToolEvent(eventType: string, properties: UnknownRecord) {
    const tool = isRecord(properties.tool) ? properties.tool : undefined;
    const id = firstString(properties, ['callID', 'callId', 'toolCallId', 'id'])
      ?? (tool ? firstString(tool, ['callID', 'callId', 'id']) : undefined)
      ?? `tool:${this.readToolTitle(properties, tool)}`;
    const lowered = eventType.toLowerCase();
    const fallback: WorkosToolStatus = lowered.includes('error') || lowered.includes('fail')
      ? 'failed'
      : lowered.includes('after') || lowered.includes('complete') || lowered.includes('end')
        ? 'completed'
        : lowered.includes('before') || lowered.includes('start')
          ? 'running'
          : 'pending';
    const status = toolStatus(firstString(properties, ['status', 'state']), fallback);
    const now = Date.now();
    this.emitToolActivity({
      id,
      title: this.readToolTitle(properties, tool),
      status,
      startedAt: status === 'running' ? now : undefined,
      completedAt: status === 'completed' || status === 'failed' ? now : undefined,
    });
  }

  private readToolTitle(primary: UnknownRecord, secondary?: UnknownRecord) {
    const explicitTitle = firstString(primary, ['title', 'name'])
      ?? (secondary ? firstString(secondary, ['title', 'name']) : undefined);
    const toolName = firstString(primary, ['tool'])
      ?? (secondary ? firstString(secondary, ['tool']) : undefined);
    return safeLabel(explicitTitle ?? toolName) ?? '运行工具';
  }

  private emitToolActivity(update: WorkosToolActivity) {
    const previous = this.toolActivities.get(update.id);
    const next: WorkosToolActivity = {
      ...previous,
      ...update,
      title: update.title === '运行工具' && previous ? previous.title : update.title,
      startedAt: update.startedAt ?? previous?.startedAt,
      completedAt: update.completedAt ?? previous?.completedAt,
    };
    this.toolActivities.set(next.id, next);
    this.callbacks.onActivity?.(next);
  }

  private complete() {
    if (this.completed) return;
    this.completed = true;
    this.callbacks.onComplete?.();
  }
}
