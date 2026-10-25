import { useEffect, useId, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_TRANSLATION_SETTINGS, TRANSLATION_SERVICES, TRANSLATION_SETTINGS_KEY,
  TRANSLATION_USAGE_KEY, isTranslationService, normalizeTranslationSettings,
  type TranslationSettings as TranslationPreferences, type TranslationUsage,
} from '../../shared/wordTranslation';
import './TranslationSettings.css';

export function translationSettingsIssue(settings: TranslationPreferences): string | null {
  if (!settings.remoteEnabled) return null;
  if (!/^\d{10,30}$/.test(settings.appid.trim())) return '请输入 10–30 位数字的百度 APPID。';
  if (!settings.apiKey.trim()) return '启用百度翻译前，请填写 API Key。';
  return null;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeUsage(value: unknown): TranslationUsage {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const month = currentMonth();
  const count = (field: unknown) => typeof field === 'number' && Number.isFinite(field) && field >= 0 ? Math.floor(field) : 0;
  return { month, llm: data.month === month ? count(data.llm) : 0, nmt: data.month === month ? count(data.nmt) : 0 };
}

export function TranslationSettings() {
  const id = useId();
  const [draft, setDraft] = useState<TranslationPreferences>({ ...DEFAULT_TRANSLATION_SETTINGS });
  const [usage, setUsage] = useState<TranslationUsage>(() => normalizeUsage(null));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    // Credentials must never become readable to website content scripts.
    void (async () => {
      await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      const stored = await browser.storage.local.get([TRANSLATION_SETTINGS_KEY, TRANSLATION_USAGE_KEY]);
      if (!active) return;
      setDraft(normalizeTranslationSettings(stored[TRANSLATION_SETTINGS_KEY]));
      setUsage(normalizeUsage(stored[TRANSLATION_USAGE_KEY]));
      setReady(true);
    })().catch(() => { if (active) setIssue('翻译设置读取失败，请关闭设置后重试。'); });
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (active && area === 'local' && changes[TRANSLATION_USAGE_KEY]) {
        setUsage(normalizeUsage(changes[TRANSLATION_USAGE_KEY].newValue));
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => { active = false; browser.storage.onChanged.removeListener(onChanged); };
  }, []);

  const patch = (next: Partial<TranslationPreferences>) => {
    setDraft(previous => ({ ...previous, ...next }));
    setIssue(null);
    setSaved(false);
  };
  const save = async (value: TranslationPreferences) => {
    if (!ready || busy) return;
    const next = normalizeTranslationSettings(value);
    const validation = translationSettingsIssue(next);
    if (validation) { setIssue(validation); return; }
    setBusy(true);
    setSaved(false);
    setIssue(null);
    try {
      await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      // Save only this preference: WorkOS settings and usage have their own owners.
      await browser.storage.local.set({ [TRANSLATION_SETTINGS_KEY]: next });
      setDraft(next);
      setSaved(true);
    } catch {
      // Browser errors may include arguments. Never display the raw error.
      setIssue('翻译设置保存失败，请重试。');
    } finally { setBusy(false); }
  };

  return (
    <form className="settings-section translation-settings" autoComplete="off" aria-labelledby={`${id}-title`}
      onSubmit={event => { event.preventDefault(); void save(draft); }}>
      <strong id={`${id}-title`}>查词与翻译</strong>
      <fieldset disabled={!ready || busy}>
        <label htmlFor={`${id}-service`}>默认服务</label>
        <select id={`${id}-service`} autoComplete="off" value={draft.service} onChange={event => {
          if (isTranslationService(event.target.value)) patch({ service: event.target.value });
        }}>
          {TRANSLATION_SERVICES.map(service => <option key={service.value} value={service.value}>{service.label}</option>)}
        </select>
        <p className="field-help">Auto 按查询内容选择百度服务；关闭百度翻译时，仅使用本地能力。</p>
        <div className="translation-settings-toggle">
          <label htmlFor={`${id}-enabled`}>允许使用百度翻译（可能计费）</label>
          <input id={`${id}-enabled`} type="checkbox" autoComplete="off" checked={draft.remoteEnabled}
            onChange={event => patch({ remoteEnabled: event.target.checked })} />
        </div>
        <label htmlFor={`${id}-appid`}>百度 APPID</label>
        <input id={`${id}-appid`} type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
          maxLength={30} value={draft.appid} onChange={event => patch({ appid: event.target.value })} />
        <label htmlFor={`${id}-key`}>百度 API Key</label>
        <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={512}
          value={draft.apiKey} onChange={event => patch({ apiKey: event.target.value })} />
        <p className="field-help">凭据只保存在此浏览器，不进入知识备份。保存设置不会发送翻译请求。网页、回答及收藏中的主动翻译共用此设置；选词可附原句，选段落只发送所选内容。打开收藏的自动补全仍使用本地能力。</p>
        <details>
          <summary>服务额度与本机用量</summary>
          <p>大模型翻译：认证后 100 万字符测试额度，并非每月赠送。</p>
          <p>机器翻译：个人认证 100 万字符／月，企业认证 200 万字符／月。两项服务超额公开费率均为 49 元／百万源字符，实际以百度账户为准。</p>
          <p>本机 {usage.month} 提交字符估算：大模型 {usage.llm.toLocaleString('zh-CN')}，机器翻译 {usage.nmt.toLocaleString('zh-CN')}。</p>
          <p>未查询百度官方余额。此估算不是剩余额度，不包含其他设备或应用，也不保证反映最终计费。</p>
        </details>
        <button type="submit" className="save-token-button pressable">{busy ? '正在保存…' : saved ? '已保存' : '保存翻译设置'}</button>
        <button type="button" className="remove-token-button pressable" disabled={!draft.apiKey && !draft.appid}
          onClick={() => void save({ ...draft, appid: '', apiKey: '', remoteEnabled: false })}>清除百度凭据并停用</button>
      </fieldset>
      {issue && <p className="token-error" role="alert">{issue}</p>}
      {!ready && !issue && <p role="status">正在读取翻译设置…</p>}
      {saved && <p role="status">翻译设置已保存。</p>}
    </form>
  );
}
