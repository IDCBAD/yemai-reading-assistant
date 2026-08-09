export interface WorkosSseCallbacks {
  onText: (text: string) => void;
  onActivity?: (activity: WorkosToolActivity) => void;
  onComplete?: () => void;
  onError?: (message: string) => void;
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
  private completed = false;

  constructor(private readonly callbacks: WorkosSseCallbacks) {}

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

    const payload = unwrapPayload(parseJson(data));
    if (!isRecord(payload)) return;
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
