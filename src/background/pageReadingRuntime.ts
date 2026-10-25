import { isActiveWorkosConnectionConfigured, validateAgentUuid, type WorkosConnectionSettings } from '../services/workosConnection';
import {
  WORKOS_API_ORIGIN, WORKOS_INTERNAL_V2_BASE_URL, WorkosProgressDisconnected, type WorkosTransport,
} from '../services/workosTransport';
import {
  buildPageReadingPrompt, MAX_PAGE_READING_OUTPUT_LENGTH, pageReadingKey, pageReadingTaskView,
  parsePageReadingAnalysis, validatePageReadingSnapshot, type PageReadingTask,
} from '../shared/pageReadingFocus';
import { buildPageReadingExpressionsPrompt, parsePageReadingExpressionsAnalysis } from '../shared/readingExpressions';
import type { PageReadingRepository } from '../data/pageReadingRepository';
import { normalizeSourceIdentityUrl } from '../content/pageManifest';

export interface PageReadingSender {
  id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number; url?: string };
}
export interface PageReadingRuntimeDependencies {
  extensionId: string;
  repository: Pick<PageReadingRepository, 'get' | 'put' | 'claim' | 'listUnfinished' | 'prune'>;
  loadConnection(): Promise<WorkosConnectionSettings>;
  createTransport(connection: WorkosConnectionSettings): WorkosTransport;
  keepAlive?(): Promise<unknown>;
  now?(): number;
  timeoutMs?: number;
  stopTimeoutMs?: number;
}
interface Running {
  task: PageReadingTask;
  controller: AbortController;
  transport: WorkosTransport;
  executing: boolean;
  terminal: boolean;
  finished: boolean;
  stopRequested: boolean;
  prohibited?: string;
  saveTail: Promise<void>;
  storageError?: boolean;
  stopPromise?: Promise<void>;
  interrupt(error: Error): void;
}
const failure = (error: string) => ({ ok: false as const, error });
const STORAGE_ERROR = '无法保存文章分析状态，已暂停新的分析。请检查本地存储后重新加载扩展；已提交任务的远端状态可能未确认。';
const UNKNOWN = '分析连接已结束，但远端任务状态未确认。请先在 WorkOS 查看，当前文章不会自动重新提交。';
const response = (task: PageReadingTask) => ({ ok: true as const, task: pageReadingTaskView(task) });

