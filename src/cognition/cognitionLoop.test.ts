import { describe, expect, it } from 'vitest';
import {
  CognitionLoopService,
  type CognitionCandidate,
  type CognitionComparisonGateway,
  type CognitionDirectory,
  type CognitionDirectoryEntry,
  type CognitionDirectoryRegistry,
  type CognitionProjection,
} from './cognitionLoop';

class MemoryDirectory implements CognitionDirectory {
  readonly files = new Map<string, string>();
  permission: PermissionState = 'granted';

  constructor(readonly name = 'cognition') {}

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    return this.permission;
  }

  async read(name: string) {
    const value = this.files.get(name);
    if (value === undefined) throw new DOMException('Missing', 'NotFoundError');
    return value;
  }

  async write(name: string, value: string) {
    this.files.set(name, value);
  }

  async remove(name: string) {
    this.files.delete(name);
  }

  async entries(): Promise<CognitionDirectoryEntry[]> {
    return [...this.files].map(([name, text]) => ({ name, text }));
  }
}

class FingerprintDirectory extends MemoryDirectory {
  reads = 0;

  override async read(name: string) {
    this.reads += 1;
    return super.read(name);
  }

  override async entries(): Promise<CognitionDirectoryEntry[]> {
    return [...this.files].map(([name, text]) => ({ name, fingerprint: `length:${text.length}` }));
  }
}

class MemoryRegistry implements CognitionDirectoryRegistry {
  handle?: CognitionDirectory;

  async load() {
    return this.handle;
  }

  async save(handle: CognitionDirectory) {
    this.handle = handle;
  }

  async clear() {
    this.handle = undefined;
  }
}

class MemoryProjection implements CognitionProjection {
  rows = new Map<string, Parameters<CognitionProjection['put']>[0]>();

  async replace(rows: Parameters<CognitionProjection['put']>[0][]) {
    this.rows = new Map(rows.map((row) => [row.id, row]));
  }

  async put(row: Parameters<CognitionProjection['put']>[0]) {
    this.rows.set(row.id, row);
  }

  async all() {
    return [...this.rows.values()];
  }
}

describe('CognitionLoopService directory connection', () => {
  it('probes write/read/delete before persisting the selected directory', async () => {
    const directory = new MemoryDirectory('我的认知');
    const registry = new MemoryRegistry();
    const service = new CognitionLoopService({
      registry,
      projection: new MemoryProjection(),
      now: () => new Date('2026-08-27T08:00:00.000Z'),
      createId: () => 'cognition-1',
    });

    expect(await service.getDirectoryState()).toEqual({ kind: 'unconfigured' });
    expect(await service.connectDirectory(directory)).toEqual({
      kind: 'ready',
      name: '我的认知',
    });
    expect(registry.handle).toBe(directory);
    expect(directory.files.size).toBe(0);

    await service.disconnectDirectory();
    expect(await service.getDirectoryState()).toEqual({ kind: 'unconfigured' });
    expect(directory.files.size).toBe(0);
  });

  it('keeps a remembered handle visible when Chrome requires permission again', async () => {
    const directory = new MemoryDirectory('我的认知');
    directory.permission = 'prompt';
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const service = new CognitionLoopService({ registry, projection: new MemoryProjection() });

    expect(await service.getDirectoryState()).toEqual({
      kind: 'needs-permission',
      name: '我的认知',
    });
  });

  it('reconnects an existing non-empty cognition directory without treating it as a new selection', async () => {
    const directory = new MemoryDirectory('我的认知');
    directory.files.set('existing.md', '# existing');
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const service = new CognitionLoopService({ registry, projection: new MemoryProjection() });

    expect(await service.reconnectDirectory()).toEqual({ kind: 'ready', name: '我的认知' });
    expect(directory.files.get('existing.md')).toBe('# existing');
  });

  it('never overwrites or removes a pre-existing file while probing a non-empty directory', async () => {
    const directory = new MemoryDirectory('我的认知');
    directory.files.set('.yemai-write-probe.md', '用户自己的内容');
    const registry = new MemoryRegistry();
    const service = new CognitionLoopService({
      registry,
      projection: new MemoryProjection(),
      now: () => new Date('2026-08-27T08:00:00.000Z'),
      createId: () => 'probe-1',
    });

    expect(await service.connectDirectory(directory, { acceptNonEmpty: true })).toMatchObject({ kind: 'ready' });
    expect(directory.files.get('.yemai-write-probe.md')).toBe('用户自己的内容');
    expect([...directory.files.keys()]).toEqual(['.yemai-write-probe.md']);
  });
});

