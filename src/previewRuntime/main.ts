import { interactiveReportDocument } from './document';
import { copyRequest, HTML_RUNTIME_CHANNEL, runtimeMessage } from './protocol';

const session = location.hash.slice(1);
if (/^[a-f0-9-]{36}$/.test(session)) {
  const frame = document.createElement('iframe');
  frame.title = 'HTML 页面内容';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  document.documentElement.style.cssText = 'height:100%;overflow:hidden;background:white';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden';
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
  document.body.append(frame);
  let loaded = false;
  addEventListener('message', (event: MessageEvent) => {
    if (!runtimeMessage(event.data, session)) return;
    if (event.source === parent) {
      if (event.data.type === 'load' && !loaded && typeof event.data.html === 'string' && event.data.html.length <= 2 * 1024 * 1024) {
        loaded = true;
        frame.srcdoc = interactiveReportDocument(event.data.html, session);
      } else if (event.data.type === 'copy-result') frame.contentWindow?.postMessage(event.data, '*');
    } else if (event.source === frame.contentWindow) {
      if (event.data.type === 'rendered' || copyRequest(event.data, session)
        || event.data.type === 'link' && typeof event.data.url === 'string' && event.data.url.length <= 4096) {
        parent.postMessage(event.data, '*');
      }
    }
  });
  parent.postMessage({ channel: HTML_RUNTIME_CHANNEL, session, type: 'ready' }, '*');
}
