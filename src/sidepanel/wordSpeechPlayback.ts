interface WordSpeechPlaybackOptions {
  engine: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'resume' | 'paused'>;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  text: string;
  rate: number;
  voice: SpeechSynthesisVoice | null;
  isCurrent: () => boolean;
  onStart: () => void;
  onFinish: (issue?: string) => void;
}

/** One playback request, including a single fallback for Chrome's end-before-start case. */
export function startWordSpeechPlayback(options: WordSpeechPlaybackOptions): { cancel: () => void } {
  let active = true;
  let attempt = 0;
  let utterance: SpeechSynthesisUtterance | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = () => active && options.isCurrent();
  const clearTimers = () => { clearTimeout(startupTimer); clearTimeout(retryTimer); };
  const finish = (issue?: string, cancelEngine = false) => {
    if (!isCurrent()) return;
    active = false;
    clearTimers();
    utterance = null;
    if (cancelEngine) options.engine.cancel();
    options.onFinish(issue);
  };
  const beginAttempt = (voice: SpeechSynthesisVoice | null) => {
    if (!isCurrent()) return;
    const currentAttempt = ++attempt;
    let started = false;
    let settled = false;
    const acceptsEvent = () => isCurrent() && attempt === currentAttempt && !settled;
    try {
      utterance = options.createUtterance(options.text);
      utterance.lang = 'en-US';
      utterance.rate = options.rate;
      utterance.voice = voice;
      utterance.onstart = () => {
        if (!acceptsEvent()) return;
        started = true;
        clearTimeout(startupTimer);
        options.onStart();
      };
      utterance.onend = () => {
        if (!acceptsEvent()) return;
        settled = true;
        clearTimeout(startupTimer);
        if (started) { finish(); return; }
        if (currentAttempt === 1) {
          // A new task and utterance let Chrome choose its own English voice once.
          retryTimer = setTimeout(() => beginAttempt(null), 0);
        } else {
          finish('浏览器未能启动朗读，请重试。');
        }
      };
      utterance.onerror = (event) => {
        if (!acceptsEvent()) return;
        settled = true;
        finish(['canceled', 'interrupted'].includes(event.error)
          ? undefined : '英语语音暂时不可用，请检查浏览器语音后重试。');
      };
      startupTimer = setTimeout(() => {
        if (!acceptsEvent()) return;
        settled = true;
        finish('语音没有启动，请检查浏览器的英语语音后重试。', true);
      }, 5_000);
      options.engine.speak(utterance);
      if (isCurrent() && options.engine.paused) options.engine.resume();
    } catch {
      finish('英语语音暂时不可用，请检查浏览器语音后重试。', true);
    }
  };

  beginAttempt(options.voice);
  return {
    cancel() {
      if (!active) return;
      active = false;
      clearTimers();
      utterance = null;
      options.engine.cancel();
    },
  };
}
