import { ConversationRequestCoordinator, waitForAbortable } from '../sidepanel/agentQueue';
import { INITIAL_WORKSPACE } from '../sidepanel/mockData';
import type { Conversation, WorkspaceState } from '../sidepanel/types';
import { applyWorkspaceDelta } from './workspaceDelta';
import { runAgentRequest, type SerializableAgentRequest } from './runAgentRequest';
import type { ExecutorRequest, ExecutorResponse, ExecutorSnapshot } from '../shared/backgroundTasks';
import type { WorkosConnectionSettings } from '../services/workosConnection';
import { createBackgroundTransport as createWorkosTransport } from './createTransport';
import { messageDecisionInteractions, normalizeAgentDecisionAnswers } from '../sidepanel/agentDecision';
import type { BackgroundTaskEvent } from './taskEvents';
import { isActiveWorkosConnectionConfigured } from '../services/workosConnection';
import { hasUnconfirmedWorkosRun, UNCONFIRMED_WORKOS_SUBMIT_MESSAGE } from '../services/workosRunState';

export interface RuntimeDependencies {
  load(): Promise<WorkspaceState | null>;
  save(state: WorkspaceState): Promise<unknown>;
  connection(): Promise<WorkosConnectionSettings>;
  preparePage(request: SerializableAgentRequest, signal: AbortSignal): Promise<{ snapshot?: import('../shared/extensionMessages').PageSnapshot; error?: string }>;
  keepAlive(): Promise<unknown>;
  run?: typeof runAgentRequest;
  recordEvents?(events: BackgroundTaskEvent[]): Promise<void>;
  clearHistory?(replacement: WorkspaceState): Promise<void>;
}

