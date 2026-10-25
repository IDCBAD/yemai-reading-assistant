import { beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  add: vi.fn(), remove: vi.fn(), getPlatformInfo: vi.fn(async () => ({})),
  updated: vi.fn(), removed: vi.fn(), handle: vi.fn(() => false), dispose: vi.fn(), create: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'extension-id', getPlatformInfo: f.getPlatformInfo,
    onMessage: { addListener: f.add, removeListener: f.remove } },
  tabs: { onUpdated: { addListener: f.updated }, onRemoved: { addListener: f.removed } },
} }));
vi.mock('./pageReadingRuntime', () => ({ createPageReadingRuntime: f.create }));
vi.mock('../data/pageReadingRepository', () => ({ PageReadingRepository: class {} }));
vi.mock('../services/workosConnection', () => ({ loadWorkosConnectionSettings: vi.fn() }));
vi.mock('./createTransport', () => ({ createBackgroundTransport: vi.fn() }));
import { registerPageReadingAnalysis } from './registerPageReading';

beforeEach(() => {
  vi.clearAllMocks();
  f.create.mockReturnValue({ handle: f.handle, dispose: f.dispose, ready: Promise.resolve() });
});
describe('article runtime registration', () => {
  it('registers message handling and keepalive without tying analysis to tab navigation/removal', async () => {
    const registered = registerPageReadingAnalysis();
    expect(f.add).toHaveBeenCalledWith(f.handle);
    expect(f.updated).not.toHaveBeenCalled();
    expect(f.removed).not.toHaveBeenCalled();
    const dependencies = f.create.mock.calls[0]![0];
    expect(dependencies.extensionId).toBe('extension-id');
    await dependencies.keepAlive();
    expect(f.getPlatformInfo).toHaveBeenCalledTimes(1);
    registered.dispose();
    expect(f.remove).toHaveBeenCalledWith(f.handle);
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
