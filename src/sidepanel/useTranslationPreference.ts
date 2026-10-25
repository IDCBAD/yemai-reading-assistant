import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { TRANSLATION_SETTINGS_KEY, type TranslationPreference } from '../shared/wordTranslation';
import { loadTranslationPreference } from './manualTranslation';

export function useTranslationPreference() {
  const [preference, setPreference] = useState<TranslationPreference | null>(null);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    let active = true; let revision = 0;
    const load = () => {
      const current = ++revision;
      setPreference(null);
      void loadTranslationPreference().then(value => {
        if (active && current === revision) { setPreference(value); setIssue(''); }
      }).catch(() => {
        if (active && current === revision) { setPreference(null); setIssue('无法读取翻译设置，请重新打开面板。'); }
      });
    };
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && TRANSLATION_SETTINGS_KEY in changes) load();
    };
    load(); browser.storage.onChanged.addListener(onChanged);
    return () => { active = false; revision++; browser.storage.onChanged.removeListener(onChanged); };
  }, []);
  return { preference, issue };
}
