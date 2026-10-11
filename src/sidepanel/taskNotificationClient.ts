import { browser } from 'wxt/browser';
import { TASK_NOTIFICATION_PORT, type TaskNotificationCommand, type TaskNotificationSnapshot, type TaskNotificationView } from '../shared/taskNotifications';

/** Presentation subscription only; reconnecting never submits a WorkOS task. */
export class TaskNotificationClient {
  private port?: ReturnType<typeof browser.runtime.connect>;
  private generation = 0;
  private disposed = false;
  private hydrated = false;
  private view: TaskNotificationView = { visible: false, seenEventIds: [] };
  private sentView?: string;
  private readonly pendingAcknowledgements = new Set<string>();
  constructor(private readonly changed: (snapshot: TaskNotificationSnapshot) => void) {}

  connect() {
    if (this.port || this.disposed) return this.port;
    const generation = ++this.generation;
    this.hydrated = false;
    this.sentView = undefined;
    const port = browser.runtime.connect({ name: TASK_NOTIFICATION_PORT });
    this.port = port;
    port.onMessage.addListener((snapshot: TaskNotificationSnapshot) => {
      if (this.disposed || generation !== this.generation || !Array.isArray(snapshot.unreadEvents)) return;
      const first = !this.hydrated;
      this.hydrated = true;
      this.changed(snapshot);
      if (first) { this.sendView(); this.flushAcknowledgements(); }
    });
    port.onDisconnect.addListener(() => {
      if (generation !== this.generation) return;
      this.port = undefined;
      this.hydrated = false;
    });
    return port;
  }
  report(view: TaskNotificationView) { this.view = view; this.connect(); if (this.hydrated) { this.sendView(); this.flushAcknowledgements(); } }
  private flushAcknowledgements() {
    if (!this.hydrated || this.view.windowId === undefined || !this.view.conversationId) return;
    for (const token of [...this.pendingAcknowledgements]) {
      this.pendingAcknowledgements.delete(token);
      this.post({ kind: 'target-seen', token });
    }
  }
  private sendView() {
    const signature = JSON.stringify(this.view);
    if (signature === this.sentView) return;
    this.sentView = signature;
    this.post({ kind: 'view', view: this.view });
  }
  private post(command: TaskNotificationCommand) {
    if (this.disposed) return;
    this.connect();
    try { this.port?.postMessage(command); }
    catch {
      const port = this.port;
      this.port = undefined;
      this.generation++;
      port?.disconnect();
      const reconnected = this.connect();
      if (command.kind === 'target-seen') { this.pendingAcknowledgements.add(command.token); return; }
      // View/preference/target acknowledgement are idempotent. No execution
      // command is carried on this port.
      try { reconnected?.postMessage(command); } catch { /* A later focus retries. */ }
    }
  }
  setEnabled(enabled: boolean) { this.post({ kind: 'preference', enabled }); }
  acknowledgeTarget(token: string) { this.pendingAcknowledgements.add(token); this.flushAcknowledgements(); }
  disconnect() { this.disposed = true; this.generation++; this.port?.disconnect(); this.port = undefined; }
}
