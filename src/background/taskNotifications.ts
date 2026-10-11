import type { WorkspaceState } from '../sidepanel/types';
import type { TaskNotificationCommand, TaskNotificationSnapshot, TaskNotificationTarget, TaskNotificationView } from '../shared/taskNotifications';
import type { BackgroundTaskEvent } from './taskEvents';

export interface HandledTaskEvent extends BackgroundTaskEvent { read: boolean }
export interface TaskNotificationState { entries: HandledTaskEvent[]; enabled: boolean }
export interface TaskNotificationDependencies {
  load(): Promise<TaskNotificationState>;
  save(state: TaskNotificationState): Promise<void>;
  badge(count: number): Promise<void>;
  notify(event: BackgroundTaskEvent, summary: string, windowId: number | undefined, eligible: () => boolean): Promise<void>;
  dismiss(conversationId: string, eventIds: string[]): Promise<void>;
  targetsChanged?(targets: Record<string, TaskNotificationTarget>): Promise<void>;
}

// The task executor owns execution; this center only owns durable unread state
// and best-effort browser presentation. No port or timer keeps the worker awake.
export class TaskNotificationCenter {
  private state: TaskNotificationState = { entries: [], enabled: true };
  private loaded = false;
  private operations: Promise<void> = Promise.resolve();
  private effects: Promise<void> = Promise.resolve();
  private viewers = new Map<string, TaskNotificationView>();
  private listeners = new Map<string, (snapshot: TaskNotificationSnapshot) => void>();
  private targets = new Map<number, TaskNotificationTarget>();
  private workspace?: WorkspaceState;
  private generation = 0;
  private permission: TaskNotificationSnapshot['permission'] = 'unknown';
  private issue?: string;
  private pendingRecords = new Map<string, HandledTaskEvent>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;

  constructor(private readonly dependencies: TaskNotificationDependencies) {}

  private enqueue(operation: () => Promise<void>, flushPending = true) {
    const generation = this.generation;
    const result = this.operations.then(async () => {
      try {
        if (!this.loaded) { this.state = await this.dependencies.load(); this.loaded = true; }
        if (flushPending && generation === this.generation) await this.savePendingRecords();
        await operation();
      } catch (error) {
        if (this.pendingRecords.size) this.retryPendingRecords();
        throw error;
      }
    });
    this.operations = result.catch(() => undefined);
    return result;
  }

