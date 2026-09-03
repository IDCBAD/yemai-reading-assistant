export interface DraftInputTimerHost {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

export class DraftInputBuffer {
  private timer: number | null = null;
  private currentValue: string;
  private committedValue: string;
  private dirty = false;

  constructor(
    initialValue: string,
    private readonly timers: DraftInputTimerHost,
    private readonly delay = 140,
  ) {
    this.currentValue = initialValue;
    this.committedValue = initialValue;
  }

  get value() {
    return this.currentValue;
  }

  update(value: string, commit: (value: string) => void) {
    this.currentValue = value;
    this.dirty = true;
    this.cancelTimer();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.commitPending(commit);
    }, this.delay);
  }

  flush(commit: (value: string) => void) {
    this.cancelTimer();
    return this.commitPending(commit);
  }

  reset(value: string) {
    this.cancelTimer();
    this.currentValue = value;
    this.committedValue = value;
    this.dirty = false;
  }

  syncExternal(value: string) {
    if (this.dirty || value === this.committedValue || value === this.currentValue) return false;
    this.reset(value);
    return true;
  }

  private commitPending(commit: (value: string) => void) {
    if (!this.dirty) return false;
    this.committedValue = this.currentValue;
    this.dirty = false;
    commit(this.currentValue);
    return true;
  }

  private cancelTimer() {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
