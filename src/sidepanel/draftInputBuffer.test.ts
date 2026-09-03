import { describe, expect, it } from 'vitest';
import { DraftInputBuffer, type DraftInputTimerHost } from './draftInputBuffer';

class FakeTimers implements DraftInputTimerHost {
  private nextHandle = 1;
  private callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void) {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: number) {
    this.callbacks.delete(handle);
  }

  runAll() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

describe('draft input buffer', () => {
  it('keeps every deletion immediate while coalescing parent commits', () => {
    const timers = new FakeTimers();
    const commits: string[] = [];
    const buffer = new DraftInputBuffer('长内容'.repeat(80), timers);

    for (let index = 0; index < 40; index += 1) {
      buffer.update(buffer.value.slice(0, -1), (value) => commits.push(value));
    }

    expect(buffer.value.length).toBe('长内容'.repeat(80).length - 40);
    expect(commits).toEqual([]);
    timers.runAll();
    expect(commits).toEqual([buffer.value]);
  });

  it('flushes the latest draft at a conversation boundary and cancels the delayed echo', () => {
    const timers = new FakeTimers();
    const commits: string[] = [];
    const buffer = new DraftInputBuffer('原草稿', timers);

    buffer.update('切换前的最新草稿', (value) => commits.push(value));
    expect(buffer.flush((value) => commits.push(value))).toBe(true);
    timers.runAll();

    expect(commits).toEqual(['切换前的最新草稿']);
  });

  it('accepts external replacements only when no local edit is pending', () => {
    const timers = new FakeTimers();
    const buffer = new DraftInputBuffer('当前草稿', timers);

    buffer.update('本地正在输入', () => undefined);
    expect(buffer.syncExternal('较旧的父级值')).toBe(false);
    expect(buffer.value).toBe('本地正在输入');

    buffer.reset('已发送并清空');
    expect(buffer.syncExternal('从历史消息带回的内容')).toBe(true);
    expect(buffer.value).toBe('从历史消息带回的内容');
  });
});
