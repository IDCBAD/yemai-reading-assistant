import type { ReadingExpression, ReadingExpressionOccurrence } from '../../shared/readingExpressions';
import { EXPRESSION_CATEGORY_LABELS } from '../../shared/readingExpressions';
import { normalizeLearningExpressionName } from '../../shared/expressionLearning';

type Location = { expression: ReadingExpression; index: number; occurrence: ReadingExpressionOccurrence };
type Entry = { key: string; expression: ReadingExpression; locations: Location[] };
interface Options {
  locate(id: string, occurrence: number): void;
  save(id: string, occurrence: number): Promise<unknown>;
  saved(names: string[]): Promise<string[]>;
  translate(id: string, occurrence: number): void;
}

/** Display identities can be templates; locations always retain their original analysis IDs. */
export function learningEntries(expressions: ReadingExpression[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const expression of expressions) {
    const key = normalizeLearningExpressionName(expression.text);
    let entry = entries.get(key);
    if (!entry) { entry = { key, expression, locations: [] }; entries.set(key, entry); }
    if (entry.expression.category === 'term' && expression.category !== 'term') entry.expression = expression;
    for (const [index, occurrence] of expression.occurrences.entries()) {
      if (!entry.locations.some(({ occurrence: prior }) => prior.paragraphId === occurrence.paragraphId
        && prior.start === occurrence.start && prior.end === occurrence.end)) entry.locations.push({ expression, index, occurrence });
    }
  }
  return [...entries.values()].filter(entry => entry.locations.length)
    .sort((a, b) => Number(a.expression.category === 'term') - Number(b.expression.category === 'term'));
}

export function representativeLocation(locations: ReadonlyArray<{ occurrence: ReadingExpressionOccurrence }>) {
  let best = 0, score = Infinity;
  locations.forEach(({ occurrence }, index) => {
    // A short complete source sentence is preferable to a clipped fragment or a huge context.
    const complete = /^[A-Z]/u.test(occurrence.sentence) && /[.!?]$/u.test(occurrence.sentence);
    const next = occurrence.sentence.length + (complete ? 0 : 300);
    if (next < score) { best = index; score = next; }
  });
  return best;
}

