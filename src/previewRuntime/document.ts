/** Self-contained because it is serialized into the unprivileged document. */
function installDocumentBridge(session: string) {
  const channel = 'yemai-html-preview-v1';
  let sequence = 0;
  const pending = new Map<string, { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  const writeText = (text: string) => new Promise<void>((resolve, reject) => {
    if (typeof text !== 'string' || text.length > 200_000 || !navigator.userActivation.isActive) {
      reject(new Error('请点击复制按钮后重试。')); return;
    }
    const requestId = String(++sequence);
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('复制未完成。')); }, 2500);
    pending.set(requestId, { resolve, reject: () => reject(new Error('复制未完成。')), timer });
    parent.postMessage({ channel, session, type: 'copy', requestId, text }, '*');
  });
  // No clipboard read method is exposed. Existing documents keep their fallback.
  try { Object.defineProperty(navigator, 'clipboard', { value: Object.freeze({ writeText }), configurable: false }); } catch { /* Native fallback remains available. */ }
  addEventListener('message', (event: MessageEvent) => {
    if (event.source !== parent || event.data?.channel !== channel || event.data?.session !== session
      || event.data.type !== 'copy-result') return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(event.data.requestId);
    if (event.data.ok) request.resolve(); else request.reject();
  });
  // Keep anchor navigation within this document; external links use a visible,
  // user-confirmed link in the host rather than a privileged open-tab bridge.
  addEventListener('click', (event: MouseEvent) => {
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || href.startsWith('#')) return;
    event.preventDefault();
    if (event.isTrusted) parent.postMessage({ channel, session, type: 'link', url: href }, '*');
  }, true);
  addEventListener('submit', (event) => { event.preventDefault(); }, true);
  addEventListener('DOMContentLoaded', () => parent.postMessage({ channel, session, type: 'rendered' }, '*'), { once: true });
}

export function interactiveReportDocument(source: string, session: string) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('iframe, frame, frameset, object, embed, base, link, meta[http-equiv], script[src]').forEach((node) => node.remove());
  // Relative anchor destinations cannot resolve against an extension URL.
  doc.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('#') && !/^https:\/\//i.test(href)) anchor.removeAttribute('href');
    anchor.removeAttribute('target'); anchor.removeAttribute('ping');
  });
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer'; referrer.content = 'no-referrer';
  const bridge = doc.createElement('script');
  bridge.textContent = `(${installDocumentBridge.toString()})(${JSON.stringify(session)});`;
  doc.head.prepend(policy, referrer, bridge);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
