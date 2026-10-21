import { useCallback, useEffect, useRef, useState } from 'react';
import { startWordSpeechPlayback } from './wordSpeechPlayback';

export function useWordSpeech(cardId: string | undefined, open: boolean, autoWord?: string, paused = false) {
  const [playing, setPlaying] = useState<'word' | 'sentence' | null>(null);
  const playingRef = useRef<'word' | 'sentence' | null>(null);
  const [issue, setIssue] = useState('');
  const generation = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playback = useRef<ReturnType<typeof startWordSpeechPlayback> | null>(null);
  const lastAuto = useRef<{ cardId: string; word: string } | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    clearTimeout(autoTimer.current);
    if (playback.current) playback.current.cancel();
    else if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    playback.current = null;
    playingRef.current = null;
    setPlaying(null);
  }, []);

  const speak = useCallback((text: string, kind: 'word' | 'sentence') => {
    if (playingRef.current === kind) { stop(); return; }
    stop();
    setIssue('');
    if (!text.trim() || (typeof document !== 'undefined' && document.hidden)) return;
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      setIssue('当前浏览器不支持朗读。'); return;
    }
    const request = generation.current;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang === 'en-US' && item.localService)
      ?? voices.find((item) => item.lang.startsWith('en-US'))
      ?? voices.find((item) => item.lang.startsWith('en')) ?? null;
    playback.current = startWordSpeechPlayback({
      engine: speechSynthesis,
      createUtterance: (value) => new SpeechSynthesisUtterance(value),
      text,
      rate: kind === 'word' ? .82 : .9,
      voice,
      isCurrent: () => generation.current === request && !document.hidden,
      onStart: () => { playingRef.current = kind; setPlaying(kind); },
      onFinish: (message) => {
        playingRef.current = null;
        setPlaying(null);
        if (message) setIssue(message);
      },
    });
  }, [stop]);

  useEffect(() => {
    stop();
    setIssue('');
    if (!open || !cardId || !autoWord?.trim()) {
      lastAuto.current = null;
      return stop;
    }
    const alreadyRead = lastAuto.current?.cardId === cardId && lastAuto.current.word === autoWord;
    // Opening a directory consumes the current word's auto-play request. Closing it
    // stays quiet; selecting another card creates a new request through cardId.
    if (paused) lastAuto.current = { cardId, word: autoWord };
    else if (!alreadyRead && !document.hidden) {
      autoTimer.current = setTimeout(() => {
        lastAuto.current = { cardId, word: autoWord };
        speak(autoWord, 'word');
      }, 120);
    }
    return stop;
  }, [cardId, open, autoWord, paused, speak, stop]);

  useEffect(() => {
    const handleVisibilityChange = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [stop]);

  return { playing, issue, speak, stop };
}