/** One durable task per article and target. UI exit/tab lifetime deliberately do not cancel it. */
export function createPageReadingRuntime(deps: PageReadingRuntimeDependencies) {
  const now = deps.now ?? Date.now;
  const running = new Map<string, Running>();
  const shadow = new Map<string, PageReadingTask>();
  const grants = new Map<string, Set<string>>();
  let disposed = false;
  let storageFailed = false;
  let prepareTail: Promise<unknown> = Promise.resolve();
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  const ready = (async () => {
    try {
      for (const task of await deps.repository.listUnfinished()) {
        const recovered: PageReadingTask = { ...task, status: 'unknown', updatedAt: now(),
          message: '扩展重新启动，前次文章分析的远端状态未确认；不会自动重复提交。' };
        await deps.repository.put(recovered);
      }
    } catch { storageFailed = true; }
  })();

  function identity(sender: PageReadingSender) {
    if (sender.id !== deps.extensionId || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || sender.tab!.id! < 0) return undefined;
    try {
      const source = new URL(sender.url ?? '');
      if (!['https:', 'http:'].includes(source.protocol)) return undefined;
      // Chrome can retain sender.url from script injection after pushState.
      // For a top-frame sender, tab.url is the browser's current page identity.
      // Reject contradictory origins rather than trusting a page-supplied URL.
      const current = sender.tab!.url === undefined ? source : new URL(sender.tab!.url);
      if (!['https:', 'http:'].includes(current.protocol) || current.origin !== source.origin) return undefined;
      const url = normalizeSourceIdentityUrl(current.href);
      return { url, key: `${sender.tab!.id}:${sender.documentId ?? url}` };
    } catch { return undefined; }
  }

  function save(run: Running, patch: Partial<PageReadingTask>): Promise<void> {
    // Finished attempts must never write late responses over an explicit retry
    // with the same article key. Completed history is read from the repository.
    if (run.finished) return Promise.resolve();
    run.task = { ...run.task, ...patch, updatedAt: now() };
    const value = structuredClone(run.task);
    run.saveTail = run.saveTail.then(async () => {
      if (run.storageError) throw new Error(STORAGE_ERROR);
      try { await deps.repository.put(value); shadow.set(value.id, value); }
      catch {
        storageFailed = true;
        run.storageError = true;
        run.task = { ...run.task, status: 'unknown', result: undefined, message: STORAGE_ERROR, updatedAt: now() };
        shadow.set(run.task.id, run.task);
        run.controller.abort();
        run.interrupt(new Error(STORAGE_ERROR));
        throw new Error(STORAGE_ERROR);
      }
    });
    // Callback-triggered writes must never cause unhandled rejections.
    void run.saveTail.catch(() => undefined);
    return run.saveTail;
  }

  function updateKeepAlive() {
    if (!disposed && running.size && !keepAliveTimer) {
      const pulse = () => { void deps.keepAlive?.().catch(() => undefined); };
      pulse();
      keepAliveTimer = setInterval(pulse, 20_000);
    } else if (!running.size && keepAliveTimer) {
      clearInterval(keepAliveTimer); keepAliveTimer = undefined;
    }
  }

  async function stop(run: Running, reason?: string) {
    if (reason) run.prohibited = reason;
    if (run.stopPromise) return run.stopPromise;
    if (run.finished || run.terminal) return;
    run.stopRequested = true;
    run.stopPromise = (async () => {
      if (run.finished) return;
      if (!run.executing) {
        // Block submission synchronously, before waiting for queued disk writes.
        // work() may currently be awaiting its persisted `analyzing` stage.
        run.controller.abort();
        await save(run, { status: 'stopped', message: '已停止准备，未提交文章分析。' });
        run.interrupt(new Error('stopped-before-submit'));
        return;
      }
      if (!run.transport.abortConversation) {
        await save(run, { status: 'stopping', message: reason
          ? `${reason} 当前通道不支持远端停止，仍在等待任务终态，请在 WorkOS 检查。`
          : '当前通道不支持远端停止；将继续接收已提交任务的结果并缓存，不会再次提交。' });
        return;
      }
      await save(run, { status: 'stopping', message: reason ?? '正在请求 WorkOS 停止分析。' });
      const stopController = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let accepted = false;
      try {
        await Promise.race([
          run.transport.abortConversation(run.task.remoteUuid!, stopController.signal),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {
            stopController.abort(); reject(new Error('stop-timeout'));
          }, deps.stopTimeoutMs ?? 5_000); }),
        ]);
        accepted = true;
      } catch { /* The stop endpoint is not proof of a remote terminal state. */ }
      finally { clearTimeout(timer); }
      if (run.finished || run.terminal) return;
      await save(run, { status: 'unknown', message: `${reason ? `${reason} ` : ''}${accepted
        ? 'WorkOS 已接受停止请求，但尚未确认任务结束；不会自动重新提交。'
        : '停止请求未获确认，远端任务可能仍在运行；请在 WorkOS 检查。'}` });
      // Do not use WORKOS_USER_STOP_REASON: InternalV2Transport would send a second stop.
      run.controller.abort();
      run.interrupt(new Error('stop-state-unknown'));
    })();
    return run.stopPromise;
  }

  async function execute(run: Running) {
    let output = '';
    let streamError = false;
    let rejectInterrupted: (error: Error) => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
    run.interrupt = rejectInterrupted;
    const timer = setTimeout(() => {
      run.controller.abort();
      rejectInterrupted(new Error('deadline'));
    }, deps.timeoutMs ?? 300_000);
    const work = async () => {
      await save(run, { status: 'creating', message: '正在创建文章分析会话，准备可能需要一些时间。' });
      if (run.controller.signal.aborted || run.stopRequested) throw new Error('cancelled');
      const remoteUuid = await run.transport.createConversation(run.controller.signal);
      // A late empty session must not overwrite a stopped or retried task.
      // No analysis was submitted to it, so it needs no recovery tracking.
      if (run.controller.signal.aborted || run.stopRequested || run.finished) throw new Error('cancelled');
      await save(run, { remoteUuid });
      if (run.controller.signal.aborted || run.stopRequested || run.finished) throw new Error('cancelled');
      await save(run, { status: 'analyzing', message: '正在等待 WorkOS 完成整篇分析，可退出并稍后回来。' });
      if (run.controller.signal.aborted || run.stopRequested) throw new Error('cancelled');
      run.executing = true;
      const expressionsMode = run.task.mode === 'expressions';
      await run.transport.executeStream(remoteUuid, { content: expressionsMode
        ? buildPageReadingExpressionsPrompt(run.task.snapshot) : buildPageReadingPrompt(run.task.snapshot) }, {
        onText(value) {
          if (run.finished || run.controller.signal.aborted) return;
          if (value.length > MAX_PAGE_READING_OUTPUT_LENGTH) {
            void stop(run, '分析返回内容超过上限，未显示不完整结果。').catch(() => undefined);
            return;
          }
          output = value;
          if (value.trim() && run.task.status === 'analyzing') {
            void save(run, { status: 'receiving', message: '正在接收整篇分析结果。' }).catch(() => undefined);
          }
        },
        onComplete() { if (!run.finished) run.terminal = true; },
        onError() { if (!run.finished) { streamError = true; run.terminal = true; } },
        onInterrupt() { if (!run.finished) void stop(run, '文章分析请求了额外输入，已尝试停止；本功能不自动回答或继续工具操作。').catch(() => undefined); },
        // Parser only emits these for explicit tool events/parts. Platform setup and
        // model reasoning are not tool callbacks and may continue normally.
        onActivity() { if (!run.finished) void stop(run, '检测到文章分析调用了工具，已尝试停止；请检查 WorkOS 配置。').catch(() => undefined); },
        onArtifact() { if (!run.finished) void stop(run, '文章分析生成了文件，已尝试停止；只接受文本分析结果。').catch(() => undefined); },
      }, run.controller.signal);
      await run.saveTail;
      if (run.controller.signal.aborted) throw new Error('cancelled');
      if (!run.terminal) throw new Error('unconfirmed-eof');
      if (streamError || run.prohibited) {
        await save(run, { status: 'failed', message: run.prohibited ?? 'WorkOS 报告分析失败，可明确点击重试。' });
        return;
      }
      await save(run, { status: 'checking', message: '正在核对分析结果与网页原文。' });
      const result = expressionsMode ? parsePageReadingExpressionsAnalysis(output, run.task.snapshot)
        : parsePageReadingAnalysis(output, run.task.snapshot);
      if (!result.readyCount) throw new Error('no-valid-paragraphs');
      await save(run, { status: 'ready', result, message: run.stopRequested
        ? '已提交的分析已完成并缓存。' : expressionsMode
          ? `发现 ${result.expressions?.length ?? 0} 个表达${result.invalidCount ? `，已跳过 ${result.invalidCount} 项无法准确定位的结果` : ''}。`
          : `分析已完成，${result.readyCount}/${result.total} 个段落通过原文检查。` });
    };
    try { await Promise.race([work(), interrupted]); }
    catch (error) {
      if (error instanceof WorkosProgressDisconnected && !run.storageError) {
        await save(run, { remoteUuid: error.conversationUuid, runId: error.runId }).catch(() => undefined);
      }
      if (!run.storageError && !['stopped', 'unknown'].includes(run.task.status)) {
        const knownTerminal = run.terminal || (!run.executing && !run.controller.signal.aborted);
        await save(run, { status: knownTerminal ? 'failed' : 'unknown', result: undefined,
          message: error instanceof Error && error.message === 'deadline'
            ? `${run.prohibited ? `${run.prohibited} ` : ''}文章准备耗时较长，等待已结束；远端任务可能仍在运行，请先在 WorkOS 查看，不会自动重新提交。`
            : knownTerminal ? '文章分析失败或结果格式无效，保留普通阅读；可明确点击重试。' : UNKNOWN,
        }).catch(() => undefined);
      }
    } finally {
      clearTimeout(timer);
      // A stop write may have been queued while work was awaiting an earlier
      // stage write. Let it finish before releasing the active state/cache.
      await run.saveTail.catch(() => undefined);
      run.finished = true;
      if (!run.storageError) await deps.repository.prune().catch(() => undefined);
      if (running.get(run.task.id) === run) {
        running.delete(run.task.id);
        // Persisted history is bounded by repository.prune(). Only retain a
        // failed-to-persist unknown state in memory to prevent unsafe resubmits.
        if (!run.storageError) shadow.delete(run.task.id);
      }
      updateKeepAlive();
    }
  }

  async function prepare(request: Record<string, unknown>, from: NonNullable<ReturnType<typeof identity>>) {
    await ready;
    if (disposed) return failure('文章分析服务已关闭。');
    if (storageFailed) return failure(STORAGE_ERROR);
    if (request.mode !== undefined && request.mode !== 'groups' && request.mode !== 'expressions') return failure('文章分析模式无效。');
    const mode = request.mode === 'expressions' ? 'expressions' : 'groups';
    let snapshot: ReturnType<typeof validatePageReadingSnapshot>;
    try { snapshot = validatePageReadingSnapshot(request.snapshot); }
    catch (error) { return failure(error instanceof Error ? error.message : '文章正文无效。'); }
    if (snapshot.url !== from.url) return failure('文章地址与当前网页不一致。');
    let connection: WorkosConnectionSettings;
    try { connection = await deps.loadConnection(); }
    catch { return failure('无法读取 WorkOS 连接配置，请检查设置。'); }
    // Cache identity needs the selected target, but not valid credentials. Removing
    // an expired credential must not make an already checked local result unreadable.
    if (validateAgentUuid(connection.agentUuid)) return failure('请先在设置中配置 WorkOS Agent。');
    const target = `${connection.transport}:${connection.agentUuid}:${connection.transport === 'internal-v2'
      ? WORKOS_INTERNAL_V2_BASE_URL : WORKOS_API_ORIGIN}`;
    const id = await pageReadingKey(snapshot, target, mode);
    const existing = shadow.get(id) ?? await deps.repository.get(id);
    const retry = request.retry === true;
    if (existing && !(retry && ['failed', 'stopped'].includes(existing.status))) {
      const granted = grants.get(from.key) ?? new Set<string>(); granted.add(id); grants.set(from.key, granted);
      return response(existing);
    }
    if (!isActiveWorkosConnectionConfigured(connection)) return failure('请先在设置中连接 WorkOS。');
    if (running.size >= 2) return failure('已有两个文章任务正在准备，请等待其中一个完成。');
    const candidate: PageReadingTask = { id, snapshot, target, mode, status: 'preparing', createdAt: now(), updatedAt: now(),
      message: '已准备文章分析任务。' };
    let claimed: Awaited<ReturnType<PageReadingRepository['claim']>>;
    try { claimed = await deps.repository.claim(candidate, retry); }
    catch { storageFailed = true; return failure(STORAGE_ERROR); }
    const granted = grants.get(from.key) ?? new Set<string>(); granted.add(claimed.task.id); grants.set(from.key, granted);
    if (claimed.created) {
      let transport: WorkosTransport;
      try { transport = deps.createTransport(connection); }
      catch {
        const failed: PageReadingTask = { ...claimed.task, status: 'failed', updatedAt: now(), message: '无法初始化 WorkOS 连接，未提交分析。' };
        try { await deps.repository.put(failed); }
        catch { storageFailed = true; return failure(STORAGE_ERROR); }
        await deps.repository.prune().catch(() => undefined);
        return response(failed);
      }
      const run: Running = { task: claimed.task, controller: new AbortController(), transport,
        executing: false, terminal: false, finished: false, stopRequested: false, saveTail: Promise.resolve(), interrupt: () => undefined };
      running.set(claimed.task.id, run);
      shadow.set(claimed.task.id, claimed.task);
      updateKeepAlive();
      // Detached from the message lifetime and from the initiating tab/document.
      void execute(run);
    }
    return response(claimed.task);
  }

  async function dispatch(request: Record<string, unknown>, from: NonNullable<ReturnType<typeof identity>>) {
    if (request.type === 'reading-focus:page-prepare') {
      const operation = prepareTail.then(() => prepare(request, from));
      prepareTail = operation.catch(() => undefined);
      return operation;
    }
    await ready;
    if (typeof request.id !== 'string' || !grants.get(from.key)?.has(request.id)) return failure('请先为当前文章开启辅助阅读。');
    const task = shadow.get(request.id) ?? await deps.repository.get(request.id);
    if (!task || normalizeSourceIdentityUrl(task.snapshot.url) !== from.url) return failure('无法读取当前文章的分析任务。');
    if (request.type === 'reading-focus:page-stop') {
      const run = running.get(task.id);
      if (run) await stop(run);
      else if (task.status === 'unknown') return failure('远端任务状态未确认，请在 WorkOS 检查或停止。');
      return response(shadow.get(task.id) ?? await deps.repository.get(task.id) ?? task);
    }
    return response(task);
  }

  return {
    ready,
    handle(message: unknown, sender: PageReadingSender, sendResponse: (value: unknown) => void): boolean {
      if (!message || typeof message !== 'object') return false;
      const request = message as Record<string, unknown>;
      if (!['reading-focus:page-prepare', 'reading-focus:page-status', 'reading-focus:page-stop'].includes(request.type as string)) return false;
      const from = identity(sender);
      if (!from || disposed) { sendResponse(failure('文章分析只能由当前网页中的扩展发起。')); return false; }
      void dispatch(request, from).then(sendResponse, () => sendResponse(failure(
        storageFailed ? STORAGE_ERROR : '文章分析暂时不可用，请检查连接配置与本地存储。',
      )));
      return true;
    },
    dispose() {
      disposed = true;
      // Disposing the worker is not remote cancellation. Durable stages recover as unknown.
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
      for (const run of running.values()) {
        run.controller.abort(); run.interrupt(new Error('runtime-disposed'));
      }
      grants.clear();
    },
  };
}
