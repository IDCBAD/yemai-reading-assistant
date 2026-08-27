import MiniSearch from 'minisearch';
import {
  appendCognitionEvent,
  cognitionFilename,
  cognitionProjection,
  parseCognitionMarkdown,
  renderCognitionMarkdown,
  safeMarkdownSource,
  type ParseResult,
} from './cognitionMarkdown';

export type CognitionType = 'concept' | 'causal-model' | 'judgment-principle' | 'method' | 'decision-basis' | 'hypothesis';
export type CognitionEventType = 'formed' | 'supported' | 'challenged' | 'revised' | 'superseded';

export interface CognitionCandidate {
  schemaVersion: 1;
  type: CognitionType;
  title: string;
  currentUnderstanding: string;
  changedFrom?: string;
  rationale: string;
  boundary: string;
  unresolved?: string;
  question: string;
  confirmation?: string;
  source: {
    conversationId: string;
    messageId: string;
    pageTitle?: string;
    pageUrl?: string;
  };
}

export interface CognitionPageSignal {
  title: string;
  url: string;
  description?: string;
  site?: string;
  headings?: string[];
  selection?: string;
}

export interface CognitionComparisonResult {
  comparisonId?: string;
  cognitionId?: string;
  outcome: 'keep' | 'revise' | 'wait';
  rationale: string;
  revisedUnderstanding?: string;
  support?: string;
  challenge?: string;
  boundaryChange?: string;
  revisedBoundary?: string;
  userReason?: string;
  page?: CognitionPageSignal;
  previousUnderstanding?: string;
  previousBoundary?: string;
}

export interface CognitionComparisonGateway {
  compare(input: {
    cognition: CognitionProjectionRow;
    currentUnderstanding: string;
    boundary: string;
    page: CognitionPageSignal;
    recentEvents: string[];
    signal?: AbortSignal;
  }): Promise<CognitionComparisonResult>;
}

export interface CognitionDirectoryEntry {
  name: string;
  text?: string;
  fingerprint?: string;
}

export interface CognitionDirectory {
  readonly name: string;
  queryPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  read(name: string): Promise<string>;
  write(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  entries(): Promise<CognitionDirectoryEntry[]>;
}

export interface CognitionDirectoryRegistry {
  load(): Promise<CognitionDirectory | undefined>;
  save(handle: CognitionDirectory): Promise<void>;
  clear(): Promise<void>;
}

export interface CognitionProjectionRow {
  id: string;
  filename: string;
  title: string;
  type: string;
  status: string;
  updatedAt: string;
  searchableText: string;
  searchFields?: {
    title: string;
    current: string;
    boundary: string;
    rationale: string;
    unresolved: string;
    sources: string;
    events: string;
  };
  fingerprint: string;
  sourceUrl?: string;
}

export interface CognitionProjection {
  replace(rows: CognitionProjectionRow[]): Promise<void>;
  put(row: CognitionProjectionRow): Promise<void>;
  all(): Promise<CognitionProjectionRow[]>;
}

export type CognitionDirectoryState =
  | { kind: 'unsupported' }
  | { kind: 'unconfigured' }
  | { kind: 'needs-permission'; name: string }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; name?: string; message: string };

export interface CognitionLoopDependencies {
  registry: CognitionDirectoryRegistry;
  projection: CognitionProjection;
  now?: () => Date;
  createId?: () => string;
  comparison?: CognitionComparisonGateway;
}

function issueMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '无法访问认知目录。';
}

function searchTokens(value: string) {
  const tokens: string[] = [];
  for (const segment of value.toLocaleLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(segment) && segment.length > 2) {
      for (let index = 0; index < segment.length - 1; index += 1) tokens.push(segment.slice(index, index + 2));
    } else if (segment.length > 1) {
      tokens.push(segment);
    }
  }
  return [...new Set(tokens)];
}

export class CognitionLoopService {
  private readonly registry: CognitionDirectoryRegistry;
  private readonly projection: CognitionProjection;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly comparison?: CognitionComparisonGateway;

