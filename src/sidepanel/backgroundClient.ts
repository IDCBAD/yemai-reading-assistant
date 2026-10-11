import { browser } from 'wxt/browser';
import { applyWorkspaceDelta, hasWorkspaceDelta, workspaceDelta, type WorkspaceDelta } from '../background/workspaceDelta';
import { TASK_PORT, type ExecutorCommand, type ExecutorRequest, type ExecutorResponse, type ExecutorSnapshot } from '../shared/backgroundTasks';
import type { ChatMessage, WorkspaceState } from './types';

class RejectedBackgroundCommand extends Error {}

export class BackgroundWorkspaceClient {
  private readonly clientId = crypto.randomUUID();
  private sequence = 0;
  private snapshot?: ExecutorSnapshot;
  private pending: { sequence: number; delta: WorkspaceDelta; epoch?: string }[] = [];
  private failure?: Error;
  private port?: ReturnType<typeof browser.runtime.connect>;
  private connecting?: Promise<void>;
  private recoveringPatches?: Promise<void>;
  private recoveringEpoch?: string;
  private generation = 0;
  private disposed = false;
  private readonly retiredEpochs = new Set<string>();
  private state: WorkspaceState;
  constructor(initial: WorkspaceState, private readonly changed: (state: WorkspaceState) => void, private readonly failed: (error: string) => void, private readonly storageRecovered?: (previousIssue: string) => void) { this.state = initial; }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('侧边栏已关闭。'));
    if (this.connecting) return this.connecting;
    if (this.port && this.snapshot) return Promise.resolve();
    const generation = ++this.generation;
    const connection = new Promise<void>((resolve, reject) => {
      const port = browser.runtime.connect({ name: `${TASK_PORT}:${this.clientId}` });
      this.port = port;
      let hydrated = false;
      port.onMessage.addListener((message: ExecutorSnapshot | { error: string }) => {
        if (this.disposed || this.generation !== generation) return;
        if ('error' in message) { reject(new Error(message.error)); this.failed(message.error); return; }
        this.receive(message);
        if (!hydrated) { hydrated = true; resolve(); }
      });
      port.onDisconnect.addListener(() => {
        if (this.disposed || this.generation !== generation) return;
        this.port = undefined;
        const error = new Error('扩展后台连接中断，请重新打开侧边栏检查任务状态。');
        // An idle worker can disconnect normally. Reconnect on the next user
        // action instead of permanently disabling the already-open panel.
        if (!hydrated) reject(error);
      });
    });
    this.connecting = connection;
    void connection.finally(() => { if (this.connecting === connection) this.connecting = undefined; }).catch(() => undefined);
    return connection;
  }
  disconnect() { this.disposed = true; this.generation++; const port = this.port; this.port = undefined; port?.disconnect(); }
  private ensureSubscribed() { if (!this.port) void this.connect().catch((error: unknown) => { if (!this.disposed) this.failed(error instanceof Error ? error.message : '无法重新连接后台。'); }); }
  private receive(snapshot: ExecutorSnapshot) {
    if (this.disposed || this.retiredEpochs.has(snapshot.epoch)) return;
    if (this.snapshot?.epoch === snapshot.epoch && this.snapshot.revision > snapshot.revision) return;
    if (this.snapshot && this.snapshot.epoch !== snapshot.epoch) {
      this.retiredEpochs.add(this.snapshot.epoch);
      // Pending UI changes are replayed over the loaded state. Execution commands
      // are never replayed: the worker has already marked interrupted runs.
      if (!this.connecting) {
        const port = this.port;
        this.port = undefined;
        this.generation++;
        port?.disconnect();
      }
    }
    const previousIssue = this.snapshot?.storageIssue;
    this.snapshot = snapshot;
    if (snapshot.storageIssue) this.failed(snapshot.storageIssue);
    else if (previousIssue) this.storageRecovered?.(previousIssue);
    this.pending = this.pending.filter((item) => item.epoch !== snapshot.epoch || item.sequence > (snapshot.confirmed[this.clientId] ?? 0));
    this.state = this.pending.reduce((state, item) => applyWorkspaceDelta(state, item.delta), snapshot.workspace);
    this.changed(this.state);
    this.ensureSubscribed();
    if (this.pending.some((item) => item.epoch !== snapshot.epoch)) void this.recoverPendingPatches().catch(() => undefined);
  }
  update(updater: WorkspaceState | ((state: WorkspaceState) => WorkspaceState)) {
    const next = typeof updater === 'function' ? updater(this.state) : updater;
    const delta = workspaceDelta(this.state, next);
    if (!hasWorkspaceDelta(delta)) return;
    if (this.snapshot?.maintenance) return;
    if (!this.snapshot || this.failure) { this.failed(this.failure?.message ?? '后台尚未准备好。'); return; }
    this.state = next;
    const sequence = ++this.sequence;
    this.pending.push({ sequence, delta, epoch: this.snapshot.epoch });
    this.changed(next);
    this.ensureSubscribed();
    void this.enqueue(sequence, { kind: 'patch', delta }).catch(() => undefined);
  }
  command(command: ExecutorCommand) { this.ensureSubscribed(); return this.enqueue(++this.sequence, command); }
  private recoverPendingPatches(): Promise<void> {
    if (this.recoveringPatches && this.recoveringEpoch === this.snapshot?.epoch) return this.recoveringPatches;
    if (!this.snapshot || !this.pending.length || this.disposed) return Promise.resolve();
    // A recovered append is only a record of the user's intent. It cannot prove
    // that the former worker accepted the accompanying submit command.
    const recoverMessage = (message: ChatMessage): ChatMessage => message.role === 'assistant' && message.status === 'queued'
      ? { ...message, status: 'stopped', stage: undefined, runFinishedAt: Date.now(), errorMessage: '后台连接中断，本次发送未确认。请检查 WorkOS 任务状态后再重试。' }
      : message;
    this.pending = this.pending.map((item) => item.epoch === this.snapshot!.epoch ? item : { ...item, delta: {
      ...item.delta,
      added: item.delta.added.map((conversation) => ({ ...conversation, messages: conversation.messages.map(recoverMessage) })),
      changed: item.delta.changed.map((conversation) => ({ ...conversation, addedMessages: conversation.addedMessages.map(recoverMessage) })),
    } });
    // Combine intents in original order. Independent retries could arrive in a
    // different order and incorrectly acknowledge an earlier UI change.
    const desired = this.pending.reduce((state, item) => applyWorkspaceDelta(state, item.delta), this.snapshot.workspace);
    const delta = workspaceDelta(this.snapshot.workspace, desired);
    if (!hasWorkspaceDelta(delta)) { this.pending = []; this.receive(this.snapshot); return Promise.resolve(); }
    const sequence = ++this.sequence;
    this.pending = [{ sequence, delta, epoch: this.snapshot.epoch }];
    const recovery = this.enqueue(sequence, { kind: 'patch', delta }, false);
    this.recoveringPatches = recovery;
    this.recoveringEpoch = this.snapshot.epoch;
    void recovery.finally(() => { if (this.recoveringPatches === recovery) this.recoveringPatches = undefined; }).catch(() => undefined);
    return recovery;
  }
  private enqueue(sequence: number, command: ExecutorCommand, canRecover = true): Promise<void> {
    const sentEpoch = this.snapshot?.epoch;
    // Issue every command while the document still exists. The background
    // serializes them and refuses submissions after a failed preceding save.
    const operation = (async () => {
      if (this.failure) throw this.failure;
      if (!this.snapshot) throw new Error('后台尚未准备好。');
      const request: ExecutorRequest = { type: 'executor:command', clientId: this.clientId, epoch: this.snapshot.epoch, sequence, command };
      let response: ExecutorResponse;
      try {
        response = await browser.runtime.sendMessage(request) as ExecutorResponse;
        if (!response || typeof response.ok !== 'boolean') throw new Error('后台未返回有效响应。');
      } catch (error) {
        if (command.kind !== 'patch' || !canRecover || this.disposed) throw error;
        if (this.connecting) await this.connecting;
        else if (!this.retiredEpochs.has(request.epoch)) {
          const port = this.port;
          this.port = undefined;
          this.generation++;
          port?.disconnect();
          await this.connect();
        } else if (!this.port) await this.connect();
        return this.recoverPendingPatches();
      }
      if (!response.ok && response.retryable) this.pending = this.pending.filter((item) => item.sequence !== sequence);
      if (response.snapshot) this.receive(response.snapshot);
      if (!response.ok && command.kind === 'patch' && canRecover && response.snapshot?.epoch !== undefined && response.snapshot.epoch !== request.epoch) {
        return this.recoverPendingPatches();
      }
      if (!response.ok && response.retryable && command.kind === 'patch') { this.failed(response.error); return; }
      if (!response.ok) throw new RejectedBackgroundCommand(response.error);
    })().catch((error: unknown) => {
      if (command.kind === 'patch' && sentEpoch && this.retiredEpochs.has(sentEpoch) && !this.disposed) return this.recoverPendingPatches();
      const failure = error instanceof Error ? error : new Error('后台保存失败，本次未继续发送。');
      if (command.kind === 'patch' && error instanceof RejectedBackgroundCommand) this.failure = failure;
      else if (command.kind === 'patch') this.pending = this.pending.map((item) => item.sequence === sequence ? { ...item, epoch: undefined } : item);
      // Preserve optimistic input for recovery; never submit after a failed save.
      this.failed(failure.message);
      throw failure;
    });
    return operation;
  }
}
