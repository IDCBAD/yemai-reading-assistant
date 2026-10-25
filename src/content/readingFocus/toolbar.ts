import type { ReadingFocusStatus } from './index';
import { type ReadingFocusGroup } from '../../shared/readingFocus';
import type { ReadingExpression } from '../../shared/readingExpressions';
import { createExpressionLearningList } from './expressionList';
import { readingHint } from './learningHints';
import { createReadingPreparation } from './preparation';
import { normalizeReadingFocusPreferences, type ReadingFocusPreferences } from '../../shared/readingFocusPreferences';

interface ToolbarOptions {
  onExit(): void;
  onStart(preferences: ReadingFocusPreferences): Promise<void>;
  onPreferences(preferences: ReadingFocusPreferences): void;
  onStop(): void;
  onRetry(): void;
  onScan(retry?: boolean): void;
  onStopExpressions(): void;
  onLocate(id: string, occurrence: number): void;
  onLookup(id: string, occurrence: number): void;
  onSaveExpression(id: string, occurrence: number): Promise<unknown>;
  getSavedExpressions(names: string[]): Promise<string[]>;
}
const pending = (status?: string) => Boolean(status && !['ready', 'failed', 'stopped', 'unknown'].includes(status));

/** All UI stays inside the existing extension shadow root. Webpage text is never interpreted as HTML. */
export function createReadingFocusToolbar(root: ShadowRoot, options: ToolbarOptions) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let preferences = normalizeReadingFocusPreferences(undefined);
  let draft = preferences;
  let status: ReadingFocusStatus = { enabled: false, count: 0, phase: 'off' };
  let expressions: ReadingExpression[] = [];
  let firstSetup = false;
  let starting = false;
  let currentTab = '';
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintKey = '';
  let hintValue: { group: ReadingFocusGroup; rect: Pick<DOMRect, 'left' | 'top' | 'bottom'> } | null = null;
  const style = doc.createElement('style');
  style.textContent = `
    .rfv2 { --rf-bg:#fffffff5;--rf-fg:#263242;--rf-muted:#657181;--rf-border:#71809640;--rf-accent:#366b9e; color:var(--rf-fg);font:400 12px/1.6 system-ui,sans-serif; }
    .rfv2[data-theme=dark] { --rf-bg:#151c22f7;--rf-fg:#e3e9ed;--rf-muted:#a9b5be;--rf-border:#9bb1bd42;--rf-accent:#a1c8ec; }
    .rfv2 *, .rfv2 *::before { box-sizing:border-box; }
    .rfv2 [hidden] { display:none!important; }
    .rfv2 button,.rfv2 select { font:inherit;color:inherit; }
    .rfv2 button { background:transparent;border:0;border-radius:7px;min-width:32px;min-height:32px;padding:5px 8px;cursor:pointer; }
    .rfv2 button:hover { background:#879ba521; }
    .rfv2 button:active { background:#879ba537; }
    .rfv2 button:disabled { opacity:.5;cursor:default; }
    .rfv2 :is(button,select,input):focus-visible { outline:2px solid var(--rf-accent);outline-offset:2px; }
    .rfv2-bar { position:fixed;bottom:14px;right:14px;max-width:calc(100vw - 28px);display:flex;align-items:center;gap:2px;background:var(--rf-bg);border:1px solid var(--rf-border);border-radius:10px;padding:3px 5px;box-shadow:0 3px 14px #0002;pointer-events:auto; }
    .rfv2-status { max-width:min(250px,32vw);padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .rfv2-pop { position:fixed;right:14px;bottom:62px;width:340px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 90px);overflow:auto;overscroll-behavior:contain;background:var(--rf-bg);border:1px solid var(--rf-border);border-radius:12px;box-shadow:0 8px 30px #0003;padding:14px;pointer-events:auto; }
    .rfv2 h2 { font:600 14px/1.5 system-ui;margin:0 0 12px;color:inherit; }
    .rfv2 p { margin:7px 0;color:var(--rf-muted); }
    .rfv2-label { display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0; }
    .rfv2 input[type=range] { width:100%;accent-color:var(--rf-accent); }
    .rfv2 input[type=checkbox] { accent-color:var(--rf-accent); }
    .rfv2 select { border:1px solid var(--rf-border);border-radius:6px;background:var(--rf-bg);padding:5px;max-width:180px; }
    .rfv2-demo { padding:10px;border:1px solid var(--rf-border);border-radius:8px; }
    .rfv2-demo div+div { margin-top:4px; }
    .rfv2-footer { display:flex;justify-content:flex-end;gap:8px;margin-top:12px; }
    .rfv2-primary { background:var(--rf-accent)!important;color:var(--rf-bg)!important; }
    .rfv2-legend { display:flex;gap:8px;flex-wrap:wrap; }
    .rfv2-legend span { padding:2px 5px;border-radius:3px; }
    .rfv2-learning-list { display:grid;gap:9px;margin-top:12px; }
    .rfv2-expression { border:1px solid var(--rf-border);border-radius:9px;overflow:hidden; }
    .rfv2 .rfv2-expression-heading { position:relative;display:block;width:100%;padding:11px 52px 11px 11px;text-align:left;border-radius:0; }
    .rfv2-expression-title { display:flex;align-items:baseline;gap:7px;flex-wrap:wrap; }
    .rfv2-expression-title strong { font-weight:550;font-size:14px;overflow-wrap:anywhere; }
    .rfv2-expression-title small { color:var(--rf-muted);font-size:10px; }
    .rfv2-expression-meaning { display:block;color:var(--rf-muted);margin-top:3px; }
    .rfv2-expression-count { position:absolute;right:11px;top:12px;color:var(--rf-muted);font-size:11px; }
    .rfv2-expression-heading[aria-expanded=true] { background:#879ba512; }
    .rfv2-expression-detail { border-top:1px solid var(--rf-border);padding:10px 11px; }
    .rfv2-expression-detail blockquote { margin:0 0 9px;line-height:1.7;overflow-wrap:anywhere; }
    .rfv2-expression-detail blockquote strong { font-weight:600;color:var(--rf-accent); }
    .rfv2-expression-actions { display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:10px; }
    .rfv2-expression-nav { display:flex;align-items:center;gap:4px; }
    .rfv2-expression-nav span { font-size:11px;color:var(--rf-muted);min-width:32px;text-align:center; }
    .rfv2-expression-secondary { display:flex;justify-content:flex-end;margin-top:4px;color:var(--rf-muted);font-size:11px; }
    .rfv2-saved-badge { color:var(--rf-accent);font-size:10px; }
    .rfv2 .rfv2-expression-save { border:1px solid var(--rf-border);border-radius:16px; }
    .rfv2-item { border-top:1px solid var(--rf-border);padding:10px 0; }
    .rfv2-item strong { font-size:13px; }
    .rfv2-item small { color:var(--rf-muted);margin-left:6px; }
    .rfv2-item p { margin:3px 0; }
    .rfv2-item blockquote { margin:5px 0;padding:0 0 0 8px;border-left:2px solid var(--rf-border);font-size:11px; }
    .rfv2-occurrences { display:flex;flex-wrap:wrap;gap:3px; }
    .rfv2-tip { position:fixed;pointer-events:none;max-width:260px;background:var(--rf-bg);color:var(--rf-fg);border:1px solid var(--rf-border);border-radius:7px;padding:5px 8px;box-shadow:0 3px 12px #0002;z-index:2; }
    .rfv2-preparation { position:fixed;bottom:14px;right:14px;width:260px;max-width:calc(100vw - 28px);padding:11px 13px;border:1px solid var(--rf-border);border-radius:11px;background:var(--rf-bg);box-shadow:0 3px 14px #0002;pointer-events:auto;transform-origin:bottom right; }
    .rfv2-preparation-heading { position:relative;display:flex;align-items:center;gap:8px;min-height:26px; }
    .rfv2-preparation-title { font-size:12px;font-weight:550; }
    .rfv2-preparation-icon { position:relative;display:grid;place-items:center;width:18px;height:18px;flex-shrink:0;color:var(--rf-accent); }
    .rfv2-preparation[data-state=pending] .rfv2-preparation-icon::before { content:'';width:15px;height:15px;border:1.5px solid var(--rf-border);border-top-color:var(--rf-accent);border-radius:50%;animation:rfv2-preparation-spin 850ms linear infinite; }
    @keyframes rfv2-preparation-spin { to { transform:rotate(1turn); } }
    .rfv2 .rfv2-preparation-more { margin-left:auto;padding:0 4px;color:var(--rf-muted); }
    .rfv2-preparation-footer { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:3px; }
    .rfv2-preparation-time { padding-left:26px;color:var(--rf-muted);font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums; }
    .rfv2-preparation-actions { display:flex;align-items:center; }
    .rfv2 .rfv2-preparation-actions button { font-size:10px;padding:5px 6px;color:var(--rf-muted); }
    .rfv2 .rfv2-preparation-note,.rfv2 .rfv2-preparation-detail { margin:8px 0 0 26px;font-size:11px;line-height:1.65;overflow-wrap:anywhere; }
    .rfv2-preparation-detail { max-height:120px;overflow:auto; }
    .rfv2-preparation-menu { position:absolute;right:0;bottom:100%;z-index:1;min-width:120px;padding:4px;border:1px solid var(--rf-border);border-radius:8px;background:var(--rf-bg);box-shadow:0 3px 14px #0002; }
    .rfv2-preparation-menu button { display:block;width:100%;text-align:left; }
    @media(prefers-reduced-motion:reduce) { .rfv2-preparation[data-state=pending] .rfv2-preparation-icon::before { animation:none; } }
    @media(max-width:520px) { .rfv2-status { max-width:90px; } }
  `;
  const surface = doc.createElement('div'); surface.className = 'rfv2'; surface.hidden = true;
  const bar = doc.createElement('div'); bar.className = 'rfv2-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '辅助阅读工具条');
  const message = doc.createElement('span'); message.className = 'rfv2-status'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const pop = doc.createElement('section'); pop.className = 'rfv2-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '辅助阅读选项');
  const tip = doc.createElement('div'); tip.className = 'rfv2-tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  const button = (label: string, action: () => void, parent: HTMLElement = bar) => {
    const element = doc.createElement('button'); element.type = 'button'; element.textContent = label; element.addEventListener('click', action); parent.append(element); return element;
  };
  const hideHint = () => { clearTimeout(hintTimer); hintKey = ''; hintValue = null; tip.hidden = true; };
  const closePop = () => { pop.hidden = true; currentTab = ''; firstSetup = false; };
  const learningList = createExpressionLearningList(doc, { locate: options.onLocate, save: options.onSaveExpression, saved: options.getSavedExpressions, translate: (id, index) => { closePop(); options.onLookup(id, index); } });
  const heading = (title: string) => { hideHint(); pop.replaceChildren(); const h = doc.createElement('h2'); h.textContent = title; pop.append(h); pop.hidden = false; };
  const paragraph = (text: string, parent: HTMLElement = pop) => { const p = doc.createElement('p'); p.textContent = text; parent.append(p); return p; };
  const refreshTheme = () => {
    const computed = win.getComputedStyle(doc.body ?? doc.documentElement);
    const channels = computed.color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    surface.dataset.theme = channels && channels.reduce((a, b) => a + b, 0) / 3 > 150 ? 'dark' : 'light';
  };
  const changed = (patch: Partial<ReadingFocusPreferences>) => {
    draft = normalizeReadingFocusPreferences({ ...draft, ...patch });
    if (!firstSetup) { preferences = draft; options.onPreferences(preferences); }
  };
  function settings(initial = false) {
    firstSetup = initial; currentTab = 'settings'; draft = { ...preferences }; refreshTheme(); surface.hidden = false;
    heading(initial ? '设置你的阅读方式' : '阅读设置');
    const row = (title: string, input: HTMLElement) => { const label = doc.createElement('label'); label.className = 'rfv2-label'; const span = doc.createElement('span'); span.textContent = title; label.append(span, input); pop.append(label); return label; };
    const opacity = doc.createElement('input'); opacity.type = 'range'; opacity.min = '15'; opacity.max = '92'; opacity.step = '1'; opacity.value = String(Math.round((1 - draft.dimOpacity) * 100)); opacity.setAttribute('aria-label', '非当前段落变暗程度');
    const value = doc.createElement('output'); value.textContent = `${opacity.value}%`; row('非当前段落变暗', value); pop.append(opacity);
    const demo = doc.createElement('div'); demo.className = 'rfv2-demo'; const active = doc.createElement('div'); active.textContent = 'Read meaningful phrases together.'; const dim = doc.createElement('div'); dim.textContent = 'Other paragraphs stay in the background.'; dim.style.opacity = String(draft.dimOpacity); demo.append(active, dim); pop.append(demo);
    opacity.addEventListener('input', () => { changed({ dimOpacity: 1 - Number(opacity.value) / 100 }); dim.style.opacity = String(draft.dimOpacity); value.textContent = `${opacity.value}%`; });
    const checkbox = (title: string, key: 'highlightEnabled' | 'expressionEnabled' | 'autoScanExpressions') => { const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = draft[key]; input.addEventListener('change', () => changed({ [key]: input.checked })); row(title, input); };
    checkbox('意群高亮', 'highlightEnabled'); checkbox('固定搭配下划线', 'expressionEnabled'); checkbox('进入时自动扫描固定搭配', 'autoScanExpressions');
    const select = doc.createElement('select'); select.setAttribute('aria-label', '高亮显示模式');
    for (const [id, name] of [['full', '完整意群'], ['skeleton', '仅显示骨架'], ['practice', '原文练习']]) { const item = doc.createElement('option'); item.value = id!; item.textContent = name!; select.append(item); }
    select.value = draft.displayMode; select.addEventListener('change', () => changed({ displayMode: select.value as ReadingFocusPreferences['displayMode'] })); row('高亮显示模式', select);
    paragraph('固定搭配扫描与意群分别分析、分别缓存。默认手动扫描；切换显示不会重复请求。');
    const footer = doc.createElement('div'); footer.className = 'rfv2-footer'; pop.append(footer);
    button(initial ? '取消' : '完成', () => { closePop(); if (initial) { surface.hidden = true; options.onExit(); } }, footer);
    if (initial) {
      const start = button('保存并开始', () => {
        if (starting) return; starting = true; start.disabled = true;
        const next = normalizeReadingFocusPreferences({ ...draft, initialized: true });
        void options.onStart(next).then(() => { preferences = next; closePop(); }).catch(() => {
          paragraph('设置保存失败，请重试。'); start.disabled = false;
        }).finally(() => { starting = false; });
      }, footer); start.className = 'rfv2-primary';
    }
    (initial ? opacity : select).focus({ preventScroll: true });
  }
  function legend() {
    currentTab = 'legend'; heading('意群颜色');
    const items = doc.createElement('div'); items.className = 'rfv2-legend';
    for (const [label, color] of [['核心信息', '#609ee24a'], ['条件 / 范围', '#a27ade4a'], ['原因 / 目的', '#6bb5884a'], ['其他关系', '#d8a0614a']]) { const span = doc.createElement('span'); span.textContent = label!; span.style.background = color!; items.append(span); }
    pop.append(items); paragraph('悬浮标记可查看定义、判断标准、让步、例外等具体含义。颜色只作阅读提示，不替代完整理解。');
    button('关闭说明', closePop, pop);
  }
  let listMessage: HTMLElement | null = null;
  let listActions: HTMLElement | null = null;
  function list() {
    hideHint();
    if (currentTab !== 'expressions' || !pop.contains(learningList.element)) {
      currentTab = 'expressions'; heading('文章表达');
      listMessage = paragraph('');
      listActions = doc.createElement('div'); pop.append(listActions, learningList.element);
      button('关闭清单', closePop, pop);
    }
    const state = status.expressionTaskStatus;
    if (listMessage) listMessage.textContent = status.expressionMessage || (expressions.length
      ? learningList.count + ' 条表达 · 展开查看用法，选择例句后收藏。' : state === 'ready' ? '这篇文章暂未选出值得积累的表达。' : '提取值得复用的表达和术语。');
    listActions?.replaceChildren();
    if (pending(state)) button('停止搭配扫描', options.onStopExpressions, listActions!);
    else if (state === 'unknown') paragraph('原任务状态未确认，请在 WorkOS 检查；不会自动重发。', listActions!);
    else if (state !== 'ready') button(state === 'failed' || state === 'stopped' ? '重试搭配扫描' : '扫描全文搭配', () => options.onScan(state === 'failed' || state === 'stopped'), listActions!);
  }
  bar.append(message);
  button('图例', () => currentTab === 'legend' ? closePop() : legend());
  button('搭配', () => { if (currentTab === 'expressions') closePop(); else { list(); void learningList.refreshSaved(); } });
  button('设置', () => currentTab === 'settings' ? closePop() : settings());
  button('退出', () => { closePop(); options.onExit(); });
  surface.append(bar, pop, tip); root.append(style, surface);
  const preparation = createReadingPreparation(surface, {
    onExit: () => { closePop(); options.onExit(); }, onStop: options.onStop, onRetry: options.onRetry,
    onVisibilityChange(visible) {
      bar.hidden = visible || !status.enabled || firstSetup;
      if (!bar.hidden && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        bar.animate?.([{ opacity: 0, transform: 'translateY(3px) scale(.98)' }, { opacity: 1, transform: 'none' }],
          { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    },
  });
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pop.hidden) { event.stopPropagation(); if (firstSetup) { surface.hidden = true; options.onExit(); } closePop(); } };
  surface.addEventListener('keydown', onKey);
  return {
    update(value: ReadingFocusStatus, prefs: ReadingFocusPreferences) {
      status = value; preferences = prefs; refreshTheme(); surface.hidden = !value.enabled && !firstSetup;
      preparation.update(value);
      bar.hidden = !value.enabled || preparation.visible;
      message.textContent = value.phase === 'error' && value.count ? '段落聚焦' : '辅助阅读'; message.title = value.message || '选中生词可查词';
      if (!value.enabled && !firstSetup) { closePop(); hideHint(); learningList.clear(); }
      if (currentTab === 'expressions') list();
    },
    setExpressions(items: ReadingExpression[]) { expressions = items; learningList.setExpressions(items); if (currentTab === 'expressions') { list(); void learningList.refreshSaved(); } },
    openExpression(id: string, index: number) { list(); learningList.open(id, index); void learningList.refreshSaved(); },
    refreshSavedExpressions() { return learningList.refreshSaved(); },
    groupDetails(group: ReadingFocusGroup) {
      const hint = readingHint(group);
      if (!hint) return;
      hideHint(); currentTab = 'group'; heading(hint.title);
      const original = doc.createElement('blockquote'); original.textContent = group.text; pop.append(original);
      if (hint.detail) paragraph(hint.detail);
      button('关闭提示', closePop, pop);
    },
    openSettings(initial = false, prefs?: ReadingFocusPreferences) { if (prefs) preferences = prefs; bar.hidden = initial; settings(initial); },
    cancelSetup() { if (firstSetup) { closePop(); surface.hidden = true; } },
    groupHint(value: { group: ReadingFocusGroup; rect: Pick<DOMRect, 'left' | 'top' | 'bottom'> } | null) {
      if (!value || !status.enabled || !pop.hidden) { hideHint(); return; }
      const hint = readingHint(value.group);
      if (!hint) { hideHint(); return; }
      const key = JSON.stringify([value.group.start, value.group.end, value.group.text, hint.title]);
      hintValue = value;
      const position = () => {
        if (!hintValue) return;
        tip.style.left = Math.max(8, Math.min(hintValue.rect.left, win.innerWidth - 270)) + 'px';
        tip.style.top = Math.max(8, Math.min(hintValue.rect.bottom + 6, win.innerHeight - tip.offsetHeight - 8)) + 'px';
      };
      if (key === hintKey) { if (!tip.hidden) position(); return; }
      clearTimeout(hintTimer); tip.hidden = true; hintKey = key;
      hintTimer = setTimeout(() => {
        if (hintKey !== key || !status.enabled || !pop.hidden) return;
        tip.textContent = hint.title + (hint.detail ? ' · 点击查看用法' : '');
        tip.hidden = false; position();
      }, 320);
    },
    destroy() { hideHint(); preparation.destroy(); learningList.clear(); surface.remove(); style.remove(); },
  };
}
