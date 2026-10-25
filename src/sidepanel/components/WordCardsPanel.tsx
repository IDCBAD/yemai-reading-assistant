import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { browser } from 'wxt/browser';
import type { WordCard, WordMeaningSource, WordMeaningFieldSnapshot, WordSentenceTranslationFieldSnapshot } from '../../shared/wordCards';
import { loadWordCards } from '../../services/wordCardStorage';
import { lookupWordPronunciation } from '../../services/wordPronunciation';
import { removeCollectedWord, restoreCollectedWord, updateCollectedWordMeaning, updateCollectedWordSentenceTranslation } from '../../services/wordCollectionClient';
import { initializeLocalTranslation, localTranslationAvailability } from '../localTranslator';
import { canTranslateText } from '../../shared/wordTranslation';
import type { TranslationPreference } from '../../shared/wordTranslation';
import { isRemoteManualPreference, manualTranslationLabel, translateManually } from '../manualTranslation';
import { useTranslationPreference } from '../useTranslationPreference';
import { startWordEnrichment, type WordEnrichmentPhase } from '../wordEnrichment';
import { useWordSpeech } from '../useWordSpeech';
import { KoboyoIcon } from './KoboyoIcon';
import { CollectionTabs } from './CollectionTabs';
import { WordAudioIcon } from './WordAudioIcon';
import { WordCardDirectory, WordCardNavigation } from './WordCardNavigation';
import { CollectionHeaderActions, useCollectionEscape } from './CollectionSurface';
import '../wordCards.css';

export interface WordCardsPanelProps { open: boolean; onClose: () => void; onShowAnswers: () => void; embedded?: boolean; onCountChange?: (count: number) => void }

/** A click translates one field only; late replies must not reach a different card or service. */
export async function requestWordCardReferenceTranslation(card: WordCard, field: 'meaning' | 'sentence', preference: TranslationPreference,
  isCurrent: () => boolean, onDownloadProgress?: (progress: number) => void) {
  const text = field === 'sentence' ? card.sentence : card.word;
  if (!canTranslateText(text)) throw new Error('请选择不超过 5000 字符的英文内容。');
  // This call runs before the first await, preserving native browser user activation.
  const result = await translateManually(text, { preference, onDownloadProgress });
  if (!isCurrent()) return null;
  const translation = result.translation.trim();
  if (!translation || translation.length > (field === 'sentence' ? 4_000 : 2_000)) throw new Error('译文为空或超过当前字段的长度限制，请手动编辑。');
  return { ...result, translation };
}

