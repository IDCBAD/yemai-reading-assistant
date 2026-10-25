import { createReadingFocus, type ReadingFocusStatus } from '../../src/content/readingFocus';
import { createReadingFocusToolbar } from '../../src/content/readingFocus/toolbar';
import { normalizeReadingFocusPreferences, type ReadingFocusPreferences } from '../../src/shared/readingFocusPreferences';
import { parsePageReadingExpressionsAnalysis, type ReadingExpression } from '../../src/shared/readingExpressions';
import { normalizeLearningExpressionName } from '../../src/shared/expressionLearning';
import { createReadingWordPopover } from '../../src/content/readingWordPopover';
import { captureWordSelection } from '../../src/content/wordSelection';
import type { ReadingFocusGroupKind } from '../../src/shared/readingFocus';
import { pageReadingKey, pageReadingTaskView, parsePageReadingAnalysis, type PageReadingSnapshot, type PageReadingTask } from '../../src/shared/pageReadingFocus';

const button = document.querySelector<HTMLButtonElement>('#toggle')!;
const status = document.querySelector<HTMLElement>('#status')!;
const delay = document.querySelector<HTMLSelectElement>('#delay')!;
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
const failure = document.querySelector<HTMLButtonElement>('#failure')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const clear = document.querySelector<HTMLButtonElement>('#clear')!;
const CACHE_PREFIX = 'yemai-reading-focus-preview:v1:';
const MOCK_TARGET = 'preview:mock:local';
const tasks = new Map<string, PageReadingTask>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let calls = 0;
let saves = 0;
const savedExpressionNames = new Set<string>();
let latest: ReadingFocusStatus;
const PREF_KEY = 'yemai-reading-focus-preview:v2-preferences';
let preferences = normalizeReadingFocusPreferences({ initialized: true });
try { const saved = localStorage.getItem(PREF_KEY); if (saved) preferences = normalizeReadingFocusPreferences(JSON.parse(saved)); } catch { /* Defaults remain usable. */ }
let toolbar: ReturnType<typeof createReadingFocusToolbar> | undefined;
const savePreferences = (value: ReadingFocusPreferences) => { preferences = value; localStorage.setItem(PREF_KEY, JSON.stringify(value)); controller.setPreferences(value); };
const showExpression = (expression: ReadingExpression, index: number, range: Range) => {
  const item = expression.occurrences[index];
  if (item) popover.show({ word: item.text, sentence: item.sentence, highlightStart: item.highlightStart, highlightEnd: item.highlightEnd,
    meaning: expression.meaning, expression: { name: expression.text }, source: { kind: 'page', title: document.title, url: location.href } }, range.getBoundingClientRect());
};

function loadTask(id: string): PageReadingTask | undefined {
  const current = tasks.get(id);
  if (current) return current;
  try {
    const saved = localStorage.getItem(CACHE_PREFIX + id);
    if (!saved) return undefined;
    const task = JSON.parse(saved) as PageReadingTask;
    if (task.id !== id || !['ready', 'failed', 'stopped'].includes(task.status)) return undefined;
    tasks.set(id, task);
    return task;
  } catch { return undefined; }
}

function saveTask(task: PageReadingTask) {
  task.updatedAt = Date.now();
  tasks.set(task.id, task);
  if (['ready', 'failed', 'stopped'].includes(task.status)) localStorage.setItem(CACHE_PREFIX + task.id, JSON.stringify(task));
}

function mockResult(snapshot: PageReadingSnapshot) {
  const phrases: Array<[string, ReadingFocusGroupKind]> = [
    ['You will not be charged for token usage', 'core'], ['even if the provider charges for processing', 'detail'],
    ['Use a script', 'core'], ["if there's no suitable API", 'condition'], ['and the workflow is predictable', 'condition'],
    ['An API provides a stable interface', 'core'], ['because it exposes structured data', 'reason'], ['For example', 'detail'],
    ['Keep the original document structure intact', 'core'], ['so that links and keyboard navigation continue to work', 'reason'],
    ['When the source changes', 'condition'], ['discard the old result', 'core'],
    ['If an analysis fails', 'condition'], ['preserve the ordinary reading experience', 'core'],
  ];
  return parsePageReadingAnalysis(JSON.stringify({ paragraphs: snapshot.paragraphs.map(({ id, text }) => ({
    id, groups: phrases.filter(([phrase]) => text.includes(phrase)).sort(([a], [b]) => text.indexOf(a) - text.indexOf(b))
      .map(([phrase, kind]) => ({ text: phrase, isCore: kind === 'core',
        semantic: kind === 'core' ? (phrase.startsWith('An API') ? 'definition' : 'statement') : kind === 'condition' ? 'condition'
          : kind === 'reason' ? (phrase.startsWith('because') ? 'cause' : 'purpose') : phrase.startsWith('even if') ? 'concession' : 'example',
        ...(phrase.startsWith('even if') ? { cue: { text: 'even if', meaning: '即使……也……' }, learningNote: '即使提供商仍然收费，也不改变前面不向用户收取 token 费用的结论。' } : {}) })),
  })) }), snapshot);
}

