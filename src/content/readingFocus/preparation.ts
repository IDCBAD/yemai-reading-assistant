import type { ReadingFocusStatus } from './index';

const working = new Set(['preparing', 'creating', 'analyzing', 'receiving', 'checking', 'stopping']);
const stages: Record<string, string> = {
  preparing: '正在准备文章分析', creating: '正在准备文章分析', analyzing: '正在分析文章意群',
  receiving: '正在接收分析结果', checking: '正在核对原文位置', stopping: '正在请求停止分析',
};

export function preparationContent(status: ReadingFocusStatus, elapsed: number) {
  const task = status.taskStatus;
  const pending = (status.phase === 'preparing' || status.phase === 'checking') && (!task || working.has(task));
  const failed = status.phase === 'error' || status.phase === 'unsupported';
  const cannotStop = task === 'stopping' && Boolean(status.message?.includes('不支持远端停止'));
  return {
    pending, failed,
    title: pending ? (cannotStop ? '正在等待分析结果' : task ? stages[task] ?? '正在准备意群' : '正在识别文章正文')
      : task === 'unknown' ? '分析状态未确认' : task === 'stopped' ? '分析已停止'
        : failed ? '意群暂不可用' : '意群已就绪',
    note: pending ? (cannotStop ? '当前连接不支持远端停止，结果返回后会缓存。' : elapsed >= 30 && task !== 'stopping' ? '可以退出，分析会在后台继续。' : '')
      : task === 'unknown' ? '原任务可能仍在运行，请先检查，暂不重复提交。'
        : failed ? (status.message ?? '可以继续阅读原文。')
          : status.invalidCount ? `已准备 ${status.readyCount ?? 0}/${status.count} 段，其余段落仅提供聚焦。` : '',
    canStop: Boolean(status.taskId && (task === 'unknown' || (task && working.has(task) && task !== 'stopping'))),
    canRetry: task === 'failed' || task === 'stopped',
  };
}