  constructor({
    registry,
    projection,
    now = () => new Date(),
    createId = () => crypto.randomUUID(),
    comparison,
  }: CognitionLoopDependencies) {
    this.registry = registry;
    this.projection = projection;
    this.now = now;
    this.createId = createId;
    this.comparison = comparison;
  }

  async getDirectoryState(): Promise<CognitionDirectoryState> {
    const directory = await this.registry.load();
    if (!directory) return { kind: 'unconfigured' };
    try {
      const permission = await directory.queryPermission();
      return permission === 'granted'
        ? { kind: 'ready', name: directory.name }
        : { kind: 'needs-permission', name: directory.name };
    } catch (error) {
      return { kind: 'error', name: directory.name, message: issueMessage(error) };
    }
  }

  async connectDirectory(
    directory: CognitionDirectory,
    options: { acceptNonEmpty?: boolean } = {},
  ): Promise<CognitionDirectoryState> {
    let probeFilename: string | undefined;
    let probeCreated = false;
    try {
      const permission = await directory.requestPermission();
      if (permission !== 'granted') {
        return { kind: 'needs-permission', name: directory.name };
      }
      const existingEntries = await directory.entries();
      if (existingEntries.length > 0 && !options.acceptNonEmpty) {
        return {
          kind: 'error',
          name: directory.name,
          message: '这个目录已有内容。页脉不会导入它们；确认后只管理带 yemai_id 的认知文件。',
        };
      }
      const probeId = this.createId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'probe';
      probeFilename = `.yemai-write-probe-${this.now().getTime()}-${probeId}.tmp`;
      if (existingEntries.some((entry) => entry.name === probeFilename)) {
        throw new Error('目录中存在同名探针文件，已停止连接以避免覆盖。');
      }
      const probe = `yemai cognition directory probe ${this.now().toISOString()} ${this.createId()}`;
      probeCreated = true;
      await directory.write(probeFilename, probe);
      const readBack = await directory.read(probeFilename);
      if (readBack !== probe) throw new Error('目录写入校验失败。');
      await directory.remove(probeFilename);
      probeCreated = false;
      await this.registry.save(directory);
      return { kind: 'ready', name: directory.name };
    } catch (error) {
      if (probeCreated && probeFilename) await directory.remove(probeFilename).catch(() => undefined);
      return { kind: 'error', name: directory.name, message: issueMessage(error) };
    }
  }

  async reconnectDirectory(): Promise<CognitionDirectoryState> {
    const directory = await this.registry.load();
    if (!directory) return { kind: 'unconfigured' };
    return this.connectDirectory(directory, { acceptNonEmpty: true });
  }

  async disconnectDirectory() {
    await this.registry.clear();
    await this.projection.replace([]);
  }

  private async readyDirectory() {
    const directory = await this.registry.load();
    if (!directory) throw new Error('请先连接认知目录。');
    if (await directory.queryPermission() !== 'granted') throw new Error('认知目录需要重新授权。');
    return directory;
  }

  async confirmCandidate(candidate: CognitionCandidate, edits: { boundary?: string } = {}) {
    const directory = await this.readyDirectory();
    const entries = await directory.entries();
    for (const entry of entries) {
      const parsed = parseCognitionMarkdown(entry.text ?? await directory.read(entry.name));
      if (parsed.kind === 'managed'
        && parsed.cognition.sourceConversationId === candidate.source.conversationId
        && parsed.cognition.sourceMessageId === candidate.source.messageId
        && parsed.cognition.type === candidate.type
        && parsed.cognition.title === candidate.title) {
        const fileFingerprint = entries.find((item) => item.name === entry.name)?.fingerprint;
        await this.projection.put(cognitionProjection(entry.name, parsed.cognition, fileFingerprint));
        return { id: parsed.cognition.id, filename: entry.name, created: false, status: parsed.cognition.status };
      }
    }
    const id = this.createId();
    const at = this.now().toISOString();
    const filename = cognitionFilename(id, candidate.title);
    if (entries.some((entry) => entry.name === filename)) {
      throw new Error('认知文件名发生冲突，已停止写入。');
    }
    const markdown = renderCognitionMarkdown(candidate, id, at, edits.boundary ?? candidate.boundary);
    let parsed: Extract<ParseResult, { kind: 'managed' }>;
    try {
      await directory.write(filename, markdown);
      const readBack = await directory.read(filename);
      const readBackParsed = parseCognitionMarkdown(readBack);
      if (readBackParsed.kind !== 'managed' || readBackParsed.cognition.id !== id) {
        throw new Error('认知写入后校验失败。');
      }
      parsed = readBackParsed;
    } catch (error) {
      await directory.remove(filename).catch(() => undefined);
      throw error;
    }
    const fileFingerprint = (await directory.entries()).find((entry) => entry.name === filename)?.fingerprint;
    await this.projection.put(cognitionProjection(filename, parsed.cognition, fileFingerprint));
    return { id, filename, created: true, status: parsed.cognition.status };
  }

