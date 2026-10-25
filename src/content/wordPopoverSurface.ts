export const wordPopoverStyles = `
.yemai-word-popover{--paper:#fff;--soft:#f3f4f2;--ink:#292d2b;--muted:#646b66;--line:#dcdfdb;--accent:#315eea;position:fixed;z-index:2147483647;box-sizing:border-box;width:420px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;padding:12px 18px 15px;border:1px solid var(--line);border-radius:13px;background:var(--paper);color:var(--ink);box-shadow:0 10px 36px #0002;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;white-space:normal;overflow-wrap:anywhere;pointer-events:auto;color-scheme:light;display:flex;flex-direction:column;gap:10px}
.yemai-word-popover[hidden],.yemai-word-popover [hidden]{display:none!important}.yemai-word-popover *{box-sizing:border-box}.yemai-word-popover p{margin:0}.yemai-word-popover header{order:1;display:flex;align-items:center;gap:9px;flex-wrap:wrap}.yemai-word-popover strong{font-size:21px;line-height:1.5}.yemai-word-popover button{appearance:none;font:inherit;cursor:pointer;border-radius:7px;border:0;background:transparent;color:inherit;padding:5px 9px;min-height:30px}.yemai-word-popover button:hover{background:var(--soft)}.yemai-word-popover button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.yemai-word-popover button:disabled{cursor:default;opacity:.6}.yemai-word-popover .yemai-word-close{margin-left:auto;font-size:22px;order:4}.yemai-word-ipa{font-size:12px;color:var(--muted)}.yemai-word-meaning{order:2;white-space:pre-line}.yemai-word-status{order:7;font-size:12px;color:var(--muted)}.yemai-word-status:empty{display:none}.yemai-word-toolbar{order:0;display:flex;align-items:center;justify-content:space-between;font-size:12px;position:relative}.yemai-word-menu{position:absolute;top:100%;right:0;z-index:1;min-width:220px;padding:6px;border:1px solid var(--line);border-radius:9px;background:var(--paper);box-shadow:0 8px 24px #0003}.yemai-word-menu button{display:block;width:100%;text-align:left}.yemai-word-menu [aria-checked=true]{background:var(--soft);color:var(--accent)}.yemai-word-details{order:4;display:flex;flex-direction:column;gap:12px}.yemai-word-context{padding:10px 12px;border-radius:9px;background:var(--soft)}.yemai-word-context strong{font-size:17px}.yemai-word-example small{color:var(--muted);font-size:11px}.yemai-word-example p+p{color:var(--muted);font-size:13px;margin-top:3px}.yemai-word-popover mark{background:transparent;color:var(--accent);font-weight:600}.yemai-word-popover .yemai-word-save{order:6;align-self:flex-end;border:1px solid var(--line);font-size:12px}.yemai-word-waiting{order:5;display:flex;align-items:center;justify-content:center;gap:6px;height:32px;background:var(--soft);border-radius:8px}.yemai-word-waiting i{width:5px;height:5px;border-radius:50%;background:var(--accent);animation:yemai-word-dot 1s ease-in-out infinite}.yemai-word-waiting i:nth-child(2){animation-delay:120ms}.yemai-word-waiting i:nth-child(3){animation-delay:240ms}@keyframes yemai-word-dot{0%,70%,100%{opacity:.25}35%{opacity:1}}@media(prefers-reduced-motion:reduce){.yemai-word-waiting i{animation:none;opacity:.6}}
`;

/** Composite transparent layers of the reading surface, rather than the selected text color. */
export function applyWordPopoverTheme(panel: HTMLElement, element: Element | null) {
  const view = panel.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return;
  const layers: number[][] = [];
  let hasImage = false;
  for (let node = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    hasImage ||= style.backgroundImage !== 'none';
    const numbers = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (numbers && numbers.length >= 3) layers.push([numbers[0]!, numbers[1]!, numbers[2]!, numbers[3] ?? 1]);
  }
  const prefersDark = view.matchMedia?.('(prefers-color-scheme: dark)').matches;
  let rgb = prefersDark ? [24, 26, 28] : [255, 255, 255];
  for (const layer of layers.reverse()) rgb = rgb.map((value, index) => value * (1 - layer[3]!) + layer[index]! * layer[3]!);
  // An image's luminance cannot be safely inferred from CSS; use its declared color scheme.
  const dark = hasImage ? (element ? view.getComputedStyle(element).colorScheme === 'dark' || prefersDark : prefersDark)
    : rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722 < 115;
  const warm = !dark && rgb[0]! > rgb[2]! + 5;
  const colors = dark ? ['#242725', '#1b1e1c', '#f1f2ef', '#b4bbb5', '#424942', '#a9bcff']
    : warm ? ['#fcfaf5', '#f0ece3', '#34332f', '#716e64', '#dfdbd2', '#3156b9']
      : ['#fff', '#f3f4f2', '#292d2b', '#646b66', '#dcdfdb', '#315eea'];
  ['paper', 'soft', 'ink', 'muted', 'line', 'accent'].forEach((name, index) => panel.style.setProperty(`--${name}`, colors[index]!));
  panel.style.colorScheme = dark ? 'dark' : 'light';
}

export function appendHighlightedText(container: HTMLElement, text: string, target: string, offsets?: { start?: number; end?: number }) {
  const doc = container.ownerDocument;
  let start = offsets?.start ?? -1;
  let end = offsets?.end ?? -1;
  if (start < 0 || end <= start || text.slice(start, end).toLowerCase() !== target.toLowerCase()) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = target ? new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').exec(text) : null;
    start = match?.index ?? -1;
    end = start + (match?.[0].length ?? 0);
  }
  if (start < 0) { container.textContent = text; return; }
  const before = doc.createElement('span'); before.textContent = text.slice(0, start);
  const mark = doc.createElement('mark'); mark.textContent = text.slice(start, end);
  const after = doc.createElement('span'); after.textContent = text.slice(end);
  container.append(before, mark, after);
}
