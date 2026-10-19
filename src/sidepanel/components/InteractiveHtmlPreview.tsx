import { useEffect, useRef, useState } from 'react';
import { safeArtifactUrl } from '../artifactPreview';
import { copyRequest, HTML_RUNTIME_CHANNEL, runtimeMessage } from '../../previewRuntime/protocol';

export function InteractiveHtmlPreview({ text }: { text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState<string>();
  useEffect(() => {
    let active = true;
    let copying = false;
    let initialized = false;
    const timeout = setTimeout(() => { if (active) setState('error'); }, 10_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null' || !runtimeMessage(event.data, session)) return;
      if (event.data.type === 'ready' && !initialized) {
        initialized = true;
        frame.current?.contentWindow?.postMessage({ channel: HTML_RUNTIME_CHANNEL, session, type: 'load', html: text }, '*');
      } else if (event.data.type === 'rendered') {
        clearTimeout(timeout); setState('ready');
      } else if (copyRequest(event.data, session)) {
        const data = event.data;
        const allowed = document.hasFocus() && document.activeElement === frame.current
          && navigator.userActivation.isActive && !copying;
        const respond = (ok: boolean) => {
          if (active) frame.current?.contentWindow?.postMessage({ channel: HTML_RUNTIME_CHANNEL, session, type: 'copy-result', requestId: data.requestId, ok }, '*');
        };
        if (!allowed) { respond(false); return; }
        copying = true;
        void navigator.clipboard.writeText(data.text).then(() => respond(true), () => {
          respond(false); if (active) setNotice('复制未完成，请在页面中选中文字后复制。');
        }).finally(() => { copying = false; });
      } else if (event.data.type === 'link' && typeof event.data.url === 'string'
        && document.hasFocus() && document.activeElement === frame.current && navigator.userActivation.isActive) {
        const next = safeArtifactUrl(event.data.url);
        if (next) setLink(next);
      }
    };
    addEventListener('message', receive);
    return () => { active = false; clearTimeout(timeout); removeEventListener('message', receive); };
  }, [text, session]);
  const restart = () => { setNotice(''); setLink(undefined); setState('loading'); setSession(crypto.randomUUID()); };
  return <div className="preview-report" aria-busy={state === 'loading'}>
    {state === 'loading' && <p role="status">正在打开页面…</p>}
    {state === 'error' && <div className="preview-report-error" role="alert">页面未能打开。<button type="button" onClick={restart}>重试</button></div>}
    {notice && <p role="status">{notice}</p>}
    {link && <p className="preview-report-link">页面中的外部链接：<a href={link} title={link} target="_blank" rel="noopener noreferrer">打开链接：{new URL(link).hostname}</a><button type="button" onClick={() => setLink(undefined)}>取消</button></p>}
    <iframe key={session} ref={frame} title="HTML 交互页面" sandbox="allow-scripts" referrerPolicy="no-referrer" src={`/html-runtime.html#${session}`} />
  </div>;
}