function judgmentCandidate(): CognitionCandidate {
  return {
    schemaVersion: 1,
    type: 'judgment-principle',
    title: '先验证关键约束，再扩展功能',
    currentUnderstanding: '当一个能力依赖浏览器权限时，应先验证权限是否能稳定恢复。',
    changedFrom: '过去我会先把完整流程做出来。',
    rationale: '权限不可恢复会让后续所有功能失去基础。',
    boundary: '适用于依赖本地文件系统权限的浏览器工具。',
    unresolved: '不同 Chromium 版本的恢复行为仍需实测。',
    question: '这个原则的适用边界准确吗？',
    source: {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      pageTitle: 'File System Access API',
      pageUrl: 'https://developer.chrome.com/docs/capabilities/web-apis/file-system-access',
    },
  };
}

describe('CognitionLoopService cognition lifecycle', () => {
  it('writes, reads back and projects a confirmed cognition idempotently', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({
      registry,
      projection,
      now: () => new Date('2026-08-27T08:00:00.000Z'),
      createId: () => 'cognition-1',
    });

    const first = await service.confirmCandidate(judgmentCandidate(), {
      boundary: '只适用于权限会影响核心可行性的浏览器工具。',
    });
    const second = await service.confirmCandidate(judgmentCandidate(), {
      boundary: '只适用于权限会影响核心可行性的浏览器工具。',
    });

    expect(first).toMatchObject({ id: 'cognition-1', created: true, status: 'current' });
    expect(second).toMatchObject({ id: 'cognition-1', created: false });
    expect(directory.files.size).toBe(1);
    const markdown = [...directory.files.values()][0] ?? '';
    expect(markdown).toContain('yemai_id: cognition-1');
    expect(markdown).toContain('只适用于权限会影响核心可行性的浏览器工具。');
    expect(markdown).toContain('`formed`');
    expect(projection.rows.get('cognition-1')).toMatchObject({
      title: '先验证关键约束，再扩展功能',
      type: 'judgment-principle',
      status: 'current',
    });

    await projection.replace([]);
    const repaired = await service.confirmCandidate(judgmentCandidate());
    expect(repaired).toMatchObject({ created: false, id: 'cognition-1' });
    expect(projection.rows.has('cognition-1')).toBe(true);
  });

  it('reuses unchanged fingerprints and rereads only changed Markdown', async () => {
    const directory = new FingerprintDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({ registry, projection, createId: () => 'cognition-fingerprint' });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    await projection.replace([]);
    directory.reads = 0;

    await service.rebuildProjection();
    expect(directory.reads).toBe(1);
    directory.reads = 0;
    await service.rebuildProjection();
    expect(directory.reads).toBe(0);

    directory.files.set(receipt.filename, `${await directory.read(receipt.filename)}\n外部补充`);
    directory.reads = 0;
    await service.rebuildProjection();
    expect(directory.reads).toBe(1);
  });

  it('rebuilds the projection from managed Markdown and reports unsafe files read-only', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({ registry, projection, createId: () => 'cognition-1' });
    await service.confirmCandidate(judgmentCandidate());
    directory.files.set('duplicate.md', [...directory.files.values()][0] ?? '');
    directory.files.set('broken.md', '---\nyemai_id: broken\n---\n普通内容');
    directory.files.set('ordinary.md', '# 我自己的普通笔记');

    const result = await service.rebuildProjection();

    expect(result.indexed).toBe(0);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: 'duplicate.md', kind: 'duplicate-id' }),
      expect.objectContaining({ filename: 'broken.md', kind: 'malformed' }),
    ]));
    expect(result.issues.some((issue) => issue.filename === 'ordinary.md')).toBe(false);
  });

  it('matches at most three local cognitions and excludes the source page', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({ registry, projection });
    await projection.put({
      id: 'same-source', filename: 'same.md', title: '权限恢复', type: 'concept', status: 'current',
      updatedAt: '2026-08-27T08:00:00.000Z', fingerprint: '1',
      sourceUrl: 'https://same.example/page',
      searchableText: '权限恢复 Chrome File System Access https://same.example/page',
    });
    for (let index = 1; index <= 5; index += 1) {
      await projection.put({
        id: `other-${index}`, filename: `other-${index}.md`, title: `本地权限原则 ${index}`,
        type: 'judgment-principle', status: 'current', updatedAt: `2026-08-2${index}T08:00:00.000Z`,
        fingerprint: String(index), searchableText: `Chrome 本地文件 权限 恢复 原则 ${index}`,
      });
    }

    const matches = await service.findReencounters({
      title: 'Chrome 本地文件权限恢复',
      url: 'https://same.example/page',
      description: 'File System Access 权限原则',
    });

    expect(matches).toHaveLength(3);
    expect(matches.some((item) => item.id === 'same-source')).toBe(false);
    expect(matches[0]).toMatchObject({ reason: expect.stringContaining('相关') });
  });

  it('keeps comparison transient until the user records an outcome', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const comparison: CognitionComparisonGateway = {
      compare: async () => ({
        outcome: 'revise',
        rationale: '真实使用表明，权限并非所有场景的第一约束。',
        revisedUnderstanding: '先验证会决定产品可行性的关键约束。',
      }),
    };
    const service = new CognitionLoopService({
      registry,
      projection,
      comparison,
      now: () => new Date('2026-08-28T08:00:00.000Z'),
      createId: () => 'cognition-1',
    });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    const initial = await directory.read(receipt.filename);
    await directory.write(receipt.filename, initial.replace('yemai_schema: 1', 'yemai_schema: 1\nmy_custom_field: keep-me'));
    const before = await directory.read(receipt.filename);

    const result = await service.compareWithPage(receipt.id, {
      title: '何时应该先做可行性验证', url: 'https://example.com/feasibility', description: '实践案例',
    });
    expect(await directory.read(receipt.filename)).toBe(before);

    const event = await service.recordComparisonOutcome(receipt.id, result);
    const duplicate = await service.recordComparisonOutcome(receipt.id, result);
    const after = await directory.read(receipt.filename);
    expect(event).toMatchObject({ eventType: 'revised', id: 'cognition-1' });
    expect(duplicate).toMatchObject({ duplicate: true, id: 'cognition-1' });
    expect(after).toContain('先验证会决定产品可行性的关键约束。');
    expect(after).toContain('`revised`');
    expect(after).toContain('my_custom_field: keep-me');
  });

  it('can revise the applicability boundary without replacing the current understanding', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({
      registry,
      projection,
      comparison: {
        compare: async () => ({
          outcome: 'revise',
          rationale: '新材料只改变适用范围。',
          revisedBoundary: '只适用于本地文件权限决定核心可行性的浏览器工具。',
        }),
      },
      createId: () => 'cognition-boundary',
    });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    const before = await service.getCognitionDetails(receipt.id);
    const result = await service.compareWithPage(receipt.id, { title: '边界案例', url: 'https://example.com/boundary' });
    await service.recordComparisonOutcome(receipt.id, { ...result, userReason: '只需收窄边界。' });
    const after = await directory.read(receipt.filename);

    expect(after).toContain(before.currentUnderstanding);
    expect(after).toContain('只适用于本地文件权限决定核心可行性的浏览器工具。');
    expect(after).toContain('边界从');
  });

  it('continues to read and update CRLF Markdown edited by Obsidian', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const comparison: CognitionComparisonGateway = {
      compare: async () => ({ outcome: 'keep', rationale: '新材料继续支持原判断。' }),
    };
    const service = new CognitionLoopService({
      registry,
      projection,
      comparison,
      createId: () => 'cognition-crlf',
      now: () => new Date('2026-08-29T08:00:00.000Z'),
    });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    const edited = (await directory.read(receipt.filename))
      .replace('yemai_schema: 1', 'yemai_schema: 1\nobsidian_alias: 保留')
      .replace(/\n/g, '\r\n');
    await directory.write(receipt.filename, edited);

    await service.rebuildProjection();
    const result = await service.compareWithPage(receipt.id, { title: '支持案例', url: 'https://example.com/support' });
    await service.recordComparisonOutcome(receipt.id, result);

    const updated = await directory.read(receipt.filename);
    expect(updated).toContain('\r\nobsidian_alias: 保留\r\n');
    expect(updated).toContain('`supported`');
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('does not mutate a file whose stable identity changed after comparison', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({
      registry,
      projection,
      comparison: { compare: async () => ({ outcome: 'keep', rationale: '仍然成立。' }) },
      createId: () => 'cognition-safe-write',
    });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    const result = await service.compareWithPage(receipt.id, { title: '权限恢复案例', url: 'https://example.com/case' });
    const externallyChanged = (await directory.read(receipt.filename)).replace('yemai_id: cognition-safe-write', 'yemai_id: another-valid-id');
    await directory.write(receipt.filename, externallyChanged);

    await expect(service.recordComparisonOutcome(receipt.id, result)).rejects.toThrow('身份或类型已被外部修改');
    expect(await directory.read(receipt.filename)).toBe(externallyChanged);
  });

  it('keeps awaiting-validation cognitions eligible for restrained resurfacing', async () => {
    const directory = new MemoryDirectory();
    const registry = new MemoryRegistry();
    registry.handle = directory;
    const projection = new MemoryProjection();
    const service = new CognitionLoopService({
      registry,
      projection,
      comparison: { compare: async () => ({ outcome: 'wait', rationale: '仍需观察权限恢复证据。', challenge: '不同版本表现不一致。' }) },
      createId: () => 'cognition-wait',
    });
    const receipt = await service.confirmCandidate(judgmentCandidate());
    const result = await service.compareWithPage(receipt.id, { title: '浏览器权限恢复', url: 'https://example.com/first' });
    await service.recordComparisonOutcome(receipt.id, { ...result, userReason: '样本还不够。' });

    const matches = await service.findReencounters({
      title: 'Chrome 本地文件权限恢复',
      url: 'https://example.com/second',
      description: '权限恢复的新案例',
    });
    expect(matches.some((match) => match.id === receipt.id)).toBe(true);
    expect((await projection.all()).find((row) => row.id === receipt.id)?.status).toBe('awaiting-validation');
  });
});
