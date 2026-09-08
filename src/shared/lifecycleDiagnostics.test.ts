import { afterEach, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  writes: 0,
}));
vi.mock('wxt/browser', () => ({ browser: { storage: { session: {
  async get() { return { ...session.values }; },
  async set(values: Record<string, unknown>) { session.writes += 1; Object.assign(session.values, values); },
  async remove(keys: string[]) { keys.forEach((key) => delete session.values[key]); },
} } } }));

async function load(mode: string) {
  vi.resetModules();
  vi.stubEnv('MODE', mode);
  session.values = {};
  session.writes = 0;
  return import('./lifecycleDiagnostics');
}

afterEach(() => { vi.unstubAllEnvs(); });

it('does not write or read resource providers in normal builds', async () => {
  const diagnostics = await load('production');
  const read = vi.fn(() => ({ uploads: 1 }));
  diagnostics.startLifecycleDiagnostics('panel');
  diagnostics.setDiagnosticResources(read);
  diagnostics.recordDiagnosticResources();
  diagnostics.recordLifecycle('test');
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  expect(session.writes).toBe(0);
});

it('bounds each instance log while preserving its startup and latest event', async () => {
  const diagnostics = await load('diagnostic');
  diagnostics.startLifecycleDiagnostics('panel');
  for (let index = 0; index < 150; index += 1) diagnostics.recordLifecycle('sample', { index });
  await vi.waitFor(() => expect(session.writes).toBe(151));
  const log = Object.values(session.values)[0] as { events: Array<{ event: string; counts: { index?: number } }>; droppedEvents: number };
  expect(log.events).toHaveLength(120);
  expect(log.events[0]?.event).toBe('context-start');
  expect(log.events.at(-1)?.counts.index).toBe(149);
  expect(log.droppedEvents).toBe(31);
});

it('deduplicates unchanged resource counts instead of writing on every render', async () => {
  const diagnostics = await load('diagnostic');
  diagnostics.startLifecycleDiagnostics('panel');
  let uploads = 1;
  diagnostics.setDiagnosticResources(() => ({ uploads }));
  for (let index = 0; index < 50; index += 1) diagnostics.recordDiagnosticResources();
  uploads = 0;
  diagnostics.recordDiagnosticResources();
  await vi.waitFor(() => expect(session.writes).toBe(3));
});

it('prunes only diagnostic contexts and preserves unrelated session data', async () => {
  const diagnostics = await load('diagnostic');
  session.values.pendingSelectionQuotes = ['private-test-content'];
  for (let index = 0; index < 60; index += 1) {
    session.values[`yemaiLifecycleDiagnostic:old-${index}`] = { startedAt: index };
  }
  diagnostics.startLifecycleDiagnostics('background');
  await vi.waitFor(() => expect(Object.keys(session.values).filter((key) => key.startsWith('yemaiLifecycleDiagnostic:')).length).toBe(48));
  expect(session.values.pendingSelectionQuotes).toEqual(['private-test-content']);
});