export function createExpressionLearningList(doc: Document, options: Options) {
  const element = doc.createElement('div'); element.className = 'rfv2-learning-list';
  let entries: Entry[] = [];
  let expanded: string | null = null;
  let generation = 0;
  let refreshGeneration = 0;
  const selected = new Map<string, number>();
  const saved = new Set<string>();
  const saving = new Set<string>();
  const issues = new Map<string, string>();
  const rows = new Map<string, { button: HTMLButtonElement; detail: HTMLDivElement; badge: HTMLSpanElement }>();

  const makeButton = (label: string, action: () => void, parent: HTMLElement) => {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', action); parent.append(button); return button;
  };
  const renderDetail = (entry: Entry, detail: HTMLDivElement) => {
    detail.replaceChildren();
    const location = entry.locations[selected.get(entry.key) ?? representativeLocation(entry.locations)]!;
    const source = location.occurrence;
    const example = doc.createElement('blockquote'); example.className = 'rfv2-example';
    const text = source.sentence;
    const start = source.highlightStart, end = source.highlightEnd;
    const mark = doc.createElement('strong'); mark.textContent = text.slice(start, end);
    example.append(doc.createTextNode(text.slice(0, start)), mark, doc.createTextNode(text.slice(end))); detail.append(example);
    if (entry.expression.usage) { const usage = doc.createElement('p'); usage.textContent = entry.expression.usage; detail.append(usage); }
    const actions = doc.createElement('div'); actions.className = 'rfv2-expression-actions'; detail.append(actions);
    const navigation = doc.createElement('div'); navigation.className = 'rfv2-expression-nav'; navigation.setAttribute('aria-label', `${entry.expression.text}的原文位置`); actions.append(navigation);
    const navigate = (direction: number) => {
      const index = Math.max(0, Math.min(entry.locations.length - 1, (selected.get(entry.key) ?? representativeLocation(entry.locations)) + direction));
      selected.set(entry.key, index);
      const next = entry.locations[index]!;
      options.locate(next.expression.id, next.index);
      renderDetail(entry, detail);
      detail.querySelector<HTMLButtonElement>(direction < 0 ? '[data-nav=previous]' : '[data-nav=next]')?.focus({ preventScroll: true });
    };
    const at = selected.get(entry.key) ?? representativeLocation(entry.locations);
    const previous = makeButton('上一处', () => navigate(-1), navigation); previous.dataset.nav = 'previous'; previous.disabled = at === 0;
    const position = doc.createElement('span'); position.textContent = `${at + 1} / ${entry.locations.length}`; position.setAttribute('aria-live', 'polite'); navigation.append(position);
    const next = makeButton('下一处', () => navigate(1), navigation); next.dataset.nav = 'next'; next.disabled = at === entry.locations.length - 1;
    const save = makeButton(saved.has(entry.key) ? '已收藏' : saving.has(entry.key) ? '收藏中…' : '收藏表达', () => {
      if (saving.has(entry.key) || saved.has(entry.key)) return;
      const version = generation;
      refreshGeneration++;
      saving.add(entry.key); issues.delete(entry.key); renderDetail(entry, detail);
      void options.save(location.expression.id, location.index).then(() => {
        if (version !== generation) return;
        refreshGeneration++;
        saved.add(entry.key);
      }).catch((error: unknown) => {
        if (version !== generation) return;
        issues.set(entry.key, error instanceof Error ? error.message : '收藏失败，请重试。');
      }).finally(() => {
        if (version !== generation) return;
        saving.delete(entry.key); renderDetail(entry, detail);
        rows.get(entry.key)!.badge.hidden = !saved.has(entry.key);
      });
    }, actions);
    save.disabled = saved.has(entry.key) || saving.has(entry.key); save.className = 'rfv2-expression-save';
    const secondary = doc.createElement('div'); secondary.className = 'rfv2-expression-secondary'; detail.append(secondary);
    makeButton('查看原文', () => options.locate(location.expression.id, location.index), secondary);
    makeButton('更多翻译', () => options.translate(location.expression.id, location.index), secondary);
    if (issues.has(entry.key)) { const issue = doc.createElement('p'); issue.setAttribute('role', 'status'); issue.textContent = issues.get(entry.key)!; detail.append(issue); }
  };
  const applyExpanded = () => {
    for (const entry of entries) {
      const row = rows.get(entry.key)!;
      const open = expanded === entry.key;
      row.button.setAttribute('aria-expanded', String(open)); row.detail.hidden = !open;
      if (open) renderDetail(entry, row.detail);
    }
  };
  const render = () => {
    rows.clear(); element.replaceChildren();
    entries.forEach((entry, index) => {
      const item = doc.createElement('article'); item.className = 'rfv2-expression'; item.dataset.expression = entry.key;
      const header = makeButton('', () => { expanded = expanded === entry.key ? null : entry.key; applyExpanded(); }, item);
      header.className = 'rfv2-expression-heading';
      const name = doc.createElement('strong'); name.textContent = entry.expression.text;
      const category = doc.createElement('small'); category.textContent = EXPRESSION_CATEGORY_LABELS[entry.expression.category];
      const line = doc.createElement('span'); line.className = 'rfv2-expression-title'; line.append(name, category);
      const badge = doc.createElement('span'); badge.className = 'rfv2-saved-badge'; badge.textContent = '已收藏'; badge.hidden = !saved.has(entry.key); line.append(badge);
      const meaning = doc.createElement('span'); meaning.className = 'rfv2-expression-meaning'; meaning.textContent = entry.expression.meaning;
      const count = doc.createElement('span'); count.className = 'rfv2-expression-count'; count.textContent = `${entry.locations.length} 处`;
      header.append(line, meaning, count);
      const detail = doc.createElement('div'); detail.className = 'rfv2-expression-detail'; detail.id = `rfv2-expression-detail-${index}`;
      header.setAttribute('aria-controls', detail.id); item.append(detail); rows.set(entry.key, { button: header, detail, badge }); element.append(item);
    });
    applyExpanded();
  };
  const refreshSaved = async () => {
    const version = generation, refresh = ++refreshGeneration;
    try {
      const result = await options.saved(entries.map(entry => entry.expression.text));
      if (version !== generation || refresh !== refreshGeneration) return;
      saved.clear(); result.forEach(name => saved.add(normalizeLearningExpressionName(name)));
      for (const entry of entries) { const row = rows.get(entry.key)!; row.badge.hidden = !saved.has(entry.key); if (expanded === entry.key) renderDetail(entry, row.detail); }
    } catch { /* Saving remains explicit and the backend still performs the atomic duplicate check. */ }
  };
  return {
    element,
    setExpressions(items: ReadingExpression[]) {
      generation++; refreshGeneration++; saving.clear(); saved.clear(); issues.clear();
      entries = learningEntries(items);
      if (!entries.some(entry => entry.key === expanded)) expanded = null;
      render();
    },
    open(id: string, occurrenceIndex: number) {
      const entry = entries.find(row => row.locations.some(location => location.expression.id === id && location.index === occurrenceIndex));
      if (!entry) return;
      expanded = entry.key; selected.set(entry.key, entry.locations.findIndex(location => location.expression.id === id && location.index === occurrenceIndex));
      applyExpanded();
      rows.get(entry.key)?.button.focus({ preventScroll: true });
      element.querySelector<HTMLElement>(`[aria-controls="${rows.get(entry.key)?.detail.id}"]`)?.scrollIntoView({ block: 'nearest' });
    },
    refreshSaved,
    get count() { return entries.length; },
    clear() { generation++; refreshGeneration++; entries = []; expanded = null; selected.clear(); saved.clear(); saving.clear(); issues.clear(); rows.clear(); element.replaceChildren(); },
  };
}
