import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { KoboyoIcon } from './KoboyoIcon';
import { IconTooltipButton } from './IconTooltipButton';
import './ReadingFocusButton.css';

interface FocusResponse { enabled?: boolean; count?: number; phase?: string; error?: string }

/** Mode state belongs to the web page, so switching tabs always reads that page. */
export function ReadingFocusButton() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [issue, setIssue] = useState('');
  const revision = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const read = useCallback(async (action: 'toggle' | 'status') => {
    const current = ++revision.current;
    if (action === 'toggle') { setBusy(true); setIssue(''); }
    try {
      const response = await browser.runtime.sendMessage({ type: 'reading-focus:active', action }) as FocusResponse | undefined;
      if (!mounted.current || current !== revision.current) return;
      setEnabled(response?.enabled === true);
      setPreparing(response?.phase === 'preparing' || response?.phase === 'checking');
      if (action === 'toggle' && (!response || response.error)) {
        setIssue(response?.error || '无法连接网页，请刷新页面后重试。');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setIssue(''), 7_000);
      }
    } catch {
      if (mounted.current && current === revision.current && action === 'toggle') setIssue('无法连接网页，请刷新页面后重试。');
    } finally {
      if (mounted.current && current === revision.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void read('status'); };
    const updated = (_tabId: number, change: { status?: string }) => { if (change.status === 'complete') refresh(); };
    const changed = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'reading-focus:changed') refresh();
      return false;
    };
    refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(updated);
    browser.runtime.onMessage.addListener(changed);
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      revision.current++;
      clearTimeout(timer.current);
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(updated);
      browser.runtime.onMessage.removeListener(changed);
      window.removeEventListener('focus', refresh);
    };
  }, [read]);
  return <div className="reading-focus-button-wrap">
    <IconTooltipButton type="button" className={`composer-tool reading-focus-trigger pressable${enabled ? ' is-active' : ''}${preparing ? ' is-preparing' : ''}`}
      aria-label={enabled ? '关闭辅助阅读' : '开启辅助阅读'} aria-pressed={enabled} aria-busy={busy || preparing || undefined}
      tooltip={preparing ? '正在准备辅助阅读，退出后在后台继续' : enabled ? '关闭辅助阅读' : '辅助阅读'} disabled={busy}
      onClick={() => void read('toggle')}><KoboyoIcon name="reading" size={17} /></IconTooltipButton>
    {issue && <span className="reading-focus-notice" role="status">{issue}</span>}
  </div>;
}