const controller = createReadingFocus({
  preferences,
  onExpressions: items => toolbar?.setExpressions(items),
  onGroupHover: value => toolbar?.groupHint(value),
  onExpressionClick: (expression, index) => toolbar?.openExpression(expression.id, index),
  onGroupClick: group => toolbar?.groupDetails(group),
  onStatus(value) {
    latest = value;
    toolbar?.update(value, preferences);
    button.setAttribute('aria-pressed', String(value.enabled));
    button.textContent = value.enabled ? '退出辅助阅读' : '开启辅助阅读';
    status.textContent = value.message || ({ off: '原始网页 · 已启动任务在后台继续', preparing: '正在准备整篇文章…', checking: '正在检查原文…', ready: '整篇已准备，移到英文段落开始', highlighted: '意群已显示', error: '分析失败，仍可正常阅读', unsupported: '仅段落聚焦' }[value.phase]);
    stop.disabled = !value.enabled || !value.taskId || !value.taskStatus || ['ready', 'failed', 'stopped', 'stopping'].includes(value.taskStatus);
    retry.disabled = !value.enabled || !['failed', 'stopped'].includes(value.taskStatus ?? '');
  },
  async prepare(snapshot, retry = false, mode = 'groups') {
    const id = await pageReadingKey(snapshot, MOCK_TARGET, mode);
    const existing = loadTask(id);
    if (existing && !(retry && ['failed', 'stopped'].includes(existing.status))) return pageReadingTaskView(existing);
    calls++;
    const shouldFail = failure.getAttribute('aria-pressed') === 'true';
    const task: PageReadingTask = { id, mode, snapshot, target: MOCK_TARGET, status: 'analyzing', createdAt: Date.now(), updatedAt: Date.now(), message: '正在模拟整篇分析…' };
    saveTask(task);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (tasks.get(id) !== task || task.status !== 'analyzing') return;
      if (shouldFail) saveTask({ ...task, status: 'failed', message: '模拟分析失败。可点击“重试分析”。' });
      else saveTask({ ...task, status: 'ready', message: undefined, result: mode === 'groups' ? mockResult(snapshot) : parsePageReadingExpressionsAnalysis(JSON.stringify({ expressions: [
        ['even if', '即使……也……'], ['protects users from being charged', '保护……免于……'],
        ['stable interface', '稳定的接口'], ['structured data', '结构化数据'], ['so that', '以便；从而'], ['For example', '例如'],
      ].map(([phrase, meaning]) => ({ text: phrase!.startsWith('protects') ? 'protect … from …' : phrase!, meaning, category: phrase!.startsWith('protects') ? 'pattern' : 'collocation', occurrences: snapshot.paragraphs.flatMap(({ id, text }) => {
        const found: Array<{ paragraphId: string; text: string; occurrence: number }> = [];
        for (let at = text.indexOf(phrase!), count = 0; at >= 0; at = text.indexOf(phrase!, at + 1), count++) found.push({ paragraphId: id, text: phrase!, occurrence: count });
        return found;
      }) })).filter(item => item.occurrences.length) }), snapshot) });
    }, Number(delay.value)));
    return pageReadingTaskView(task);
  },
  async getTask(id) {
    const task = loadTask(id);
    if (!task) throw new Error('预览任务不存在，请重新开启。');
    return pageReadingTaskView(task);
  },
  async stopTask(id) {
    const task = loadTask(id);
    if (!task) throw new Error('预览任务不存在。');
    if (!['ready', 'failed', 'stopped'].includes(task.status)) {
      clearTimeout(timers.get(id)); timers.delete(id);
      saveTask({ ...task, status: 'stopped', message: '模拟分析已停止，重新开启不会自动重试。' });
    }
    return pageReadingTaskView(tasks.get(id)!);
  },
});
const host = document.createElement('div'); host.dataset.yebianSelection = 'true'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
const root = host.attachShadow({ mode: 'open' }); document.body.append(host);
const popover = createReadingWordPopover(root, {
  lookup: async (word) => ({ predictable: 'a. 可预测的', script: 'n. 脚本', workflow: 'n. 工作流程' }[word.toLowerCase()] ?? '模拟释义：可收藏此词和当前原句。'),
  save: async (capture) => {
    if (capture.expression) { const key = normalizeLearningExpressionName(capture.expression.name); if (!savedExpressionNames.has(key)) saves++; savedExpressionNames.add(key); void toolbar?.refreshSavedExpressions(); }
    else saves++;
    return capture;
  },
});
toolbar = createReadingFocusToolbar(root, {
  onExit: () => { controller.disable(); popover.hide(); lookup.hidden = true; },
  onStart: async value => { savePreferences(value); controller.enable(); },
  onPreferences: savePreferences,
  onStop: () => { void controller.stop(); }, onRetry: () => { void controller.retry(); },
  onScan: retry => { controller.scanExpressions(retry); }, onStopExpressions: () => { void controller.stopExpressions(); },
  onLocate: (id, index) => { controller.locateExpression(id, index); },
  getSavedExpressions: async names => names.map(normalizeLearningExpressionName).filter(name => savedExpressionNames.has(name)),
  onSaveExpression: async (id, index) => {
    const expression = controller.expressions.find(item => item.id === id);
    if (!expression || !controller.getExpressionRange(id, index)) throw Error('原文无法对应。');
    const key = normalizeLearningExpressionName(expression.text);
    if (!savedExpressionNames.has(key)) saves++;
    savedExpressionNames.add(key);
  },
  onLookup: (id, index) => { const expression = controller.expressions.find(item => item.id === id); const range = controller.locateExpression(id, index); if (expression && range) showExpression(expression, index, range); },
});
const setup = document.createElement('button'); setup.textContent = '预览首次设置'; setup.addEventListener('click', () => toolbar?.openSettings(true, preferences)); button.parentElement?.append(setup);
const lookup = document.createElement('button'); lookup.textContent = '查词'; lookup.hidden = true;
lookup.style.cssText = 'position:fixed;pointer-events:auto;padding:8px 14px;background:#fff;color:#29425e;border:1px solid #bac8d2;border-radius:8px;font:13px system-ui;cursor:pointer'; root.append(lookup);
let selected: ReturnType<typeof captureWordSelection> = null;
let rect: DOMRect;
lookup.addEventListener('pointerdown', (event) => event.preventDefault());
lookup.addEventListener('click', () => { if (selected) popover.show(selected, rect); lookup.hidden = true; });
document.addEventListener('pointerup', (event) => {
  if (event.composedPath().includes(host) || !controller.enabled) return;
  const selection = window.getSelection();
  if (!selection) { lookup.hidden = true; return; }
  selected = captureWordSelection(selection, { kind: 'page', title: document.title, url: location.href });
  if (!selected || !selection?.rangeCount) { lookup.hidden = true; return; }
  rect = selection.getRangeAt(0).getBoundingClientRect(); lookup.style.left = `${rect.left}px`; lookup.style.top = `${rect.bottom + 6}px`; lookup.hidden = false;
});
button.addEventListener('click', () => { if (controller.enabled) { controller.disable(); popover.hide(); lookup.hidden = true; } else controller.enable(); });
theme.addEventListener('change', () => {
  document.body.classList.remove('preview-dark', 'preview-gray', 'preview-mixed');
  if (theme.value !== 'light') document.body.classList.add(`preview-${theme.value}`);
});
failure.addEventListener('click', () => failure.setAttribute('aria-pressed', String(failure.getAttribute('aria-pressed') !== 'true')));
stop.addEventListener('click', () => { void controller.stop(); });
retry.addEventListener('click', () => { void controller.retry(); });
function clearCache() {
  controller.disable(); popover.hide(); lookup.hidden = true;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear(); tasks.clear();
  for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
  status.textContent = '预览缓存已清除。再次开启将启动新的模拟任务。';
}
clear.addEventListener('click', clearCache);
Object.assign(window, { readingFocusPreview: {
  controller, clearCache, cachePrefix: CACHE_PREFIX,
  get calls() { return calls; }, get saves() { return saves; }, get status() { return latest; },
  get tasks() { return [...tasks.values()].map(pageReadingTaskView); },
} });
