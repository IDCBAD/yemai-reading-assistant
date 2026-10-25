import { BaiduTranslationError, translateBaidu, type BaiduTranslationRequest } from '../services/baiduTranslation';
import { isCollectibleWord } from '../shared/wordCards';
import { isTranslationService, normalizeTranslationSettings, type TranslationSettings, type TranslationUsage,
  canTranslateText, type ManualTranslationInput, type ManualTranslationResult,
  type WordTranslationInput, type WordTranslationResult } from '../shared/wordTranslation';

export interface WordTranslationDependencies {
  getSettings(): Promise<TranslationSettings>;
  lookupMeaning(word: string): Promise<string | null>;
  lookupPronunciation(word: string): Promise<string | null>;
  getUsage?(): Promise<TranslationUsage | undefined>;
  setUsage?(usage: TranslationUsage): Promise<void>;
  translate?(request: BaiduTranslationRequest): Promise<string>;
  now?(): number;
  requestSpacingMs?: number;
}
const CACHE_TTL = 30 * 60_000;
const MAX_CACHE = 100;
const MAX_TEXT_CACHE = 200;
interface TranslationPart { translation: string; usageNotice?: string }
export function createWordTranslationRuntime(deps: WordTranslationDependencies) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; result: WordTranslationResult }>();
  const inFlight = new Map<string, Promise<WordTranslationResult>>();
  // Reuse actual translated text across different selected words in the same sentence.
  // The reference participates in the key: contextual word meanings must remain distinct.
  const textCache = new Map<string, { at: number; translation: string }>();
  const textInFlight = new Map<string, Promise<TranslationPart>>();
  let credentials = ''; let generation = 0;
  let remoteTail: Promise<unknown> = Promise.resolve(); let lastStarted = -Infinity;

  async function readSettings() {
    let settings: TranslationSettings;
    try { settings = normalizeTranslationSettings(await deps.getSettings()); }
    catch { throw new Error('无法读取翻译设置，请稍后重新查词。'); }
    const nextCredentials = JSON.stringify([settings.appid, settings.apiKey, settings.remoteEnabled]);
    if (credentials !== nextCredentials) {
      credentials = nextCredentials; generation++;
      cache.clear(); inFlight.clear(); textCache.clear(); textInFlight.clear();
    }
    return settings;
  }
  async function requireCurrentSettings(epoch: number) {
    await readSettings();
    if (epoch !== generation) throw new Error('翻译设置已更改，请重新查词。');
  }

  function validate(input: WordTranslationInput) {
    if (!input || typeof input.word !== 'string' || typeof input.sentence !== 'string'
      || input.word.length > 240 || !isCollectibleWord(input.word) || input.sentence.length > 1000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.word + input.sentence)
      || (input.service !== undefined && !isTranslationService(input.service))) throw new Error('查词内容无效或过长，请重新选择词语。');
    return { word: input.word.trim(), sentence: input.sentence.trim(), service: input.service };
  }

  async function remote(request: BaiduTranslationRequest, epoch: number): Promise<TranslationPart> {
    const key = JSON.stringify([epoch, request.model, request.text, request.reference ?? '']);
    const hit = textCache.get(key);
    if (hit && now() - hit.at < CACHE_TTL) {
      await requireCurrentSettings(epoch);
      textCache.delete(key); textCache.set(key, hit);
      return { translation: hit.translation };
    }
    if (hit) textCache.delete(key);
    const existing = textInFlight.get(key);
    if (existing) {
      const result = await existing;
      await requireCurrentSettings(epoch);
      return { ...result };
    }
    const task = remoteTail.then(async () => {
      await requireCurrentSettings(epoch);
      const wait = Math.max(0, lastStarted + Math.max(120, deps.requestSpacingMs ?? 120) - now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      await requireCurrentSettings(epoch);
      lastStarted = now();
      // Check current permission immediately before starting the actual request, with
      // no storage await between that check and submission. Already sent requests
      // may finish, but disabling the service prevents later sentence requests.
      let pending: Promise<string>;
      try { pending = (deps.translate ?? translateBaidu)(request); }
      catch (error) {
        if (error instanceof BaiduTranslationError) throw error;
        throw new BaiduTranslationError('network');
      }
      // Usage persistence can be slower than a rejected request; handle it now.
      void pending.catch(() => undefined);
      let usageNotice: string | undefined;
      // An attempted request can consume characters even if the response is lost.
      if (deps.getUsage && deps.setUsage) {
        try {
          const month = new Date(now()).toISOString().slice(0, 7);
          const stored = await deps.getUsage();
          const usage = stored?.month === month ? { ...stored } : { month, llm: 0, nmt: 0 };
          usage.llm = Number.isFinite(usage.llm) && usage.llm >= 0 ? usage.llm : 0;
          usage.nmt = Number.isFinite(usage.nmt) && usage.nmt >= 0 ? usage.nmt : 0;
          usage[request.model] += Array.from(request.text).length;
          await deps.setUsage(usage);
        } catch { usageNotice = '本次用量未能保存，请以百度控制台为准。'; }
      }
      let translation: string;
      try { translation = await pending; }
      catch (error) {
        if (error instanceof BaiduTranslationError) throw error;
        throw new BaiduTranslationError('network');
      }
      await requireCurrentSettings(epoch);
      textCache.set(key, { at: now(), translation });
      while (textCache.size > MAX_TEXT_CACHE) textCache.delete(textCache.keys().next().value!);
      return { translation, usageNotice };
    });
    textInFlight.set(key, task);
    remoteTail = task.catch(() => undefined);
    try { return await task; }
    finally { if (textInFlight.get(key) === task) textInFlight.delete(key); }
  }

  async function lookup(raw: WordTranslationInput): Promise<WordTranslationResult> {
    const input = validate(raw);
    const settings = await readSettings();
    const epoch = generation;
    const requested = input.service ?? settings.service;
    const configured = settings.remoteEnabled && /^\d{5,40}$/.test(settings.appid) && !!settings.apiKey;
    const service = requested === 'auto' ? configured ? input.sentence ? 'baidu-llm' : 'baidu-nmt' : 'local' : requested;
    if (service !== 'local' && !configured) throw new BaiduTranslationError('configuration');
    const key = JSON.stringify([service, input.word, input.sentence]);
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL) { cache.delete(key); cache.set(key, hit); return { ...structuredClone(hit.result), cached: true }; }
    if (hit) cache.delete(key);
    const existing = inFlight.get(key);
    if (existing) { const result = await existing; await requireCurrentSettings(epoch); return structuredClone(result); }
    const task = (async (): Promise<WordTranslationResult> => {
      const [meaning, pronunciation] = await Promise.all([
        deps.lookupMeaning(input.word).catch(() => null), deps.lookupPronunciation(input.word).catch(() => null),
      ]);
      if (service === 'local') return { service, meaning, pronunciation, examples: input.sentence ? [{ text: input.sentence, source: 'page' }] : [],
        ...(requested === 'auto' ? { notice: '百度翻译尚未启用或配置，当前使用本地词典。' } : {}) };
      const model = service === 'baidu-llm' ? 'llm' : 'nmt';
      const reference = model === 'llm' && input.sentence
        ? ('根据以下原句中的用法将目标词翻译成中文，仅返回该词在此处的中文译文。原句：' + input.sentence).slice(0, 500) : undefined;
      const translatedWord = await remote({ appid: settings.appid, apiKey: settings.apiKey, text: input.word, model, ...(reference ? { reference } : {}) }, epoch);
      let sentenceNotice: string | undefined;
      let translatedSentence: Awaited<ReturnType<typeof remote>> | undefined;
      if (input.sentence) {
        if (input.sentence === input.word) translatedSentence = translatedWord;
        else {
          try { translatedSentence = await remote({ appid: settings.appid, apiKey: settings.apiKey, text: input.sentence, model }, epoch); }
          catch (error) {
            if (epoch !== generation) throw new Error('翻译设置已更改，请重新查词。');
            sentenceNotice = `词义已返回，原句暂未译出。${error instanceof BaiduTranslationError ? error.message : '请稍后手动重试。'}`;
          }
        }
      }
      const wordResult = translatedWord.translation.trim();
      const shortContext = !!reference && Array.from(wordResult).length <= 80
        && !/[\r\n\u2028\u2029]/u.test(wordResult)
        && (!translatedSentence || wordResult !== translatedSentence.translation.trim());
      const contextNotice = reference && !shortContext ? '语境词义未通过格式检查，当前仅显示可用结果。' : undefined;
      return { service, meaning: reference ? meaning ?? (shortContext ? wordResult : null) : translatedWord.translation,
        meaningSource: reference && meaning ? 'dictionary' : 'baidu', pronunciation,
        ...(shortContext ? { contextMeaning: wordResult } : {}),
        ...(translatedSentence ? { sentenceTranslation: translatedSentence.translation } : {}),
        examples: input.sentence ? [{ text: input.sentence, translation: translatedSentence?.translation, source: 'page' }] : [],
        ...((contextNotice || sentenceNotice || translatedWord.usageNotice || translatedSentence?.usageNotice)
          ? { notice: [contextNotice, sentenceNotice, translatedWord.usageNotice || translatedSentence?.usageNotice].filter(Boolean).join(' ') } : {}) };
    })();
    inFlight.set(key, task);
    try {
      const result = await task;
      await requireCurrentSettings(epoch);
      // Keep explicit retry useful after a partial failure instead of caching the missing sentence.
      if (!(service !== 'local' && input.sentence && !result.sentenceTranslation)) cache.set(key, { at: now(), result: structuredClone(result) });
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      return structuredClone(result);
    } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
  }
  async function translateText(input: ManualTranslationInput): Promise<ManualTranslationResult> {
    if (!input || typeof input.text !== 'string' || !canTranslateText(input.text)
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.text)
      || (input.service !== undefined && !isTranslationService(input.service))) throw new Error('请选择不超过 5000 字符的英文内容。');
    const settings = await readSettings();
    const epoch = generation;
    const requested = input.service ?? settings.service;
    const configured = settings.remoteEnabled && /^\d{5,40}$/.test(settings.appid) && !!settings.apiKey;
    if (requested === 'local' || !configured) throw new BaiduTranslationError('configuration');
    const model = requested === 'baidu-llm' ? 'llm' : 'nmt';
    const result = await remote({ appid: settings.appid, apiKey: settings.apiKey, text: input.text.trim(), model }, epoch);
    await requireCurrentSettings(epoch);
    return { translation: result.translation, source: 'baidu', service: model === 'llm' ? 'baidu-llm' : 'baidu-nmt',
      ...(result.usageNotice ? { notice: result.usageNotice } : {}) };
  }
  return { lookup, translateText };
}