  async rebuildProjection() {
    const directory = await this.readyDirectory();
    const entries = (await directory.entries()).filter((entry) => entry.name.toLowerCase().endsWith('.md'));
    const existingRows = await this.projection.all();
    const existingByFilename = new Map(existingRows.map((row) => [row.filename, row]));
    type ScannedEntry =
      | { entry: CognitionDirectoryEntry; row: CognitionProjectionRow }
      | { entry: CognitionDirectoryEntry; parsed: ParseResult };
    const parsedEntries = await Promise.all(entries.map(async (entry): Promise<ScannedEntry> => {
      const existing = existingByFilename.get(entry.name);
      if (entry.fingerprint && existing?.fingerprint === entry.fingerprint) {
        return { entry, row: existing };
      }
      const text = entry.text ?? await directory.read(entry.name);
      return { entry, parsed: parseCognitionMarkdown(text) };
    }));
    const counts = new Map<string, number>();
    for (const item of parsedEntries) {
      const id = 'row' in item
        ? item.row.id
        : item.parsed.kind === 'managed'
          ? item.parsed.cognition.id
          : undefined;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const rows: CognitionProjectionRow[] = [];
    const issues: Array<{ filename: string; kind: 'malformed' | 'duplicate-id'; message: string }> = [];
    for (const item of parsedEntries) {
      const { entry } = item;
      if ('row' in item) {
        if ((counts.get(item.row.id) ?? 0) > 1) {
          issues.push({ filename: entry.name, kind: 'duplicate-id', message: `重复 yemai_id: ${item.row.id}` });
        } else {
          rows.push(item.row);
        }
        continue;
      }
      const { parsed } = item;
      if (parsed.kind === 'ordinary') continue;
      if (parsed.kind === 'malformed') {
        issues.push({ filename: entry.name, kind: 'malformed', message: parsed.message });
        continue;
      }
      if ((counts.get(parsed.cognition.id) ?? 0) > 1) {
        issues.push({ filename: entry.name, kind: 'duplicate-id', message: `重复 yemai_id: ${parsed.cognition.id}` });
        continue;
      }
      rows.push(cognitionProjection(entry.name, parsed.cognition, entry.fingerprint));
    }
    await this.projection.replace(rows);
    return { indexed: rows.length, issues, availableIds: rows.map((row) => row.id) };
  }

  async findReencounters(page: CognitionPageSignal) {
    const site = page.site ?? (() => {
      try { return new URL(page.url).hostname; } catch { return ''; }
    })();
    const query = [page.title, site, page.description, ...(page.headings ?? []), page.selection].filter(Boolean).join(' ');
    const conflictSignal = /反例|冲突|质疑|挑战|推翻/.test(query);
    const rows = (await this.projection.all())
      .filter((row) => ['current', 'awaiting-validation', 'contested'].includes(row.status) && row.sourceUrl !== page.url);
    const search = new MiniSearch({
      fields: ['title', 'current', 'boundary', 'rationale', 'unresolved', 'sources', 'events'],
      storeFields: [],
      tokenize: searchTokens,
      processTerm: (term) => term.toLocaleLowerCase(),
      searchOptions: {
        boost: { title: 6, current: 5, boundary: 3, rationale: 2, unresolved: 1.6, sources: 1.2, events: 1 },
        prefix: true,
        combineWith: 'OR',
      },
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    search.addAll(rows.map((row) => ({ id: row.id, ...(row.searchFields ?? {
      title: row.title,
      current: row.searchableText,
      boundary: '', rationale: '', unresolved: '', sources: '', events: '',
    }) })));
    const fieldLabels: Record<string, string> = {
      title: '标题', current: '当前理解', boundary: '适用边界', rationale: '形成依据',
      unresolved: '待验证问题', sources: '来源', events: '演化记录',
    };
    return search.search(query)
      .map((hit) => {
        const row = rowsById.get(String(hit.id));
        if (!row) return undefined;
        const matchedFields = [...new Set(Object.values(hit.match).flat())].map((field) => fieldLabels[field] ?? field);
        const matchedTerms = [...new Set(hit.terms)].slice(0, 5);
        const level = conflictSignal && hit.score >= 2 ? 'conflict' as const : hit.score >= 5 ? 'strong' as const : 'weak' as const;
        return {
          ...row,
          score: hit.score,
          level,
          matchedTerms,
          matchedFields,
          reason: `${matchedFields.join('、') || '内容'}出现相关线索：${matchedTerms.join('、')}`,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== undefined && row.score > 0)
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 3);
  }

  async compareWithPage(cognitionId: string, page: CognitionPageSignal, signal?: AbortSignal) {
    if (!this.comparison) throw new Error('当前未配置认知对照 Agent。');
    const cognition = (await this.projection.all()).find((row) => row.id === cognitionId);
    if (!cognition) throw new Error('找不到要对照的认知。');
    const directory = await this.readyDirectory();
    const parsed = parseCognitionMarkdown(await directory.read(cognition.filename));
    if (parsed.kind !== 'managed' || parsed.cognition.id !== cognitionId || parsed.cognition.type !== cognition.type) {
      throw new Error('认知身份或类型已被外部修改，无法进行对照。');
    }
    const recentEvents = parsed.cognition.sections.evolution.split('\n').filter(Boolean).slice(-5);
    const result = await this.comparison.compare({
      cognition,
      currentUnderstanding: parsed.cognition.sections.current,
      boundary: parsed.cognition.sections.boundary,
      page,
      recentEvents,
      signal,
    });
    if (!['keep', 'revise', 'wait'].includes(result.outcome)) throw new Error('Agent 返回了不受支持的对照结果。');
    return {
      ...result,
      cognitionId,
      comparisonId: result.comparisonId ?? this.createId(),
      page,
      previousUnderstanding: parsed.cognition.sections.current,
      previousBoundary: parsed.cognition.sections.boundary,
    };
  }

  async recordComparisonOutcome(cognitionId: string, result: CognitionComparisonResult) {
    if (result.cognitionId && result.cognitionId !== cognitionId) throw new Error('对照结果与认知不匹配。');
    const directory = await this.readyDirectory();
    const row = (await this.projection.all()).find((item) => item.id === cognitionId);
    if (!row) throw new Error('找不到要更新的认知。');
    const markdown = await directory.read(row.filename);
    const currentFile = parseCognitionMarkdown(markdown);
    if (currentFile.kind !== 'managed' || currentFile.cognition.id !== cognitionId || currentFile.cognition.type !== row.type) {
      throw new Error('认知身份或类型已被外部修改，已停止写入。');
    }
    const currentUnderstanding = currentFile.cognition.sections.current;
    const currentBoundary = currentFile.cognition.sections.boundary;
    const comparisonId = result.comparisonId
      ?? `${cognitionId}-${result.outcome}-${result.rationale}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
    const eventMarker = `<!-- yemai:event:${comparisonId} -->`;
    if (markdown.includes(eventMarker)) {
      return { id: cognitionId, eventType: result.outcome === 'keep' ? 'supported' as const : result.outcome === 'revise' ? 'revised' as const : 'challenged' as const, updatedAt: row.updatedAt, duplicate: true };
    }
    if (result.previousUnderstanding !== undefined && result.previousUnderstanding !== currentUnderstanding) {
      throw new Error('认知在对照后被外部修改，请重新对照后再决定。');
    }
    if (result.previousBoundary !== undefined && result.previousBoundary !== currentBoundary) {
      throw new Error('认知边界在对照后被外部修改，请重新对照后再决定。');
    }
    if (result.outcome === 'revise' && !result.revisedUnderstanding?.trim() && !result.revisedBoundary?.trim()) {
      throw new Error('修订至少需要新的当前理解或适用边界。');
    }
    const at = this.now().toISOString();
    const eventType: CognitionEventType = result.outcome === 'keep'
      ? 'supported'
      : result.outcome === 'revise'
        ? 'revised'
        : 'challenged';
    const source = result.page
      ? safeMarkdownSource(result.page.title, result.page.url) ?? result.page.title.replace(/[\[\]]/g, '')
      : '当前材料';
    const analysis = [
      result.support ? `支持：${result.support}` : '',
      result.challenge ? `挑战：${result.challenge}` : '',
      result.boundaryChange ? `边界变化：${result.boundaryChange}` : '',
      `判断：${result.rationale}`,
    ].filter(Boolean).join('；');
    const transition = result.outcome === 'revise' && result.revisedUnderstanding
      ? `；从「${currentUnderstanding}」修订为「${result.revisedUnderstanding}」`
      : `；原理解保持为「${currentUnderstanding}」`;
    const boundaryTransition = result.outcome === 'revise' && result.revisedBoundary
      ? `；边界从「${currentBoundary}」修订为「${result.revisedBoundary}」`
      : `；原边界保持为「${currentBoundary}」`;
    const resultingStatus = result.outcome === 'wait' ? 'awaiting-validation' : 'current';
    const userReason = result.userReason?.trim() || `用户确认${result.outcome === 'keep' ? '保留当前理解' : result.outcome === 'revise' ? '应用修订' : '等待更多证据'}。`;
    const next = appendCognitionEvent(
      markdown,
      at,
      eventType,
      `事件 ID：${comparisonId}；来源：${source}；用户理由：${userReason}；${analysis}${transition}${boundaryTransition}；结果状态：${resultingStatus} ${eventMarker}`,
      {
        revisedUnderstanding: result.revisedUnderstanding,
        revisedBoundary: result.revisedBoundary,
        unresolved: result.outcome === 'wait' ? (result.challenge || result.rationale) : undefined,
        status: resultingStatus,
      },
    );
    await directory.write(row.filename, next);
    const readBack = await directory.read(row.filename);
    const parsed = parseCognitionMarkdown(readBack);
    if (parsed.kind !== 'managed' || parsed.cognition.id !== cognitionId) throw new Error('认知更新后校验失败。');
    const fileFingerprint = (await directory.entries()).find((entry) => entry.name === row.filename)?.fingerprint;
    await this.projection.put(cognitionProjection(row.filename, parsed.cognition, fileFingerprint));
    return { id: cognitionId, eventType, updatedAt: at };
  }

  async getCognitionDetails(cognitionId: string) {
    const directory = await this.readyDirectory();
    const row = (await this.projection.all()).find((item) => item.id === cognitionId);
    if (!row) throw new Error('找不到这条认知。');
    const parsed = parseCognitionMarkdown(await directory.read(row.filename));
    if (parsed.kind !== 'managed' || parsed.cognition.id !== cognitionId || parsed.cognition.type !== row.type) {
      throw new Error('认知身份或类型已被外部修改，无法展示详情。');
    }
    return {
      id: cognitionId,
      filename: row.filename,
      status: parsed.cognition.status,
      currentUnderstanding: parsed.cognition.sections.current,
      events: parsed.cognition.sections.evolution.split('\n').filter(Boolean),
    };
  }
}