  private retryPendingRecords() {
    this.reportIssue(this.retries >= 3 ? '任务结果已保存，但提醒状态暂时未能保存，请重新打开插件重试。' : '任务结果已保存，但提醒状态暂时未能保存，正在重试。');
    if (this.retryTimer || this.retries >= 3) return;
    const generation = this.generation;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (generation !== this.generation || !this.pendingRecords.size) return;
      ++this.retries;
      void this.start().catch(() => undefined);
    }, 5_000);
  }

  private async savePendingRecords() {
    if (!this.pendingRecords.size) return;
    const generation = this.generation;
    const records = [...this.pendingRecords.values()];
    const known = new Set(this.state.entries.map((event) => event.id));
    const fresh = records.filter((event) => !known.has(event.id) && this.valid(event)).map((event) => ({ ...event, read: event.read || this.viewed(event.conversationId) }));
    const candidate = { ...this.state, entries: [...this.state.entries, ...fresh].sort((a, b) => a.createdAt - b.createdAt).slice(-100) };
    await this.dependencies.save(candidate);
    if (generation !== this.generation) return;
    this.state = candidate;
    for (const record of records) this.pendingRecords.delete(record.id);
    this.retries = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    if (this.issue?.includes('提醒状态暂时未能保存')) this.issue = undefined;
    this.refresh();
    const latest = new Map(fresh.filter((event) => !event.read).map((event) => [event.conversationId, event]));
    for (const event of latest.values()) {
      const summary = this.taskSummary(event);
      const windowId = [...this.viewers.values()].find((view) => view.windowId !== undefined)?.windowId;
      const eligible = () => generation === this.generation && this.state.enabled && this.permission !== 'denied'
        && this.state.entries.filter((entry) => entry.conversationId === event.conversationId && !entry.read).at(-1)?.id === event.id
        && this.valid(event) && !this.viewed(event.conversationId);
      this.show(async () => {
        if (!eligible()) return;
        await this.dependencies.notify(event, summary, windowId, eligible);
        if (!eligible()) await this.dependencies.dismiss(event.conversationId, [event.id]);
      });
    }
  }

  private taskSummary(event: BackgroundTaskEvent) {
    const conversation = this.workspace?.conversations.find((entry) => entry.id === event.conversationId);
    const answerIndex = conversation?.messages.findIndex((message) => message.id === event.messageId && message.role === 'assistant') ?? -1;
    // A later queued question belongs to a different task. Only inspect input
    // preceding this event's answer, even if newer messages already exist.
    const question = answerIndex >= 0 ? conversation!.messages.slice(0, answerIndex).findLast((message) => message.role === 'user') : undefined;
    const text = question?.content.replace(/\s+/g, ' ').trim()
      || conversation?.title.replace(/\s+/g, ' ').trim() || '页脉对话';
    const characters = Array.from(text);
    return characters.length > 100 ? characters.slice(0, 99).join('') + '…' : text;
  }

  private valid(event: BackgroundTaskEvent) {
    if (!this.workspace) return true;
    return this.workspace.conversations.some((c) => c.id === event.conversationId && c.messages.some((m) => m.id === event.messageId));
  }

  private viewed(id: string) {
    return [...this.viewers.values()].some((view) => view.visible && view.conversationId === id);
  }

  private async presentation(operation: () => Promise<void>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('notification timeout')), 3_000); })]);
    } catch { this.issue = '浏览器提醒未能显示，未读标记仍会保留。'; this.publish(); }
    finally { if (timer) clearTimeout(timer); }
  }

  private show(operation: () => Promise<void>) { this.effects = this.effects.then(() => this.presentation(operation)); }
  whenPresented() { return this.effects; }

  snapshot(clientId?: string): TaskNotificationSnapshot {
    const unread = this.state.entries.filter((event) => !event.read);
    const view = clientId ? this.viewers.get(clientId) : undefined;
    const target = view?.windowId === undefined ? undefined : this.targets.get(view.windowId);
    return { unreadConversationIds: [...new Set(unread.map((event) => event.conversationId))],
      unreadEvents: unread.map(({ id, conversationId }) => ({ id, conversationId })),
      systemNotificationsEnabled: this.state.enabled, permission: this.permission, issue: this.issue, ...(target ? { target } : {}) };
  }

  private publish() {
    for (const [id, listener] of this.listeners) { try { listener(this.snapshot(id)); } catch { /* disconnected UI */ } }
  }

  private refresh() {
    this.show(() => this.dependencies.badge(this.snapshot().unreadConversationIds.length));
    this.publish();
  }

  start() { return this.enqueue(async () => { this.refresh(); }); }

  connect(clientId: string, listener: (snapshot: TaskNotificationSnapshot) => void) {
    this.listeners.set(clientId, listener);
    void this.start().catch(() => this.reportIssue('无法读取提醒状态，请重新打开插件。'));
    return () => { this.listeners.delete(clientId); this.viewers.delete(clientId); };
  }

  setPermission(permission: TaskNotificationSnapshot['permission']) {
    this.permission = permission;
    if (permission === 'denied') this.issue = '系统通知已被浏览器关闭，工具栏和对话提醒仍可使用。';
    this.publish();
  }

  reportIssue(issue: string) { this.issue = issue; this.publish(); }

  setTarget(windowId: number, target: TaskNotificationTarget) {
    if (this.workspace && !this.workspace.conversations.some((conversation) => conversation.id === target.conversationId)) { this.persistTargets(); return; }
    this.targets.set(windowId, target); this.persistTargets(); this.publish();
  }
  pendingTargets() { return Object.fromEntries(this.targets); }
  private persistTargets() { if (this.dependencies.targetsChanged) void this.dependencies.targetsChanged(this.pendingTargets()).catch(() => this.reportIssue('提醒定位状态未能保存，请从对话列表查看结果。')); }

  command(clientId: string, command: TaskNotificationCommand) {
    // Presence changes synchronously, before a queued completion checks it.
    if (command.kind === 'view') this.viewers.set(clientId, command.view);
    return this.enqueue(async () => {
      if (command.kind === 'target-seen') {
        const view = this.viewers.get(clientId);
        const target = view?.windowId === undefined ? undefined : this.targets.get(view.windowId);
        if (view && target?.token === command.token && target.conversationId === view.conversationId) { this.targets.delete(view.windowId!); this.persistTargets(); }
      } else if (command.kind === 'preference') {
        const candidate = { ...this.state, enabled: command.enabled };
        await this.dependencies.save(candidate);
        this.state = candidate;
      } else {
        const { view } = command;
        if (view.visible && view.conversationId) {
          const seen = new Set(view.seenEventIds);
          const candidate = { ...this.state, entries: this.state.entries.map((event) => event.conversationId === view.conversationId && seen.has(event.id) ? { ...event, read: true } : event) };
          await this.dependencies.save(candidate);
          this.state = candidate;
          const ids = candidate.entries.filter((event) => event.conversationId === view.conversationId && event.read).map((event) => event.id);
          this.show(() => this.dependencies.dismiss(view.conversationId!, ids));
        }
      }
      this.refresh();
    });
  }

  record(events: BackgroundTaskEvent[]) {
    for (const event of events) if (!this.pendingRecords.has(event.id)) this.pendingRecords.set(event.id, { ...event, read: this.viewed(event.conversationId) });
    return this.enqueue(async () => undefined).catch(() => undefined);
  }

  clear() {
    ++this.generation;
    this.pendingRecords.clear();
    this.retries = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    return this.enqueue(async () => {
      const entries = this.state.entries;
      const candidate = { ...this.state, entries: [] };
      this.targets.clear();
      this.persistTargets();
      await this.dependencies.save(candidate);
      this.state = candidate;
      if (this.issue?.includes('提醒状态暂时未能保存')) this.issue = undefined;
      for (const id of new Set(entries.map((event) => event.conversationId))) this.show(() => this.dependencies.dismiss(id, entries.filter((event) => event.conversationId === id).map((event) => event.id)));
      this.refresh();
    }, false);
  }

  reconcile(workspace: WorkspaceState) {
    this.workspace = workspace;
    return this.enqueue(async () => {
      let targetsRemoved = false;
      for (const [windowId, target] of this.targets) if (!workspace.conversations.some((conversation) => conversation.id === target.conversationId)) { this.targets.delete(windowId); targetsRemoved = true; }
      if (targetsRemoved) { this.persistTargets(); this.publish(); }
      const removed = this.state.entries.filter((event) => !this.valid(event));
      if (removed.length) {
        const candidate = { ...this.state, entries: this.state.entries.filter((event) => this.valid(event)) };
        await this.dependencies.save(candidate);
        this.state = candidate;
        for (const id of new Set(removed.map((event) => event.conversationId))) this.show(() => this.dependencies.dismiss(id, removed.filter((event) => event.conversationId === id).map((event) => event.id)));
        this.refresh();
      }
    });
  }
}