/** Owns only local presentation timers. Exiting/destroying never stops the background task. */
export function createReadingPreparation(parent: HTMLElement, options: {
  onExit(): void; onStop(): void; onRetry(): void; onVisibilityChange(visible: boolean): void;
}) {
  const doc = parent.ownerDocument;
  const win = doc.defaultView!;
  const card = doc.createElement('section'); card.className = 'rfv2-preparation'; card.hidden = true;
  card.setAttribute('aria-label', '辅助阅读准备');
  const header = doc.createElement('div'); header.className = 'rfv2-preparation-heading';
  const icon = doc.createElement('span'); icon.className = 'rfv2-preparation-icon'; icon.setAttribute('aria-hidden', 'true');
  const title = doc.createElement('span'); title.className = 'rfv2-preparation-title'; title.setAttribute('role', 'status'); title.setAttribute('aria-live', 'polite');
  const more = doc.createElement('button'); more.className = 'rfv2-preparation-more'; more.type = 'button'; more.textContent = '•••'; more.setAttribute('aria-label', '分析操作'); more.setAttribute('aria-expanded', 'false');
  const menu = doc.createElement('div'); menu.className = 'rfv2-preparation-menu'; menu.hidden = true;
  const action = (label: string, handler: () => void, container: HTMLElement) => {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', handler); container.append(button); return button;
  };
  const closeMenu = () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); };
  const stop = action('停止', () => { closeMenu(); options.onStop(); }, menu);
  const resume = action('继续阅读', () => { closeMenu(); dismissedError = errorKey(); collapse(); }, menu);
  const details = action('查看详情', () => { closeMenu(); detail.hidden = !detail.hidden; details.setAttribute('aria-expanded', String(!detail.hidden)); }, menu);
  details.setAttribute('aria-expanded', 'false');
  header.append(icon, title, more, menu);
  const footer = doc.createElement('div'); footer.className = 'rfv2-preparation-footer';
  const time = doc.createElement('span'); time.className = 'rfv2-preparation-time';
  const actions = doc.createElement('div'); actions.className = 'rfv2-preparation-actions';
  const retry = action('重试', () => { closeMenu(); options.onRetry(); }, actions);
  const exit = action('退出', () => { closeMenu(); if (completion) collapse(); else options.onExit(); }, actions);
  footer.append(time, actions);
  const note = doc.createElement('p'); note.className = 'rfv2-preparation-note'; note.hidden = true;
  const detail = doc.createElement('p'); detail.className = 'rfv2-preparation-detail'; detail.hidden = true;
  card.append(header, footer, note, detail); parent.append(card);
  let status: ReadingFocusStatus = { enabled: false, count: 0, phase: 'off' };
  let start = Date.now();
  let observed = '';
  let completed = '';
  let completion = false;
  let dismissedError = '';
  let interval: ReturnType<typeof setInterval> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let motion: Animation | undefined;
  let motionRevision = 0;
  let destroyed = false;
  const elapsed = () => Math.max(0, Math.floor((Date.now() - start) / 1000));
  const errorKey = () => JSON.stringify([status.taskId, status.taskCreatedAt, status.phase, status.taskStatus, status.message]);
  const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clearTimers = () => { clearInterval(interval); interval = undefined; clearTimeout(finishTimer); clearTimeout(revealTimer); finishTimer = revealTimer = undefined; };
  const visible = (show: boolean) => {
    if (show === !card.hidden) return;
    motion?.cancel(); card.hidden = !show;
    options.onVisibilityChange(show);
    if (show && !reduced()) motion = card.animate?.([
      { opacity: 0, transform: 'translateY(5px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
  };
  function collapse() {
    clearTimers(); completion = false;
    const revision = ++motionRevision;
    if (!reduced() && card.animate) {
      motion?.cancel();
      motion = card.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: 120, easing: 'ease-out' });
      motion.onfinish = () => { if (!destroyed && revision === motionRevision && !completion && !preparationContent(status, elapsed()).pending) visible(false); };
    } else visible(false);
  }
  const paint = () => {
    const content = preparationContent(status, elapsed());
    if (title.textContent !== content.title) title.textContent = content.title;
    card.dataset.state = content.pending ? 'pending' : content.failed ? 'error' : 'ready';
    icon.textContent = content.pending ? '' : content.failed ? '!' : '✓';
    time.textContent = content.pending ? `已等待 ${elapsed()} 秒` : content.failed ? '可继续阅读原文' : '移到段落，开始阅读';
    retry.hidden = !content.canRetry;
    stop.hidden = !content.canStop;
    resume.hidden = !content.failed;
    exit.textContent = completion ? '开始阅读' : '退出';
    exit.title = content.pending ? '退出后，分析会在后台继续' : completion ? '开始悬浮阅读' : '关闭辅助阅读界面';
    // Keep routine waiting to two lines. Full failure details stay available explicitly.
    const diagnostic = content.failed && status.taskStatus !== 'unknown' && content.note.length > 50;
    note.textContent = diagnostic ? '请查看详情，或继续阅读原文。' : content.note;
    note.hidden = !note.textContent;
    details.hidden = !((content.failed || status.taskStatus === 'stopping') && status.message);
    detail.textContent = status.message ?? '';
    more.hidden = stop.hidden && details.hidden && resume.hidden;
    if (more.hidden) closeMenu();
  };
  more.addEventListener('click', () => { menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); });
  const outside = (event: Event) => { if (!event.composedPath().includes(card)) closeMenu(); };
  const shadowHost = (parent.getRootNode() as ShadowRoot).host;
  const outsidePage = (event: Event) => { if (!event.composedPath().includes(shadowHost)) closeMenu(); };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && (!menu.hidden || !detail.hidden)) { closeMenu(); detail.hidden = true; event.stopPropagation(); } };
  doc.addEventListener('pointerdown', outsidePage, true); parent.addEventListener('pointerdown', outside, true); card.addEventListener('keydown', escape);
  return {
    get visible() { return !card.hidden; },
    update(value: ReadingFocusStatus) {
      if (destroyed) return;
      status = value;
      if (!value.enabled) {
        motionRevision++;
        clearTimers(); completion = false; observed = completed = dismissedError = ''; closeMenu(); detail.hidden = true; visible(false); return;
      }
      const content = preparationContent(value, elapsed());
      const key = `${value.taskId ?? ''}:${value.taskCreatedAt ?? ''}`;
      if (content.pending) {
        motionRevision++;
        motion?.cancel();
        clearTimeout(finishTimer); completion = false;
        if (value.taskId && key !== observed) { start = Date.now(); observed = key; completed = ''; }
        if (!value.taskId && !interval) start = Date.now();
        if (Number.isFinite(value.taskCreatedAt) && value.taskCreatedAt! > 0 && value.taskCreatedAt! <= Date.now()) start = value.taskCreatedAt!;
        paint();
        if (!interval) interval = setInterval(paint, 1000);
        // A cache lookup normally resolves before this delay; do not flash a waiting card for it.
        if (value.taskId) { clearTimeout(revealTimer); visible(true); }
        else if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = undefined; if (status.enabled && preparationContent(status, elapsed()).pending) visible(true); }, 160);
      } else if (content.failed) {
        motionRevision++;
        motion?.cancel(); clearTimers(); completion = false; closeMenu();
        if (dismissedError === errorKey()) { visible(false); return; }
        paint(); visible(true);
      } else if (value.taskStatus === 'ready' && observed === key && completed !== key) {
        clearTimers(); completion = true; completed = key; closeMenu(); detail.hidden = true; paint(); visible(true);
        finishTimer = setTimeout(collapse, 1500);
      } else if (completion && completed === key) {
        paint();
      } else {
        clearTimers(); completion = false; visible(false);
      }
    },
    destroy() { destroyed = true; motionRevision++; clearTimers(); motion?.cancel(); doc.removeEventListener('pointerdown', outsidePage, true); parent.removeEventListener('pointerdown', outside, true); card.remove(); },
  };
}