function sourceUrl(card: WordCard) {
  try { const url = new URL(card.source.url ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function sourceLabel(card: WordCard) {
  const url = sourceUrl(card);
  return url ? new URL(url).hostname.replace(/^www\./u, '') : card.source.kind === 'assistant' ? '页脉回答' : card.source.title;
}

function SourceSentence({ card }: { card: WordCard }) {
  const { sentence, highlightStart: start, highlightEnd: end } = card;
  return <blockquote className="word-card-sentence" lang="en">{start !== undefined && end !== undefined
    ? <>{sentence.slice(0, start)}<mark>{sentence.slice(start, end)}</mark>{sentence.slice(end)}</> : sentence}</blockquote>;
}

export function WordCardsPanel({ open, onClose, onShowAnswers, embedded = false, onCountChange }: WordCardsPanelProps) {
  const [cards, setCards] = useState<WordCard[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryAnimate, setDirectoryAnimate] = useState(false);
  const directoryId = useId();
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<'meaning' | 'sentence' | null>(null);
  const [draft, setDraft] = useState('');
  const [draftSource, setDraftSource] = useState<WordMeaningSource>('manual');
  const [busy, setBusy] = useState<string>();
  const [translationBusy, setTranslationBusy] = useState<string>();
  const [translationProgress, setTranslationProgress] = useState<number>();
  const [translatorAvailable, setTranslatorAvailable] = useState(false);
  const [undo, setUndo] = useState<WordCard | null>(null);
  const [animate, setAnimate] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>();
  const [pronunciation, setPronunciation] = useState<{ word: string; ipa: string | null }>();
  const [retryEnrichment, setRetryEnrichment] = useState(0);
  const [enrichment, setEnrichment] = useState<{ id?: string; meaning: WordEnrichmentPhase; sentence: WordEnrichmentPhase }>({ meaning: 'idle', sentence: 'idle' });
  const [preparingTranslation, setPreparingTranslation] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState<number>();
  const { preference: translationPreference, issue: translationPreferenceIssue } = useTranslationPreference();
  const remoteTranslation = Boolean(translationPreference && isRemoteManualPreference(translationPreference));
  const manualTranslationAvailable = Boolean(translationPreference && (remoteTranslation || translatorAvailable));
  const translationLabel = manualTranslationLabel(translationPreference);
  const root = useRef<HTMLElement>(null);
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const translationRequest = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editVersion = useRef<number | undefined>(undefined);
  const meaningSnapshot = useRef<WordMeaningFieldSnapshot | undefined>(undefined);
  const sentenceSnapshot = useRef<WordSentenceTranslationFieldSnapshot | undefined>(undefined);
  const mounted = useRef(true);
  const selected = cards.find((card) => card.id === selectedId) ?? cards[0];
  const currentId = useRef(selected?.id);
  currentId.current = selected?.id;
  const currentCaptureKey = useRef(selected?.captureKey);
  currentCaptureKey.current = selected?.captureKey;
  const currentPreference = useRef(translationPreference);
  currentPreference.current = translationPreference;
  const index = selected ? cards.indexOf(selected) : -1;
  const speech = useWordSpeech(selected?.id, open, autoplay && !editing ? selected?.word : undefined, directoryOpen);
  const ipa = pronunciation?.word === selected?.word ? pronunciation?.ipa : undefined;
  const receiveEnrichedCard = useCallback((updated: WordCard) => {
    setCards((rows) => rows.map((row) => row.id === updated.id && row.captureKey === updated.captureKey && row.updatedAt <= updated.updatedAt ? updated : row));
  }, []);
  useEffect(() => { if (!loading) onCountChange?.(cards.length); }, [cards.length, loading, onCountChange]);
  useEffect(() => {
    if (!open || !selected || editing || directoryOpen || translationBusy === selected.id) return;
    const card = selected;
    setEnrichment({ id: card.id, meaning: card.meaning || card.meaningSource === 'manual' ? 'ready' : 'loading', sentence: card.sentenceTranslation || card.sentenceTranslationSource === 'manual' || !card.sentence ? 'ready' : 'loading' });
    let task: ReturnType<typeof startWordEnrichment> | undefined;
    // Keep dictionary parsing and translation out of the shell's entrance frame.
    const timer = setTimeout(() => {
      task = startWordEnrichment(card, {
        onPhase: (field, phase) => setEnrichment((current) => current.id === card.id ? { ...current, [field]: phase } : current),
        onSaved: receiveEnrichedCard,
      });
    }, 200);
    return () => { clearTimeout(timer); task?.cancel(); };
  }, [open, selected?.id, selected?.captureKey, editing, directoryOpen, translationBusy, retryEnrichment, receiveEnrichedCard]);
  useEffect(() => {
    if (!open || !selected?.word) return;
    let current = true;
    const word = selected.word;
    void lookupWordPronunciation(word).then((value) => { if (current) setPronunciation({ word, ipa: value }); });
    return () => { current = false; };
  }, [open, selected?.word]);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const rows = await loadWordCards();
      if (mounted.current && current === request.current) { setCards(rows); setIssue(''); }
    } catch { if (mounted.current && current === request.current) setIssue('暂时无法读取单词收藏，请重试。'); }
    finally { if (mounted.current && current === request.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = open;
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    void refresh();
    void browser.storage.local.get('wordCardAutoplay').then((values) => { if (mounted.current) setAutoplay(values.wordCardAutoplay !== false); }).catch(() => { if (mounted.current) setAutoplay(true); });
    void localTranslationAvailability().then((status) => { if (mounted.current) setTranslatorAvailable(status !== 'unavailable'); });
    const listener = (message: { type?: string }) => { if (message.type === 'wordcards:changed') void refresh(); };
    browser.runtime.onMessage.addListener(listener);
    if (!embedded) directoryTrigger.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false; request.current++; translationRequest.current++; clearTimeout(undoTimer.current);
      browser.runtime.onMessage.removeListener(listener);
      if (!embedded) {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('[data-reading-cards-trigger]')?.focus({ preventScroll: true });
      }
    };
  }, [open, refresh, embedded]);
  useEffect(() => {
    if (open) return;
    translationRequest.current++;
    setTranslationBusy(undefined); setTranslationProgress(undefined);
    setEditing(null); setDraft(''); setUndo(null); setIssue(''); setAnimate(false);
    setPreparingTranslation(false); setPreparationProgress(undefined); setDirectoryOpen(false);
  }, [open]);
  useEffect(() => { translationRequest.current++; setTranslationBusy(undefined); setEditing(null); setDraft(''); setIssue(''); }, [selected?.id]);
  useEffect(() => {
    translationRequest.current++;
    setTranslationBusy(undefined); setTranslationProgress(undefined);
    setPreparingTranslation(false); setPreparationProgress(undefined);
  }, [translationPreference]);

  const navigate = (step: number, keyboard: boolean) => {
    if (cards.length < 2 || editing || busy || directoryOpen) return;
    const id = cards[(index + step + cards.length) % cards.length]!.id;
    setAnimate(!keyboard); setSelectedId(id); content.current?.scrollTo({ top: 0 });
  };
  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    if (!next) speech.stop();
    void browser.storage.local.set({ wordCardAutoplay: next }).catch(() => { setAutoplay(!next); setIssue('自动发音设置未保存，请重试。'); });
  };
  const beginEditing = (field: 'meaning' | 'sentence' = 'meaning') => {
    if (!selected) return;
    translationRequest.current++; setTranslationBusy(undefined);
    editVersion.current = selected.updatedAt;
    meaningSnapshot.current = { captureKey: selected.captureKey, value: selected.meaning ?? '', source: selected.meaningSource };
    sentenceSnapshot.current = { captureKey: selected.captureKey, value: selected.sentenceTranslation ?? '', source: selected.sentenceTranslationSource };
    setDraft(field === 'sentence' ? selected.sentenceTranslation ?? '' : selected.meaning ?? '');
    setDraftSource(field === 'sentence' ? selected.sentenceTranslationSource ?? 'manual' : selected.meaningSource ?? 'manual'); setEditing(field);
  };
  const cancelEditing = () => { translationRequest.current++; setTranslationBusy(undefined); setEditing(null); };
  const prepareTranslation = () => {
    if (!translationPreference || remoteTranslation) return;
    const current = ++translationRequest.current;
    const preference = translationPreference;
    const isCurrent = () => mounted.current && translationRequest.current === current && currentPreference.current === preference;
    setPreparingTranslation(true); setPreparationProgress(undefined); setIssue('');
    const task = initializeLocalTranslation((value) => { if (isCurrent()) setPreparationProgress(value); });
    void task.then(() => { if (isCurrent()) setRetryEnrichment((value) => value + 1); })
      .catch(() => { if (isCurrent()) setIssue('本地翻译未准备好，请重试。'); })
      .finally(() => { if (isCurrent()) setPreparingTranslation(false); });
  };
  const saveMeaning = async () => {
    if (!selected || busy) return;
    const card = selected;
    translationRequest.current++;
    setBusy(card.id); setIssue('');
    try {
      if (editing === 'sentence') await updateCollectedWordSentenceTranslation(card.id, draft, editVersion.current ?? card.updatedAt, sentenceSnapshot.current,
        draftSource === 'baidu' || draftSource === 'browser' ? draftSource : 'manual');
      else await updateCollectedWordMeaning(card.id, draft, draftSource, editVersion.current ?? card.updatedAt, meaningSnapshot.current);
      if (currentId.current === card.id) { setEditing(null); setNotice('已保存'); }
      await refresh();
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.word-card-edit')?.focus({ preventScroll: true }));
    } catch (error) { setIssue(error instanceof Error ? error.message : '释义未能保存，请重试。'); }
    finally { setBusy(undefined); }
  };
  const referenceTranslation = async (field: 'meaning' | 'sentence' = editing ?? 'meaning') => {
    if (!selected || translationBusy || !manualTranslationAvailable || !translationPreference) return;
    const card = selected;
    const preference = translationPreference;
    const text = field === 'sentence' ? card.sentence : card.word;
    if (!canTranslateText(text)) { setIssue('请选择不超过 5000 字符的英文内容。'); return; }
    const current = ++translationRequest.current;
    const isCurrent = () => mounted.current && translationRequest.current === current && currentId.current === card.id
      && currentCaptureKey.current === card.captureKey && currentPreference.current === preference;
    setTranslationBusy(card.id); setTranslationProgress(undefined); setIssue('');
    setPreparingTranslation(false); setPreparationProgress(undefined);
    // Preference is preloaded. The local path must begin inside this click to retain user activation.
    const translation = requestWordCardReferenceTranslation(card, field, preference, isCurrent,
      value => { if (isCurrent()) setTranslationProgress(value); });
    try {
      const result = await translation;
      if (!result || !isCurrent()) return;
      const value = result.translation;
      if (editing === field) { setDraft(value); setDraftSource(result.source); return; }
      if (field === 'sentence') await updateCollectedWordSentenceTranslation(card.id, value, card.updatedAt,
        { captureKey: card.captureKey, value: card.sentenceTranslation ?? '', source: card.sentenceTranslationSource }, result.source);
      else await updateCollectedWordMeaning(card.id, value, result.source, card.updatedAt,
        { captureKey: card.captureKey, value: card.meaning ?? '', source: card.meaningSource });
      if (isCurrent()) { setNotice('参考译文已保存，可随时修改'); await refresh(); }
    } catch (error) {
      if (isCurrent()) setIssue(error instanceof Error && error.message !== 'unsupported' ? error.message : '翻译暂不可用，可以直接添加释义。');
    } finally { if (isCurrent()) { setTranslationBusy(undefined); setTranslationProgress(undefined); } }
  };
  const remove = async () => {
    if (!selected || busy) return;
    const card = selected;
    setBusy(card.id); setIssue(''); speech.stop();
    try {
      await removeCollectedWord(card.id);
      setUndo(card); clearTimeout(undoTimer.current); undoTimer.current = setTimeout(() => setUndo(null), 5_000);
      await refresh();
    } catch (error) { setIssue(error instanceof Error ? error.message : '移除失败，请重试。'); }
    finally { setBusy(undefined); }
  };
  const restore = async () => {
    if (!undo || busy) return;
    setBusy(undo.id);
    try { const card = await restoreCollectedWord(undo); clearTimeout(undoTimer.current); setUndo(null); setSelectedId(card.id); await refresh(); }
    catch (error) { setIssue(error instanceof Error ? error.message : '未能恢复收藏，请重试。'); }
    finally { setBusy(undefined); }
  };
  const closeDirectory = () => {
    setDirectoryOpen(false);
    requestAnimationFrame(() => directoryTrigger.current?.focus({ preventScroll: true }));
  };
  const openDirectory = (keyboard: boolean) => {
    if (editing || busy) return;
    speech.stop(); setAnimate(false); setDirectoryAnimate(!keyboard); setDirectoryOpen(true);
  };
  const selectDirectoryCard = (id: string, keyboard: boolean) => {
    setAnimate(!keyboard); setSelectedId(id); content.current?.scrollTo({ top: 0 }); closeDirectory();
  };
  useCollectionEscape(embedded && open && Boolean(editing || directoryOpen), () => {
    if (directoryOpen) closeDirectory();
    else { cancelEditing(); root.current?.querySelector<HTMLElement>('.word-card-edit')?.focus({ preventScroll: true }); }
    return true;
  });

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (directoryOpen) { event.preventDefault(); event.stopPropagation(); closeDirectory(); return; }
      if (embedded && !editing) return;
      event.preventDefault(); event.stopPropagation(); if (editing) { cancelEditing(); root.current?.querySelector<HTMLElement>('.word-card-edit')?.focus(); } else onClose(); return;
    }
    if (event.key === 'Tab' && !embedded && !directoryOpen) {
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], summary') ?? [])].filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (!(event.target as HTMLElement).closest('input, textarea, [contenteditable]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); navigate(event.key === 'ArrowRight' ? 1 : -1, true); }
  };
  if (!open && !embedded) return null;
  const Container = embedded ? 'section' : 'aside';
  const autoplayButton = <button className="collection-audio-toggle" type="button" aria-label={autoplay ? '关闭自动发音' : '开启自动发音'} title={autoplay ? '自动发音已开启' : '自动发音已关闭'} aria-pressed={Boolean(autoplay)} disabled={autoplay === undefined} onClick={toggleAutoplay}><WordAudioIcon muted={!autoplay} /></button>;
  const fieldPhase = (field: 'meaning' | 'sentence') => enrichment.id === selected?.id ? enrichment[field] : 'idle';
  const translationAction = !remoteTranslation && <button className="word-card-translation-action" type="button" disabled={!translationPreference || preparingTranslation} onClick={prepareTranslation}>{preparingTranslation ? preparationProgress !== undefined ? `准备本地翻译 ${preparationProgress}%` : '正在准备本地翻译…' : '启用本地补译'}</button>;
  const manualTranslationAction = (field: 'meaning' | 'sentence') => <button className="word-card-translation-action" type="button"
    title={translationLabel} disabled={!manualTranslationAvailable || Boolean(translationBusy || busy) || !selected || !canTranslateText(field === 'sentence' ? selected.sentence : selected.word)}
    onClick={() => void referenceTranslation(field)}>{translationBusy ? translationProgress !== undefined ? `准备翻译 ${translationProgress}%` : '翻译中…' : `用${translationLabel}`}</button>;
  const translationSourceLabel = (source: WordMeaningSource | undefined) => source === 'baidu' ? '百度参考译文' : source === 'browser' ? '浏览器本地参考译文' : undefined;
  const editor = editing && selected ? <form className="word-card-form" onSubmit={(event) => { event.preventDefault(); void saveMeaning(); }}>
    <label htmlFor="word-meaning">{editing === 'sentence' ? '原句中文' : '释义'}{translationSourceLabel(draftSource) && <span className="word-card-translation-badge" title={translationSourceLabel(draftSource)} aria-label={translationSourceLabel(draftSource)}>译</span>}</label>
    <textarea id="word-meaning" value={draft} maxLength={editing === 'sentence' ? 4_000 : 2_000} onChange={(event) => { translationRequest.current++; setTranslationBusy(undefined); setDraft(event.target.value); setDraftSource('manual'); }} autoFocus />
    <div>{manualTranslationAction(editing)}<button type="button" disabled={Boolean(busy)} onClick={cancelEditing}>取消</button><button type="submit" disabled={Boolean(busy)}>{busy ? '保存中…' : '保存'}</button></div>
  </form> : null;
  return <Container className={`wordbook-panel${embedded ? ' is-embedded' : ''}`} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-label="单词收藏" aria-hidden={!open} inert={!open || undefined} ref={root} onKeyDown={handleKeys}>
    {embedded ? open && <CollectionHeaderActions>{autoplayButton}</CollectionHeaderActions> : <CollectionTabs active="words" count={cards.length} onChange={onShowAnswers} onClose={onClose}>{autoplayButton}</CollectionTabs>}
    <div className="wordbook-content" ref={content} inert={directoryOpen || undefined} aria-hidden={directoryOpen || undefined}>
      {issue && <p className="wordbook-issue" role="alert">{issue}<button type="button" onClick={() => void refresh()}>刷新</button></p>}
      {translationPreferenceIssue && <p className="wordbook-issue" role="status">{translationPreferenceIssue}</p>}
      {loading ? <div className="wordbook-empty" role="status">正在读取…</div> : !selected ? <div className="wordbook-empty"><KoboyoIcon name="bookmark" size={28} /><h3>暂无单词</h3><p>划选网页单词，点击「收藏」。</p></div> : <>
        <div className="wordbook-album"><div className="wordbook-back one" aria-hidden="true" /><div className="wordbook-back two" aria-hidden="true" /><article key={selected.id} className={`word-card${animate ? ' is-arriving' : ''}`}>
          <h3 className={(selected.expression?.name ?? selected.word).length > 11 ? 'is-long' : ''} lang="en">{selected.expression?.name ?? selected.word}</h3>
          <div className="word-card-pronunciation">
            {ipa && <span className="word-card-phonetic" lang="en" title="美式英语 · IPA Dict 离线词库"><abbr title="美式英语">US</abbr>{ipa}</span>}
            <button className={`word-card-audio${speech.playing === 'word' ? ' is-playing' : ''}`} type="button" aria-label={speech.playing === 'word' ? '停止发音' : `播放 ${selected.word} 的发音`} title="播放发音" aria-pressed={speech.playing === 'word'} onClick={() => speech.speak(selected.word, 'word')}>
              {speech.playing === 'word' ? <span className="word-card-wave" aria-hidden="true"><i /><i /><i /></span> : <WordAudioIcon />}{!ipa && <span>发音</span>}
            </button>
          </div>
          {speech.issue && <p className="wordbook-issue" role="status">{speech.issue}</p>}
          {editing === 'meaning' ? editor : <div className={`word-card-meaning${selected.meaning ? '' : ' is-empty'}`}>
            {selected.meaning ? <p title={translationSourceLabel(selected.meaningSource) ?? (selected.meaningSource === 'dictionary' ? 'ECDICT 英汉词典释义' : undefined)}>{selected.meaning}{translationSourceLabel(selected.meaningSource) && <span className="word-card-translation-badge" aria-label={translationSourceLabel(selected.meaningSource)}>译</span>}</p> : fieldPhase('meaning') === 'loading' ? <span className="word-card-loading" role="status" aria-label="正在补充释义" /> : null}
            <button className="word-card-edit" type="button" aria-label={selected.meaning ? '修改释义' : '添加释义'} onClick={() => beginEditing()}><KoboyoIcon name="edit" size={14} />{!selected.meaning && fieldPhase('meaning') !== 'loading' && <span>添加释义</span>}</button>
          </div>}
          {!selected.sentence && !selected.meaning && (remoteTranslation ? manualTranslationAction('meaning') : fieldPhase('meaning') === 'setup' && translationAction)}
          {selected.sentence ? <><div className="word-card-context"><span>原句</span><div className="word-card-context-actions"><button type="button" aria-label={speech.playing === 'sentence' ? '停止朗读原句' : '朗读原句'} title="朗读原句" aria-pressed={speech.playing === 'sentence'} onClick={() => speech.speak(selected.sentence, 'sentence')}><WordAudioIcon /></button><button className="word-card-sentence-edit" type="button" aria-label={selected.sentenceTranslation ? '修改原句中文' : '添加原句中文'} title={selected.sentenceTranslation ? '修改原句中文' : '添加原句中文'} onClick={() => beginEditing('sentence')}><KoboyoIcon name="edit" size={13} /></button></div></div><SourceSentence card={selected} />
            {editing === 'sentence' ? editor : selected.sentenceTranslation ? <p className="word-card-sentence-translation" lang="zh-CN" title={translationSourceLabel(selected.sentenceTranslationSource)}>{selected.sentenceTranslation}</p> : remoteTranslation ? manualTranslationAction('sentence') : fieldPhase('sentence') === 'loading' ? <span className="word-card-loading is-sentence" role="status" aria-label="正在翻译原句" /> : fieldPhase('sentence') === 'setup' ? translationAction : fieldPhase('sentence') === 'failed' ? <button className="word-card-translation-action" type="button" onClick={() => setRetryEnrichment((value) => value + 1)}>重试本地补译</button> : fieldPhase('sentence') === 'unavailable' ? <span className="word-card-translation-unavailable">本地翻译不可用</span> : null}
          </> : <p className="word-card-no-context">未取得原句</p>}
          <div className="word-card-footer">
            {sourceUrl(selected) ? <a className="word-card-source" href={sourceUrl(selected)} title={selected.source.title} target="_blank" rel="noopener noreferrer"><KoboyoIcon name="link" size={12} /><span>{sourceLabel(selected)}</span><span>↗</span></a> : <span className="word-card-source">{sourceLabel(selected)}</span>}
            <button type="button" aria-label="移除收藏" title="移除收藏" disabled={Boolean(busy)} onClick={() => void remove()}><KoboyoIcon name="trash" size={14} /></button>
          </div>
        </article></div>
      </>}
    </div>
    {!loading && selected && <div className="wordbook-navigation" inert={directoryOpen || undefined}>
      <WordCardNavigation index={index} total={cards.length} disabled={Boolean(editing || busy)} expanded={directoryOpen}
        directoryId={directoryId} triggerRef={directoryTrigger} onNavigate={navigate} onOpen={openDirectory} />
    </div>}
    {open && directoryOpen && <WordCardDirectory id={directoryId} cards={cards} selectedId={selected?.id} animate={directoryAnimate} onClose={closeDirectory} onSelect={selectDirectoryCard} />}
    {undo && <div className="wordbook-undo" role="status">已移除 {undo.word}<button type="button" disabled={Boolean(busy)} onClick={() => void restore()}>撤销</button></div>}
    <span className="visually-hidden" role="status" aria-live="polite">{notice}</span>
  </Container>;
}
