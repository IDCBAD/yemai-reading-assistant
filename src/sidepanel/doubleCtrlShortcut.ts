interface ShortcutKeyEvent {
  key: string;
  timeStamp: number;
  repeat: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const DOUBLE_CTRL_WINDOW_MS = 450;

export class DoubleCtrlShortcut {
  private held = false;
  private interrupted = false;
  private suppressRelease = false;
  private heldSelectionKey: string | null = null;
  private lastReleaseAt: number | null = null;
  private lastSelectionKey: string | null = null;

  reset(): void {
    this.held = false;
    this.interrupted = false;
    this.suppressRelease = false;
    this.heldSelectionKey = null;
    this.lastReleaseAt = null;
    this.lastSelectionKey = null;
  }

  keyDown(event: ShortcutKeyEvent, selectionKey: string | null): boolean {
    if (event.key !== 'Control') {
      if (this.held) this.interrupted = true;
      this.lastReleaseAt = null;
      return false;
    }
    if (event.repeat || this.held) return false;
    this.held = true;
    this.heldSelectionKey = selectionKey;
    if (!selectionKey || event.altKey || event.metaKey || event.shiftKey) {
      this.interrupted = true;
      this.lastReleaseAt = null;
      return false;
    }
    if (this.lastReleaseAt !== null
      && event.timeStamp - this.lastReleaseAt <= DOUBLE_CTRL_WINDOW_MS
      && this.lastSelectionKey === selectionKey) {
      this.lastReleaseAt = null;
      this.suppressRelease = true;
      return true;
    }
    this.lastReleaseAt = null;
    return false;
  }

  keyUp(event: ShortcutKeyEvent, selectionKey: string | null): void {
    if (event.key !== 'Control' || !this.held) return;
    this.held = false;
    if (this.suppressRelease) {
      this.suppressRelease = false;
      this.lastReleaseAt = null;
    } else if (!this.interrupted && selectionKey && selectionKey === this.heldSelectionKey) {
      this.lastReleaseAt = event.timeStamp;
      this.lastSelectionKey = selectionKey;
    } else {
      this.lastReleaseAt = null;
    }
    this.interrupted = false;
    this.heldSelectionKey = null;
  }
}