// A finite operation, including silent SSE periods and remote-stop confirmation.
export const MAX_BACKGROUND_RUN_MS = 6 * 60 * 60 * 1_000;
export class BackgroundTaskRuntime {
  private workspace: WorkspaceState = INITIAL_WORKSPACE;
  private readonly epoch = crypto.randomUUID();
  private revision = 0;
  private readonly confirmed: Record<string, number> = {};
  private initialized?: Promise<void>;
  private operations: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: ExecutorSnapshot) => void>();
  private readonly jobs = new Map<string, { request: SerializableAgentRequest; connection: WorkosConnectionSettings; started: boolean; preparation: Promise<{ snapshot?: import('../shared/extensionMessages').PageSnapshot; error?: string }>; controller: AbortController }>();
  private readonly coordinator: ConversationRequestCoordinator<SerializableAgentRequest>;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private maintenanceOwner?: string;
  private persistenceFailure?: Error;
  private readonly failedClients = new Set<string>();
  private readonly disconnectedClients = new Set<string>();
  private readonly clientConnections = new Map<string, number>();
  private pendingEvents: BackgroundTaskEvent[] = [];
  private dirtySince?: number;
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly dependencies: RuntimeDependencies) {
    this.coordinator = new ConversationRequestCoordinator(async (request, signal) => {
      const job = this.jobs.get(request.messageId);
      if (!job) return;
      job.started = true;
      const deadline = setTimeout(() => {
        this.stop(request.conversationId, request.messageId);
        this.updateConversation(request.conversationId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === request.messageId
          ? { ...m, errorMessage: '后台接收已超过 6 小时，正在请求 WorkOS 暂停。请检查任务状态。' } : m) }));
      }, MAX_BACKGROUND_RUN_MS);
      try {
        await (dependencies.run ?? runAgentRequest)(request, signal, {
          connection: job.connection,
          getWorkspace: () => this.workspace,
          updateConversation: (id, updater) => this.updateConversation(id, updater),
          discardQueued: (id) => this.discardQueued(id),
          preparePage: (_request, signal) => waitForAbortable(job.preparation, signal),
        });
      } catch (error) {
        this.updateConversation(request.conversationId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === request.messageId
          ? { ...m, status: 'failed', stage: undefined, errorMessage: error instanceof Error ? error.message : '后台执行失败。', runFinishedAt: Date.now() } : m) }));
      } finally {
        clearTimeout(deadline);
        job.controller.abort();
        this.jobs.delete(request.messageId);
        // End-state is persisted by the executor even with no subscribers.
        await this.flush().catch(() => undefined);
        this.releaseKeepAlive();
      }
    });
  }
  private async initialize() {
    this.initialized ??= (async () => {
      this.workspace = await this.dependencies.load() ?? INITIAL_WORKSPACE;
      // Loading succeeded; a temporary first-save failure is recoverable and
      // must not permanently cache a rejected initialization promise.
      await this.persist().catch(() => undefined);
    })().catch((error: unknown) => { this.initialized = undefined; throw error; });
    await this.initialized;
  }
  snapshot(): ExecutorSnapshot { return { epoch: this.epoch, revision: this.revision, confirmed: { ...this.confirmed }, workspace: this.workspace, storageIssue: this.persistenceFailure?.message, maintenance: Boolean(this.maintenanceOwner) }; }
  async subscribe(listener: (snapshot: ExecutorSnapshot) => void) {
    await this.initialize();
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  attachClient(clientId: string) {
    this.clientConnections.set(clientId, (this.clientConnections.get(clientId) ?? 0) + 1);
    this.disconnectedClients.delete(clientId);
  }
  async releaseClient(clientId: string) {
    const connections = this.clientConnections.get(clientId) ?? 0;
    if (connections > 1) { this.clientConnections.set(clientId, connections - 1); return; }
    this.clientConnections.delete(clientId);
    this.disconnectedClients.add(clientId);
    await this.operations;
    if (!this.disconnectedClients.has(clientId)) return;
    if (this.maintenanceOwner !== clientId) return;
    this.workspace = await this.dependencies.load() ?? INITIAL_WORKSPACE;
    this.maintenanceOwner = undefined;
    this.revision++;
    this.publish();
  }
  private publish() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      const snapshot = this.snapshot();
      this.listeners.forEach((listener) => listener(snapshot));
    }, 80);
  }
  private updateConversation(id: string, updater: (conversation: Conversation) => Conversation) {
    const previous = this.workspace.conversations.find((c) => c.id === id);
    if (!previous) return;
    const next = updater(previous);
    next.messages.forEach((message) => {
      if (message.role !== 'assistant') return;
      const old = previous.messages.find((m) => m.id === message.id);
      const oldInteractions = messageDecisionInteractions(old ?? {});
      const newInteraction = messageDecisionInteractions(message).findLast((interaction) => interaction.status === 'pending'
        && !oldInteractions.some((previous) => previous.id === interaction.id && previous.sessionId === interaction.sessionId));
      const kind = message.remoteRunUnconfirmed && !old?.remoteRunUnconfirmed ? 'connection-lost'
        : message.status === 'complete' && old?.status !== 'complete' ? 'complete'
        : message.status === 'failed' && old?.status !== 'failed' ? 'failed'
        : message.stage === 'waiting-user-input' && (old?.stage !== 'waiting-user-input' || newInteraction) ? 'waiting-user-input' : undefined;
      if (kind) this.pendingEvents.push({ id: `${id}:${message.id}:${message.runStartedAt ?? message.createdAt}:${kind}:${kind === 'waiting-user-input' ? newInteraction?.id ?? messageDecisionInteractions(message).at(-1)?.id ?? '' : ''}`, conversationId: id, messageId: message.id, kind, createdAt: Date.now() });
    });
    this.workspace = { ...this.workspace, conversations: this.workspace.conversations.map((c) => c.id === id ? next : c) };
    this.revision++;
    this.publish();
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.flush().catch(() => undefined); }, 250);
  }
  private async persist() {
    const previousFailure = this.persistenceFailure;
    try {
      await this.dependencies.save(this.workspace);
      if (this.dependencies.recordEvents && this.pendingEvents.length) {
        const events = this.pendingEvents;
        this.pendingEvents = [];
        try { await this.dependencies.recordEvents(events); }
        catch (error) { this.pendingEvents = [...events, ...this.pendingEvents]; throw error; }
      }
      this.persistenceFailure = undefined;
      this.dirtySince = undefined;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.releaseKeepAlive();
      if (previousFailure) { this.revision++; this.publish(); }
    }
    catch (error) {
      this.dirtySince ??= Date.now();
      this.persistenceFailure = new Error(Date.now() - this.dirtySince < 90_000
        ? '后台结果尚未保存，正在重试。请检查扩展存储空间；暂时不要关闭浏览器或重载扩展。'
        : '后台结果仍未保存，已停止自动重试。当前新内容只保留在内存中，请释放存储空间后打开侧边栏重试保存。');
      this.revision++;
      this.publish();
      if (Date.now() - this.dirtySince < 90_000 && !this.retryTimer) {
        this.retainKeepAlive();
        this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.flush().catch(() => { this.releaseKeepAlive(); }); }, 5_000);
      }
      throw error;
    }
  }
  async flush() { if (this.saveTimer) clearTimeout(this.saveTimer); this.saveTimer = undefined; await this.persist(); }
  private retainKeepAlive() {
    if (this.keepAliveTimer) return;
    void this.dependencies.keepAlive().catch(() => undefined);
    this.keepAliveTimer = setInterval(() => { void this.dependencies.keepAlive().catch(() => undefined); }, 25_000);
  }
  private releaseKeepAlive() {
    if (this.jobs.size || (this.dirtySince !== undefined && Date.now() - this.dirtySince < 90_000) || !this.keepAliveTimer) return;
    clearInterval(this.keepAliveTimer); this.keepAliveTimer = undefined;
  }
  private discardQueued(id: string) {
    const requests = this.coordinator.discardQueued(id);
    requests.forEach((request) => { this.jobs.get(request.messageId)?.controller.abort(); this.jobs.delete(request.messageId); });
    this.releaseKeepAlive();
    return requests;
  }
  private stop(conversationId: string, messageId: string) {
    if (!this.coordinator.stop(conversationId, messageId)) return;
    const job = this.jobs.get(messageId);
    job?.controller.abort();
    this.updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => m.id === messageId ? {
      ...m, status: 'stopped', stopStatus: job?.connection.transport === 'internal-v2' ? 'pending' : 'local-only', stage: undefined,
      runFinishedAt: Date.now(),
      activities: m.activities?.map((a) => ['pending', 'running'].includes(a.status) ? { ...a, status: 'stopped', completedAt: Date.now() } : a),
    } : m) }));
  }
  private clearRuns() {
    this.coordinator.clear();
    this.jobs.forEach((job, id) => { job.controller.abort(); if (!job.started) this.jobs.delete(id); });
    this.workspace = { ...this.workspace, conversations: this.workspace.conversations.map((c) => ({ ...c, messages: c.messages.map((m) => ['queued', 'running', 'streaming'].includes(m.status)
      ? { ...m, status: 'stopped', stage: undefined, errorMessage: '本地接收已结束，远端任务状态未确认。', runFinishedAt: Date.now() } : m) })) };
    this.revision++;
    this.releaseKeepAlive();
  }
  private assertSubmissionConfirmed(conversationId: string, messageId: string, connection: WorkosConnectionSettings) {
    const latest = this.workspace.conversations.find((c) => c.id === conversationId);
    if (!latest || !hasUnconfirmedWorkosRun(latest, connection)) return;
    // A viewer can submit before it receives the loss snapshot. Leave a visible
    // unsent record, rather than an orphaned queued answer without a job.
    if (!this.jobs.has(messageId) && latest.messages.some((m) => m.id === messageId && m.status === 'queued')) this.updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) =>
      m.id === messageId && m.status === 'queued' ? { ...m, status: 'stopped', stage: undefined, stopStatus: 'local-only',
        errorMessage: '上一项 WorkOS 任务状态未确认，此问题未发送。', runFinishedAt: Date.now() } : m) }));
    throw new Error(UNCONFIRMED_WORKOS_SUBMIT_MESSAGE);
  }
  handle(request: ExecutorRequest): Promise<ExecutorResponse> {
    const operation = this.operations.then(async (): Promise<ExecutorResponse> => {
      await this.initialize();
      if (request.epoch !== this.epoch) return { ok: false, error: '扩展后台已重启，请重新连接后检查任务状态。', snapshot: this.snapshot() };
      if (request.sequence <= (this.confirmed[request.clientId] ?? 0)) return { ok: true, snapshot: this.snapshot() };
      if (this.failedClients.has(request.clientId)) throw new Error('前一项会话修改未保存，本次没有继续发送。请重新打开侧边栏检查。');
      if (this.maintenanceOwner && (this.maintenanceOwner !== request.clientId || request.command.kind !== 'maintenance-end')) {
        return { ok: false, error: '正在导入本地备份，暂时不能修改会话。', retryable: true, snapshot: this.snapshot() };
      }
      const command = request.command;
      switch (command.kind) {
        case 'patch': {
          command.delta.removed.forEach((id) => {
            this.discardQueued(id);
            const job = [...this.jobs.values()].find((j) => j.request.conversationId === id && j.started);
            if (job) { job.controller.abort(); this.coordinator.cancel(id); }
          });
          this.workspace = applyWorkspaceDelta(this.workspace, command.delta, true);
          this.revision++;
          break;
        }
        case 'submit': {
          if (this.maintenanceOwner) throw new Error('正在导入备份，暂时不能发送问题。');
          if (this.persistenceFailure) throw this.persistenceFailure;
          if (this.jobs.has(command.request.messageId)) break;
          const c = this.workspace.conversations.find((c) => c.id === command.request.conversationId);
          if (!c?.messages.some((m) => m.id === command.request.messageId) || !c.messages.some((m) => m.id === command.request.userMessage.id)) throw new Error('提问记录未保存，本次没有提交。');
          const connection = await this.dependencies.connection();
          if (!isActiveWorkosConnectionConfigured(connection)) throw new Error('WorkOS 连接未配置完整，本次没有发送。');
          this.assertSubmissionConfirmed(c.id, command.request.messageId, connection);
          this.updateConversation(c.id, (c) => ({ ...c, messages: c.messages.map((m) => m.id === command.request.messageId ? {
            ...m, content: '', status: 'queued', stage: 'queued', stopStatus: undefined, remoteRunUnconfirmed: undefined, errorMessage: undefined,
            respondedAt: undefined, runStartedAt: undefined, runFinishedAt: undefined, activities: [], artifacts: [], interactions: [], decision: undefined,
          } : m) }));
          await this.flush(); // Never submit a question which has not been saved.
          // The previous stream may have disconnected while connection/storage
          // was awaited. Read current state again, with no await before enqueue.
          this.assertSubmissionConfirmed(c.id, command.request.messageId, connection);
          const controller = new AbortController();
          const preparation = command.request.pagePreparation ? Promise.resolve(command.request.pagePreparation)
            : command.request.needsPageRead ? this.dependencies.preparePage(command.request, controller.signal).catch((error: unknown) => ({ error: error instanceof Error ? error.message : '页面正文未能读取。' }))
            : Promise.resolve({});
          this.jobs.set(command.request.messageId, { request: command.request, connection, started: false, preparation, controller });
          // Dispatch is irreversible: a failed later checkpoint must not make
          // retrying the same command submit the question again.
          this.confirmed[request.clientId] = request.sequence;
          this.retainKeepAlive();
          this.coordinator.enqueue(command.request);
          break;
        }
        case 'stop': this.stop(command.conversationId, command.messageId); break;
        case 'clear-runs': this.clearRuns(); break;
        case 'clear-history':
          this.clearRuns();
          this.pendingEvents = [];
          await this.dependencies.clearHistory?.(this.workspace);
          break;
        case 'flush': break;
        case 'maintenance-start':
          if (this.jobs.size) throw new Error('还有后台任务正在运行，请等待完成或暂停后再导入备份。');
          if (this.disconnectedClients.has(request.clientId)) throw new Error('侧边栏已关闭，本次没有进入备份导入。');
          await this.flush();
          this.maintenanceOwner = request.clientId;
          break;
        case 'maintenance-end':
          if (this.maintenanceOwner !== request.clientId) throw new Error('备份导入状态已变化，请重新打开侧边栏。');
          this.workspace = await this.dependencies.load() ?? INITIAL_WORKSPACE;
          this.maintenanceOwner = undefined;
          this.revision++;
          break;
        case 'decision': void this.resolveDecision(command).catch(() => undefined); break;
      }
      await this.flush();
      this.confirmed[request.clientId] = request.sequence;
      this.revision++;
      this.publish();
      return { ok: true, snapshot: this.snapshot() };
    }).catch(async (error: unknown): Promise<ExecutorResponse> => {
      if (error instanceof Error && error.message === UNCONFIRMED_WORKOS_SUBMIT_MESSAGE) await this.flush().catch(() => undefined);
      if (request.command.kind === 'patch') this.failedClients.add(request.clientId);
      return { ok: false, error: error instanceof Error ? error.message : '扩展后台处理失败。', snapshot: this.snapshot() };
    });
    this.operations = operation;
    return operation;
  }
  private async resolveDecision(command: Extract<ExecutorRequest['command'], { kind: 'decision' }>) {
    const c = this.workspace.conversations.find((c) => c.id === command.conversationId);
    const m = c?.messages.find((m) => m.id === command.messageId);
    const decision = messageDecisionInteractions(m ?? {}).find((d) => d.id === command.decisionId);
    const job = this.jobs.get(command.messageId);
    if (!c?.remoteUuid || !m || !decision || !job || !['running', 'streaming'].includes(m.status) || !['pending', 'failed'].includes(decision.status)) return;
    const answers = normalizeAgentDecisionAnswers(decision.fields, command.answers);
    const update = (status: typeof decision.status, errorMessage?: string) => this.updateConversation(c.id, (c) => ({ ...c, messages: c.messages.map((m) => m.id === command.messageId && ['running', 'streaming'].includes(m.status) ? {
      ...m, interactions: messageDecisionInteractions(m).map((d) => d.id === decision.id && d.sessionId === decision.sessionId
        && (status === 'submitting' ? ['pending', 'failed'].includes(d.status) : d.status === 'submitting')
        ? { ...d, status, submittedAction: command.action, ...(command.action === 'reply' ? { answers } : {}), errorMessage } : d), decision: undefined,
    } : m) }));
    update('submitting');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    job.controller.signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(onAbort, 20_000);
    try {
      await this.flush();
      if (controller.signal.aborted || this.jobs.get(command.messageId) !== job) return;
      const transport = createWorkosTransport(job.connection);
      if (command.action === 'reply') { if (!transport.replyInterrupt) throw new Error('当前通道不支持交互表单。'); await transport.replyInterrupt(c.remoteUuid, decision.id, answers, controller.signal); }
      else { if (!transport.rejectInterrupt) throw new Error('当前通道不支持交互表单。'); await transport.rejectInterrupt(c.remoteUuid, decision.id, controller.signal); }
      update('submitted');
    } catch (error) { update('failed', error instanceof Error ? error.message : '无法提交当前选择，请重试。'); }
    finally { clearTimeout(timeout); job.controller.signal.removeEventListener('abort', onAbort); }
  }
}
