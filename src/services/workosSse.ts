import type { CognitionType } from '../cognition/cognitionLoop';

export interface WorkosSseCallbacks {
  onText: (text: string) => void;
  onActivity?: (activity: WorkosToolActivity) => void;
  onArtifact?: (artifact: WorkosArtifact) => void;
  onInterrupt?: (interrupt: WorkosA2uiInterrupt) => void;
  onInterruptResolution?: (resolution: WorkosInterruptResolution) => void;
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

export type WorkosA2uiField =
  | {
      type: 'text';
      label: string;
      defaultValue: string;
    }
  | {
      type: 'single-select';
      label: string;
      defaultValue: string;
      options: string[];
    }
  | {
      type: 'multi-select';
      label: string;
      defaultValue: string[];
      options: string[];
    };

/** Safe, allow-listed projection of a WorkOS A2UI interrupt. */
export interface WorkosA2uiInterrupt {
  id: string;
  sessionId: string;
  title: string;
  fields: WorkosA2uiField[];
  toolMessageId?: string;
  toolCallId?: string;
  purpose?: 'cognition-candidate';
  purposeVersion?: 1;
  cognitionCandidate?: {
    type: CognitionType;
    title: string;
    currentUnderstanding: string;
    changedFrom?: string;
    rationale: string;
    boundary: string;
    unresolved?: string;
    question: string;
  };
}

export interface WorkosInterruptResolution {
  requestId: string;
  sessionId: string;
  outcome: 'replied' | 'rejected';
  data?: Record<string, string | string[]>;
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

function safeText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').slice(0, maximumLength);
}

function safeObjectKey(value: string | undefined) {
  const key = safeLabel(value)?.slice(0, 180);
  return key && !['__proto__', 'constructor', 'prototype'].includes(key) ? key : undefined;
}

function safeIdentifier(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const identifier = value.trim();
  if (!identifier || identifier.length > 160 || !/^[A-Za-z0-9_-]+$/.test(identifier)) return undefined;
  return identifier;
}

function projectA2uiOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of value.slice(0, 24)) {
    const rawLabel = isRecord(candidate) ? candidate.label : candidate;
    const label = safeLabel(typeof rawLabel === 'string' ? rawLabel : undefined)?.slice(0, 120);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push(label);
  }
  return options;
}

function projectA2uiField(value: unknown): WorkosA2uiField | undefined {
  if (!isRecord(value)) return undefined;
  const type = firstString(value, ['type']);
  const label = safeObjectKey(firstString(value, ['label']));
  if (!type || !label) return undefined;
  if (type === 'text') {
    return { type, label, defaultValue: safeText(value.default, 4_000) };
  }
  if (type === 'single-select') {
    const options = projectA2uiOptions(value.options);
    if (!options.length) return undefined;
    const fallback = safeText(value.default, 120);
    return { type, label, options, defaultValue: options.includes(fallback) ? fallback : '' };
  }
  if (type === 'multi-select') {
    const options = projectA2uiOptions(value.options);
    if (!options.length) return undefined;
    const rawDefaults = Array.isArray(value.default) ? value.default : [];
    const defaultValue = rawDefaults
      .filter((item): item is string => typeof item === 'string' && options.includes(item))
      .slice(0, options.length);
    return { type, label, options, defaultValue: [...new Set(defaultValue)] };
  }
  return undefined;
}

const COGNITION_TYPES = new Set<CognitionType>([
  'concept',
  'causal-model',
  'judgment-principle',
  'method',
  'decision-basis',
  'hypothesis',
]);

function projectCognitionCandidate(payload: UnknownRecord) {
  if (payload.purpose !== 'cognition-candidate' || payload.purposeVersion !== 1 || !isRecord(payload.cognition)) {
    return undefined;
  }
  const candidate = payload.cognition;
  const type = firstString(candidate, ['type']) as CognitionType | undefined;
  const title = safeText(candidate.title, 160).trim();
  const currentUnderstanding = safeText(candidate.currentUnderstanding, 4_000).trim();
  const rationale = safeText(candidate.rationale, 4_000).trim();
  const boundary = safeText(candidate.boundary, 4_000).trim();
  const question = safeText(candidate.question, 240).trim();
  if (!type || !COGNITION_TYPES.has(type) || !title || !currentUnderstanding || !rationale || !boundary || !question) {
    return undefined;
  }
  const changedFrom = safeText(candidate.changedFrom, 4_000).trim();
  const unresolved = safeText(candidate.unresolved, 4_000).trim();
  return {
    type,
    title,
    currentUnderstanding,
    ...(changedFrom ? { changedFrom } : {}),
    rationale,
    boundary,
    ...(unresolved ? { unresolved } : {}),
    question,
  };
}

