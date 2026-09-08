import { browser } from 'wxt/browser';

export const DIAGNOSTICS_ENABLED = import.meta.env.MODE === 'diagnostic';
const PREFIX = 'yemaiLifecycleDiagnostic:';
const MAX_CONTEXTS = 48;
const MAX_EVENTS = 120;
type Counts = Record<string, number | boolean>;
interface DiagnosticEvent { at: number; event: string; counts: Counts }
interface ContextLog {
  schema: 1;
  role: 'panel' | 'background';
  instance: string;
  startedAt: number;
  droppedEvents: number;
  events: DiagnosticEvent[];
}

let log: ContextLog | undefined;
let pendingWrite: Promise<void> = Promise.resolve();
let failedWrites = 0;
let resources: (() => Counts) | undefined;
let previousResources = '';

function persist() {
  if (!log) return pendingWrite;
  // Capture now; subsequent events must not mutate a queued storage write.
  const value = structuredClone(log);
  pendingWrite = pendingWrite.then(() => browser.storage.session.set({
    [`${PREFIX}${value.instance}`]: value,
  })).catch(() => { failedWrites += 1; });
  return pendingWrite;
}

export function recordLifecycle(event: string, counts: Counts = {}) {
  if (!DIAGNOSTICS_ENABLED || !log) return;
  log.events.push({ at: Date.now(), event, counts });
  if (log.events.length > MAX_EVENTS) {
    log.events.splice(1, log.events.length - MAX_EVENTS);
    log.droppedEvents += 1;
  }
  void persist();
}

export function startLifecycleDiagnostics(role: ContextLog['role']) {
  if (!DIAGNOSTICS_ENABLED || log) return;
  log = { schema: 1, role, instance: crypto.randomUUID(), startedAt: Date.now(), droppedEvents: 0, events: [] };
  recordLifecycle('context-start');
  // Event-driven retention only: no polling, heartbeat, or keep-alive port.
  void browser.storage.session.get(null).then((stored) => {
    const old = Object.entries(stored)
      .filter(([key]) => key.startsWith(PREFIX) && key !== `${PREFIX}${log!.instance}`)
      .sort((a, b) => Number((b[1] as ContextLog).startedAt) - Number((a[1] as ContextLog).startedAt))
      .slice(MAX_CONTEXTS - 1)
      .map(([key]) => key);
    if (old.length) return browser.storage.session.remove(old);
  }).catch(() => { failedWrites += 1; });
}

export function setDiagnosticResources(read: () => Counts) {
  if (DIAGNOSTICS_ENABLED) resources = read;
}

export function recordDiagnosticResources() {
  if (!DIAGNOSTICS_ENABLED || !resources) return;
  const counts = resources();
  const signature = JSON.stringify(counts);
  if (signature === previousResources) return;
  previousResources = signature;
  recordLifecycle('resources-changed', counts);
}

export function installPanelDiagnostics() {
  if (!DIAGNOSTICS_ENABLED) return;
  startLifecycleDiagnostics('panel');
  const snapshot = () => ({ ...resources?.(), hidden: document.hidden });
  document.addEventListener('visibilitychange', () => recordLifecycle('visibility', snapshot()));
  window.addEventListener('pagehide', (event) => recordLifecycle('pagehide', { ...snapshot(), persisted: event.persisted }));
  window.addEventListener('pageshow', (event) => recordLifecycle('pageshow', { ...snapshot(), persisted: event.persisted }));

  const toolbar = document.createElement('div');
  toolbar.setAttribute('aria-label', '生命周期诊断');
  toolbar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;display:flex;gap:6px;padding:6px;border:1px solid #ccd2dc;border-radius:8px;background:#fff;color:#222;font:12px system-ui;box-shadow:0 2px 8px #0002';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = '诊断版';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '导出诊断';
  button.style.cssText = 'font:inherit;min-height:28px;padding:3px 8px;cursor:pointer';
  button.addEventListener('click', () => {
    button.disabled = true;
    status.textContent = '正在导出';
    recordLifecycle('manual-export', snapshot());
    void pendingWrite.then(async () => {
      const stored = await browser.storage.session.get(null);
      const contexts = Object.entries(stored)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([, value]) => value as ContextLog)
        .sort((a, b) => a.startedAt - b.startedAt);
      const report = {
        schema: 1,
        exportedAt: Date.now(),
        build: browser.runtime.getManifest().version_name,
        browser: navigator.userAgent,
        failedWritesInExportingPanel: failedWrites,
        limits: { maxContexts: MAX_CONTEXTS, maxEventsPerContext: MAX_EVENTS },
        notes: ['Event-driven diagnostic; storage calls can briefly extend worker activity.', 'Missing pagehide is not proof of a leak; browser teardown may interrupt its storage write.', 'Counts are application resources, not OS process counts or a heap measurement.'],
        contexts,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `yemai-lifecycle-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      status.textContent = failedWrites ? '部分记录写入失败' : '已发起下载';
    }).catch(() => { status.textContent = '导出失败，请重试'; })
      .finally(() => { button.disabled = false; });
  });
  toolbar.append(status, button);
  document.body.append(toolbar);
}
