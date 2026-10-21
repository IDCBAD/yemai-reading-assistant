import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWordSpeechPlayback } from './wordSpeechPlayback';

function fixture() {
  const utterances: SpeechSynthesisUtterance[] = [];
  const engine = { speak: vi.fn(), cancel: vi.fn(), resume: vi.fn(), paused: false };
  const voice = { lang: 'en-US', localService: true } as SpeechSynthesisVoice;
  const onStart = vi.fn();
  const onFinish = vi.fn();
  let current = true;
  const playback = startWordSpeechPlayback({
    engine,
    createUtterance: () => {
      const utterance = { onstart: null, onend: null, onerror: null } as SpeechSynthesisUtterance;
      utterances.push(utterance);
      return utterance;
    },
    text: 'predictable', rate: .82, voice,
    isCurrent: () => current,
    onStart, onFinish,
  });
  const emit = (index: number, type: 'start' | 'end' | 'error', error = 'synthesis-failed') => {
    const utterance = utterances[index]!;
    if (type === 'error') utterance.onerror?.call(utterance, { error } as SpeechSynthesisErrorEvent);
    else utterance[`on${type}`]?.call(utterance, {} as SpeechSynthesisEvent);
  };
  return { engine, voice, onStart, onFinish, utterances, playback, emit, invalidate: () => { current = false; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('word speech playback lifecycle', () => {
  it('retries end-before-start once in a new task with a new default-voice utterance', async () => {
    const test = fixture();
    expect(test.utterances[0]?.voice).toBe(test.voice);
    test.emit(0, 'end');
    expect(test.onFinish).not.toHaveBeenCalled();
    expect(test.onStart).not.toHaveBeenCalled();
    expect(test.engine.speak).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.engine.speak).toHaveBeenCalledTimes(2);
    expect(test.utterances[1]).not.toBe(test.utterances[0]);
    expect(test.utterances[1]).toMatchObject({ voice: null, lang: 'en-US', rate: .82 });
    test.emit(1, 'end');
    await vi.runAllTimersAsync();
    expect(test.engine.speak).toHaveBeenCalledTimes(2);
    expect(test.onFinish).toHaveBeenCalledExactlyOnceWith('浏览器未能启动朗读，请重试。');
    expect(test.onStart).not.toHaveBeenCalled();
  });

  it('reports a successful retry only after start and its normal end', async () => {
    const test = fixture();
    test.emit(0, 'end');
    await vi.advanceTimersByTimeAsync(0);
    test.emit(1, 'start');
    expect(test.onStart).toHaveBeenCalledTimes(1);
    expect(test.onFinish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.onFinish).not.toHaveBeenCalled();
    test.emit(1, 'end');
    expect(test.onFinish).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('does not issue a queued retry after cancellation', async () => {
    const test = fixture();
    test.emit(0, 'end');
    test.playback.cancel();
    await vi.runAllTimersAsync();
    test.emit(0, 'start');
    test.emit(0, 'error');
    expect(test.engine.speak).toHaveBeenCalledTimes(1);
    expect(test.engine.cancel).toHaveBeenCalledTimes(1);
    expect(test.onStart).not.toHaveBeenCalled();
    expect(test.onFinish).not.toHaveBeenCalled();
  });

  it('rejects a retry when the card generation or visibility is no longer current', async () => {
    const test = fixture();
    test.emit(0, 'end');
    test.invalidate();
    await vi.runAllTimersAsync();
    test.emit(0, 'start');
    expect(test.engine.speak).toHaveBeenCalledTimes(1);
    expect(test.onStart).not.toHaveBeenCalled();
    expect(test.onFinish).not.toHaveBeenCalled();
    expect(test.engine.cancel).not.toHaveBeenCalled();
  });

  it('ignores old attempt events while the retry is active and after it finishes', async () => {
    const test = fixture();
    test.emit(0, 'end');
    await vi.advanceTimersByTimeAsync(0);
    test.emit(0, 'start');
    test.emit(0, 'error');
    test.emit(0, 'end');
    expect(test.onStart).not.toHaveBeenCalled();
    expect(test.onFinish).not.toHaveBeenCalled();
    test.emit(1, 'start');
    test.emit(1, 'end');
    test.emit(1, 'start');
    test.emit(1, 'error');
    expect(test.onStart).toHaveBeenCalledTimes(1);
    expect(test.onFinish).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('ignores events from a superseded request without cancelling a newer request', async () => {
    const test = fixture();
    test.invalidate();
    test.emit(0, 'start');
    test.emit(0, 'end');
    test.emit(0, 'error');
    await vi.runAllTimersAsync();
    expect(test.onStart).not.toHaveBeenCalled();
    expect(test.onFinish).not.toHaveBeenCalled();
    expect(test.engine.cancel).not.toHaveBeenCalled();
  });

  it('keeps the five-second startup timeout and cancels a stuck attempt', async () => {
    const test = fixture();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(test.engine.cancel).toHaveBeenCalledTimes(1);
    expect(test.onFinish).toHaveBeenCalledExactlyOnceWith('语音没有启动，请检查浏览器的英语语音后重试。');
    expect(test.onStart).not.toHaveBeenCalled();
    test.emit(0, 'start');
    expect(test.onStart).not.toHaveBeenCalled();
  });

  it('shows genuine synthesis errors and does not attempt voice enumeration', () => {
    const test = fixture();
    test.emit(0, 'error');
    expect(test.onFinish).toHaveBeenCalledExactlyOnceWith('英语语音暂时不可用，请检查浏览器语音后重试。');
    expect(test.engine.speak).toHaveBeenCalledTimes(1);
  });
});
