import { describe, expect, it } from 'vitest';
import { DoubleCtrlShortcut } from './doubleCtrlShortcut';

const ctrl = (timeStamp: number, repeat = false) => ({
  key: 'Control', timeStamp, repeat, altKey: false, metaKey: false, shiftKey: false,
});

describe('double Ctrl translation shortcut', () => {
  it('fires after two released Ctrl presses on the same selection', () => {
    const shortcut = new DoubleCtrlShortcut();
    expect(shortcut.keyDown(ctrl(100), 'message:word')).toBe(false);
    shortcut.keyUp(ctrl(150), 'message:word');
    expect(shortcut.keyDown(ctrl(300), 'message:word')).toBe(true);
    shortcut.keyUp(ctrl(350), 'message:word');
    expect(shortcut.keyDown(ctrl(400), 'message:word')).toBe(false);
  });

  it('does not fire for a held key, a slow second press, or a different selection', () => {
    const shortcut = new DoubleCtrlShortcut();
    shortcut.keyDown(ctrl(100), 'message:word');
    expect(shortcut.keyDown(ctrl(130, true), 'message:word')).toBe(false);
    shortcut.keyUp(ctrl(150), 'message:word');
    expect(shortcut.keyDown(ctrl(700), 'message:word')).toBe(false);
    shortcut.keyUp(ctrl(750), 'message:word');
    expect(shortcut.keyDown(ctrl(800), 'message:other')).toBe(false);
  });

  it('does not fire after another shortcut key or inside an editable target', () => {
    const shortcut = new DoubleCtrlShortcut();
    shortcut.keyDown(ctrl(100), 'message:word');
    shortcut.keyDown({ ...ctrl(120), key: 'c' }, 'message:word');
    shortcut.keyUp(ctrl(150), 'message:word');
    expect(shortcut.keyDown(ctrl(200), 'message:word')).toBe(false);
    shortcut.keyUp(ctrl(220), 'message:word');
    expect(shortcut.keyDown(ctrl(280), null)).toBe(false);
  });

  it('clears a partial sequence if the panel loses focus', () => {
    const shortcut = new DoubleCtrlShortcut();
    shortcut.keyDown(ctrl(100), 'message:word');
    shortcut.keyUp(ctrl(150), 'message:word');
    shortcut.reset();
    expect(shortcut.keyDown(ctrl(200), 'message:word')).toBe(false);
  });
});