function projectA2uiInterrupt(properties: UnknownRecord): WorkosA2uiInterrupt | undefined {
  if (firstString(properties, ['type']) !== 'a2ui') return undefined;
  const id = safeIdentifier(properties.id);
  const sessionId = safeIdentifier(properties.sessionID ?? properties.sessionId);
  const payload = isRecord(properties.payload) ? properties.payload : undefined;
  if (!id || !sessionId || !payload || !Array.isArray(payload.fields)) return undefined;
  const seenLabels = new Set<string>();
  const fields = payload.fields.slice(0, 12).flatMap((value) => {
    const field = projectA2uiField(value);
    if (!field || seenLabels.has(field.label)) return [];
    seenLabels.add(field.label);
    return [field];
  });
  if (!fields.length) return undefined;
  const tool = isRecord(properties.tool) ? properties.tool : undefined;
  const cognitionCandidate = projectCognitionCandidate(payload);
  const validCognitionCandidate = cognitionCandidate && fields.length === 1 && fields[0]?.type === 'text'
    ? cognitionCandidate
    : undefined;
  return {
    id,
    sessionId,
    title: safeLabel(firstString(payload, ['title']))?.slice(0, 120) ?? '需要你的选择',
    fields,
    ...(validCognitionCandidate ? {
      purpose: 'cognition-candidate' as const,
      purposeVersion: 1 as const,
      cognitionCandidate: validCognitionCandidate,
    } : {}),
    ...(tool && safeIdentifier(tool.messageID ?? tool.messageId)
      ? { toolMessageId: safeIdentifier(tool.messageID ?? tool.messageId) }
      : {}),
    ...(tool && safeIdentifier(tool.callID ?? tool.callId)
      ? { toolCallId: safeIdentifier(tool.callID ?? tool.callId) }
      : {}),
  };
}

function projectInterruptReplyData(value: unknown) {
  if (!isRecord(value)) return undefined;
  const data: Record<string, string | string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 12)) {
    const key = safeObjectKey(rawKey);
    if (!key) continue;
    if (typeof rawValue === 'string') {
      data[key] = safeText(rawValue, 4_000);
      continue;
    }
    if (Array.isArray(rawValue)) {
      data[key] = rawValue
        .filter((item): item is string => typeof item === 'string')
        .map((item) => safeText(item, 120))
        .filter(Boolean)
        .slice(0, 24);
    }
  }
  return data;
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
  private partMessageIds = new Map<string, string>();
  private messagePartOrder = new Map<string, string[]>();
  private messageOrder: string[] = [];
  private messageFinishes = new Map<string, string>();
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

    if (eventType === 'interrupt') {
      const interrupt = projectA2uiInterrupt(properties);
      if (interrupt) this.callbacks.onInterrupt?.(interrupt);
      return;
    }

    if (eventType === 'interrupt.replied' || eventType === 'interrupt.rejected') {
      const requestId = safeIdentifier(properties.requestID ?? properties.requestId);
      const sessionId = safeIdentifier(properties.sessionID ?? properties.sessionId);
      if (!requestId || !sessionId) return;
      const outcome = eventType === 'interrupt.replied' ? 'replied' : 'rejected';
      this.callbacks.onInterruptResolution?.({
        requestId,
        sessionId,
        outcome,
        ...(outcome === 'replied' ? { data: projectInterruptReplyData(properties.data) ?? {} } : {}),
      });
      return;
    }

    if (eventType === 'message.updated') {
      const info = isRecord(properties.info)
        ? properties.info
        : isRecord(properties.message)
          ? properties.message
          : properties;
      const messageId = firstString(info, ['id', 'messageID', 'messageId'])
        ?? firstString(properties, ['messageID', 'messageId']);
      const finish = firstString(info, ['finish', 'finishReason', 'status'])
        ?? firstString(properties, ['finish', 'finishReason']);
      if (messageId) {
        this.rememberMessage(messageId);
        if (finish) this.messageFinishes.set(messageId, finish.toLowerCase());
        this.emitText();
      }
      return;
    }

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
      this.rememberTextPart(
        partId,
        firstString(part, ['messageID', 'messageId'])
          ?? firstString(properties, ['messageID', 'messageId'])
          ?? '__legacy__',
      );
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
      const messageId = firstString(properties, ['messageID', 'messageId'])
        ?? this.partMessageIds.get(partId)
        ?? '__legacy__';
      this.rememberTextPart(partId, messageId);
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
    const visibleMessageId = [...this.messageOrder].reverse().find((messageId) => {
      const finish = this.messageFinishes.get(messageId)?.replace(/[\s_]/g, '-');
      return finish !== 'tool-calls' && (this.messagePartOrder.get(messageId)?.length ?? 0) > 0;
    });
    const text = visibleMessageId
      ? (this.messagePartOrder.get(visibleMessageId) ?? [])
          .map((partId) => this.textParts.get(partId) ?? '')
          .join('')
      : '';
    this.callbacks.onText(text);
  }

  private rememberMessage(messageId: string) {
    if (!this.messageOrder.includes(messageId)) this.messageOrder.push(messageId);
  }

  private rememberTextPart(partId: string, messageId: string) {
    this.partMessageIds.set(partId, messageId);
    this.rememberMessage(messageId);
    const order = this.messagePartOrder.get(messageId) ?? [];
    if (!order.includes(partId)) this.messagePartOrder.set(messageId, [...order, partId]);
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
    if (!this.isQuestionTool(part, state)) {
      this.emitToolActivity({ id, title, status, startedAt, completedAt });
    }

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
    if (this.isQuestionTool(properties, tool)) return;
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

  private isQuestionTool(primary: UnknownRecord, secondary?: UnknownRecord) {
    const toolName = firstString(primary, ['tool'])
      ?? (secondary ? firstString(secondary, ['tool']) : undefined)
      ?? firstString(primary, ['name'])
      ?? (secondary ? firstString(secondary, ['name']) : undefined);
    return toolName?.trim().toLowerCase() === 'question';
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
