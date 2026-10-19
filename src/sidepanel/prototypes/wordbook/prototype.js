// Disposable, in-memory prototype. No dictionary, AI, extension, or third-party integration.
const SOURCE_URL = 'https://browser-use.com/posts/browser-agents';
const SOURCE_TITLE = 'What Is a Browser Agent?';
const sentences = {
  definition: 'A browser agent is software that uses an AI model to operate a web browser toward a goal.',
  actions: 'You describe the task, and the agent automatically opens the page, navigates, chooses actions, and checks the results before continuing.',
  adaptation: 'Agents are especially useful for unpredictable workflows because they can adapt to unexpected changes and recover from errors.',
};
const dictionary = {
  unpredictable: { word: 'unpredictable', form: 'unpredictable', ipa: '/ˌʌnprɪˈdɪktəbəl/', pos: 'adj.', meaning: '难以预测的', extra: '不可预见的；无法事先确定的', sentence: sentences.adaptation, translation: '智能体尤其适合难以预测的工作流程，因为它们能够适应意外变化，并从错误中恢复。' },
  adapt: { word: 'adapt', form: 'adapt', ipa: '/əˈdæpt/', pos: 'v.', meaning: '适应；调整', extra: '改变自身，以适应新的情况', sentence: sentences.adaptation, translation: '智能体尤其适合难以预测的工作流程，因为它们能够适应意外变化，并从错误中恢复。' },
  navigate: { word: 'navigate', form: 'navigates', ipa: '/ˈnævɪɡeɪt/', pos: 'v.', meaning: '浏览；导航', extra: '在网页之间寻找并到达目标位置', sentence: sentences.actions, translation: '你描述任务后，智能体会自动打开页面、浏览、选择操作，并在继续之前检查结果。' },
  recover: { word: 'recover', form: 'recover', ipa: '/rɪˈkʌvər/', pos: 'v.', meaning: '恢复；重新正常运行', extra: '在出错或受阻之后恢复', sentence: sentences.adaptation, translation: '智能体尤其适合难以预测的工作流程，因为它们能够适应意外变化，并从错误中恢复。' },
  workflow: { word: 'workflow', form: 'workflows', ipa: '/ˈwɜːrkfloʊ/', pos: 'n.', meaning: '工作流程', extra: '完成一项工作所经过的步骤', sentence: sentences.adaptation, translation: '智能体尤其适合难以预测的工作流程，因为它们能够适应意外变化，并从错误中恢复。' },
  goal: { word: 'goal', form: 'goal', ipa: '/ɡoʊl/', pos: 'n.', meaning: '目标', extra: '希望达到的结果', sentence: sentences.definition, translation: '浏览器智能体是一种使用 AI 模型、操作网页浏览器来完成目标的软件。' },
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name) => `<i aria-hidden="true" class="icon" style="--icon:url('/icons/koboyo/${name}.svg')"></i>`;
const variantFromUrl = () => new URL(location.href).searchParams.get('variant') === 'B' ? 'B' : 'A';
const state = { saved: ['adapt', 'navigate', 'recover'], current: 'adapt', selected: null, translation: true, collection: true, variant: variantFromUrl(), query: '', speaking: null };
let anchorRect;
let toastTimer;
let speech;
let speechGeneration = 0;
let speechStartTimer;
let selectionOrigin;
let scrollBeforeRender = 0;

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2700);
}

function filteredWords() {
  const query = state.query.trim().toLowerCase();
  return state.saved.filter((id) => [dictionary[id].word, dictionary[id].meaning, dictionary[id].sentence].some((value) => value.toLowerCase().includes(query)));
}

function sentenceHtml(entry) {
  const escaped = escapeHtml(entry.sentence);
  const form = escapeHtml(entry.form);
  const position = escaped.toLowerCase().indexOf(form.toLowerCase());
  if (position < 0) return escaped;
  return escaped.slice(0, position) + '<mark>' + escaped.slice(position, position + form.length) + '</mark>' + escaped.slice(position + form.length);
}

function audioButton(id, sentence = false) {
  const entry = dictionary[id];
  const key = sentence ? `${id}:sentence` : id;
  const active = state.speaking === key;
  return `<button class="audio-button${active ? ' is-speaking' : ''}${sentence ? ' sentence-audio' : ''}" type="button" data-speak="${escapeHtml(id)}"${sentence ? ' data-sentence="true"' : ''} aria-label="${active ? '停止播放' : sentence ? '朗读原句' : `播放 ${escapeHtml(entry.word)} 的发音`}" title="${sentence ? '朗读原句' : '听发音'}" aria-pressed="${active}"><span class="play-glyph" aria-hidden="true">${active ? '■' : '▶'}</span>${sentence ? '<span>听原句</span>' : '<span class="speak-wave" aria-hidden="true"><span></span><span></span><span></span></span>'}</button>`;
}

function cardDetails(id, journal = false) {
  const entry = dictionary[id];
  return `${journal ? '' : `<div class="card-top"><span class="word-tag">WORD / 单词</span><span class="card-number">${String(state.saved.indexOf(id) + 1).padStart(2, '0')}</span></div><h3 class="card-word${entry.word.length > 11 ? ' is-long' : ''}" lang="en">${escapeHtml(entry.word)}</h3>`}
    <div class="pronunciation"><span class="ipa" lang="en">US ${escapeHtml(entry.ipa)}</span>${audioButton(id)}</div>
    <div class="word-definition"><span class="part-of-speech">${escapeHtml(entry.pos)}</span><span class="meaning">${escapeHtml(entry.meaning)}</span></div>
    <div class="context-label"><span>在这篇文章里</span>${audioButton(id, true)}</div>
    <blockquote class="card-sentence" lang="en">${sentenceHtml(entry)}</blockquote>
    <details class="example-translation"><summary>原句译文</summary><p class="card-translation">${escapeHtml(entry.translation)}</p></details>
    <a class="card-source" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${SOURCE_TITLE}</span><span aria-hidden="true">↗</span></a>
    <div class="card-bottom"><span class="saved-label"><span class="source-dot"></span> ${id === state.saved[0] && !['adapt', 'navigate', 'recover'].includes(id) ? '刚刚收藏' : '阅读收藏'}</span><button type="button" class="remove-word" data-remove="${escapeHtml(id)}" aria-label="移除 ${escapeHtml(entry.word)}">移除收藏</button></div>`;
}

function renderWords(animate = false) {
  const items = filteredWords();
  scrollBeforeRender = $('#wordbook').scrollTop;
  if (!items.includes(state.current)) state.current = items[0] ?? null;
  $('#tab-count').textContent = String(state.saved.length);
  $('#wordbook-count').textContent = String(state.saved.length).padStart(2, '0');
  $('#wordbook').dataset.savedWords = state.saved.join(',');
  $('#wordbook').dataset.currentWord = state.current ?? '';
  $('#layout-caption').textContent = state.variant === 'A' ? '卡片册' : '词语集';
  if (!items.length) {
    $('#wordbook-content').innerHTML = `<div class="empty-state">${icon('bookmark')}<h3>${state.query ? '还没有找到这个词' : '留住下一个遇见的词'}</h3><p>${state.query ? '换个词，或用中文释义搜索。' : '在左边文章里选一个词，点击「收藏到页脉」。'}</p>${!state.query ? '<button class="empty-demo-button" type="button" data-demo-select="unpredictable">试着收藏 unpredictable ↗</button>' : ''}</div>`;
    return;
  }
  const index = items.indexOf(state.current);
  $('#wordbook-content').innerHTML = `<div class="album-view"><div class="album-stage"><div class="card-back back-two" aria-hidden="true"></div><div class="card-back back-one" aria-hidden="true"></div><article class="word-card${animate ? ' is-arriving' : ''}" data-card-word="${state.current}" aria-label="${state.current} 单词卡">${cardDetails(state.current)}</article></div>
    <nav class="album-navigation" aria-label="翻看单词"><button class="icon-button" data-step="-1" type="button" aria-label="上一个单词"${items.length === 1 ? ' disabled' : ''}>‹</button><div class="page-count"><strong>${String(index + 1).padStart(2, '0')}</strong><span> / ${String(items.length).padStart(2, '0')}</span></div><button class="icon-button" data-step="1" type="button" aria-label="下一个单词"${items.length === 1 ? ' disabled' : ''}>›</button></nav>
    <div class="recent-words"><p class="section-label">收在这里的词 <span>${items.length}</span></p><div class="recent-chips">${items.map((id) => `<button type="button" data-open-word="${id}" class="${state.current === id ? 'is-current' : ''}" aria-pressed="${state.current === id}">${escapeHtml(dictionary[id].word)}</button>`).join('')}</div></div></div>
    <div class="journal-view">${items.map((id, order) => `<article class="journal-entry${id === state.current ? ' is-current' : ''}" style="--entry-index:${order}"><button class="journal-open" type="button" data-open-word="${id}" aria-expanded="${id === state.current}"><span class="journal-index">${String(order + 1).padStart(2, '0')}</span><span class="journal-word" lang="en">${escapeHtml(dictionary[id].word)}</span><span class="journal-meaning">${escapeHtml(dictionary[id].meaning)}</span><span class="journal-chevron" aria-hidden="true">${id === state.current ? '−' : '+'}</span></button>${id === state.current ? `<div class="journal-details">${cardDetails(id, true)}</div>` : `<p class="journal-preview" lang="en">${escapeHtml(dictionary[id].sentence)}</p>`}</article>`).join('')}</div>`;
  $('#wordbook').scrollTop = scrollBeforeRender;
}

function setPanel(panel) {
  document.body.dataset.panel = panel;
  $('#wordbook').hidden = panel !== 'words';
  $('#chat-view').hidden = panel !== 'chat';
  $('#words-tab').classList.toggle('active', panel === 'words');
  $('#chat-tab').classList.toggle('active', panel === 'chat');
  $('#words-tab').setAttribute('aria-current', panel === 'words' ? 'page' : 'false');
  $('#chat-tab').setAttribute('aria-current', panel === 'chat' ? 'page' : 'false');
  $('#collection-trigger').classList.toggle('is-active', panel === 'words');
  if (panel !== 'words') $('#search-box').hidden = true;
  else if (state.query) $('#search-box').hidden = false;
}

function setVariant(variant, updateUrl = true) {
  state.variant = variant;
  document.body.dataset.variant = variant;
  if (updateUrl) { const url = new URL(location.href); url.searchParams.set('variant', variant); history.replaceState(null, '', url); }
  $('#variant-label').innerHTML = variant === 'A' ? '<strong>01 卡片册</strong><span>一词一页，慢慢翻看</span>' : '<strong>02 词语集</strong><span>连同原句，铺开阅读</span>';
  renderWords(true);
}

function dismissSelection() {
  $('#selection-actions').hidden = true;
  $('#translation-popover').hidden = true;
  document.querySelectorAll('.demo-word.is-selected').forEach((el) => el.classList.remove('is-selected'));
  state.selected = null;
}

function updateSaveButton() {
  const saved = state.saved.includes(state.selected);
  const button = $('#save-selection');
  button.classList.toggle('is-saved', saved);
  button.innerHTML = `${icon(saved ? 'solid-checkmark' : 'bookmark')}<span>${saved ? '已收藏 · 查看' : '收藏到页脉'}</span>`;
}

function positionSelection() {
  if (!anchorRect || !state.selected) return;
  const paneRect = $('.reading-pane').getBoundingClientRect();
  const maxRight = Math.min(innerWidth - 12, paneRect.right - 12);
  const maxWidth = Math.min(390, maxRight - 12);
  const popup = $('#translation-popover');
  popup.style.width = `${maxWidth}px`;
  const left = Math.max(12, Math.min(anchorRect.left - 20, maxRight - maxWidth));
  const popupHeight = popup.offsetHeight || 250;
  const proposedTop = anchorRect.bottom + 14;
  const top = proposedTop + popupHeight > innerHeight - 70 ? Math.max(105, anchorRect.top - popupHeight - 55) : proposedTop;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  const actions = $('#selection-actions');
  actions.style.left = `${Math.max(12, Math.min(anchorRect.left, maxRight - 175))}px`;
  actions.style.top = `${Math.max(96, anchorRect.top - 45)}px`;
}

function showSelection(id, element) {
  if (!dictionary[id]) { notify('演示预置了带点线的 6 个单词，可以先试试它们。'); return; }
  if (!state.translation && !state.collection) { dismissSelection(); return; }
  dismissSelection();
  state.selected = id;
  selectionOrigin = element;
  anchorRect = element.getBoundingClientRect();
  if (element.classList.contains('demo-word')) element.classList.add('is-selected');
  updateSaveButton();
  $('#selection-actions').hidden = !state.collection;
  const entry = dictionary[id];
  $('#translation-popover').innerHTML = `<div class="translation-header"><span class="translation-brand"><b>译</b><span>沉浸式翻译 <small>· 模拟</small></span></span><button class="translation-close" type="button" data-close-selection aria-label="关闭翻译浮窗">${icon('cross')}</button></div><div class="translation-word" lang="en"><strong>${escapeHtml(entry.form)}</strong>${audioButton(id)}</div><div class="translation-ipa" lang="en">US ${escapeHtml(entry.ipa)}</div><div class="translation-definition"><small>${escapeHtml(entry.pos)}</small> ${escapeHtml(entry.meaning)}</div><p class="translation-example" lang="en">${sentenceHtml(entry)}</p><div class="translation-footnote">翻译效果示意，收藏由上方独立按钮完成</div>`;
  $('#translation-popover').hidden = !state.translation;
  positionSelection();
}

function demoSelection(id) {
  document.body.dataset.mobile = 'reading';
  $('#mobile-toggle').textContent = '查看收藏';
  const element = document.querySelector(`.demo-word[data-word="${id}"]`);
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });
  showSelection(id, element);
}

function syncSwitches() {
  $('#translation-switch').setAttribute('aria-checked', String(state.translation));
  $('#settings-translation-switch').setAttribute('aria-checked', String(state.translation));
  $('#collection-switch').setAttribute('aria-checked', String(state.collection));
  if (state.selected && selectionOrigin) showSelection(state.selected, selectionOrigin);
}

function flyWord(word, fromRect) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('keyboard-action') || innerWidth < 761) return;
  const target = $('#collection-trigger').getBoundingClientRect();
  const chip = document.createElement('span');
  chip.className = 'flight-word';
  chip.textContent = word;
  chip.style.left = `${fromRect.left}px`;
  chip.style.top = `${fromRect.top}px`;
  document.body.append(chip);
  const deltaX = target.left - fromRect.left;
  const deltaY = target.top - fromRect.top;
  const animation = chip.animate([{ opacity: 1, transform: 'translate(0,0) scale(1)' }, { opacity: .95, transform: `translate(${deltaX * .48}px,${Math.min(deltaY - 25, -60)}px) scale(.95)`, offset: .5 }, { opacity: 0, transform: `translate(${deltaX}px,${deltaY}px) scale(.65)` }], { duration: 520, easing: 'cubic-bezier(.22,.68,.2,1)' });
  animation.finished.finally(() => chip.remove());
}

function saveSelected() {
  const id = state.selected;
  if (!id) return;
  const alreadySaved = state.saved.includes(id);
  if (!alreadySaved) {
    state.saved.unshift(id);
    flyWord(dictionary[id].word, $('#save-selection').getBoundingClientRect());
  }
  stopSpeaking();
  state.query = '';
  $('#search-input').value = '';
  state.current = id;
  setPanel('words');
  renderWords(true);
  updateSaveButton();
  notify(alreadySaved ? '已经收在这里了' : `已收藏 ${dictionary[id].word}，原句也一起留下了`);
  $('#collection-badge').hidden = alreadySaved;
  $('#collection-badge').textContent = '+1';
  setTimeout(() => { $('#collection-badge').hidden = true; }, 2100);
  if (innerWidth < 761) { document.body.dataset.mobile = 'words'; $('#mobile-toggle').textContent = '查看文章'; dismissSelection(); }
}

function stepWord(step) {
  const items = filteredWords();
  if (!items.length) return;
  stopSpeaking();
  state.current = items[(items.indexOf(state.current) + step + items.length) % items.length];
  renderWords(true);
}

function syncAudioButtons() {
  document.querySelectorAll('[data-speak]').forEach((button) => {
    const key = button.dataset.speak + (button.dataset.sentence ? ':sentence' : '');
    const active = key === state.speaking;
    button.classList.toggle('is-speaking', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? '停止播放' : button.dataset.sentence ? '朗读原句' : `播放 ${dictionary[button.dataset.speak].word} 的发音`);
    button.querySelector('.play-glyph').textContent = active ? '■' : '▶';
  });
}

function stopSpeaking() {
  speechGeneration += 1;
  clearTimeout(speechStartTimer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  state.speaking = null;
  syncAudioButtons();
}

function speakWord(id, sentence = false) {
  const key = id + (sentence ? ':sentence' : '');
  if (state.speaking === key) { stopSpeaking(); return; }
  stopSpeaking();
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { notify('此浏览器未提供语音朗读，请在 Chrome 中体验。'); return; }
  const generation = speechGeneration;
  speech = new SpeechSynthesisUtterance(sentence ? dictionary[id].sentence : dictionary[id].word);
  speech.lang = 'en-US';
  speech.rate = sentence ? .88 : .82;
  const voices = speechSynthesis.getVoices();
  document.body.dataset.englishVoiceCount = String(voices.filter((item) => item.lang.startsWith('en')).length);
  const voice = voices.find((item) => item.lang === 'en-US' && item.localService) ?? voices.find((item) => item.lang.startsWith('en-US')) ?? voices.find((item) => item.lang.startsWith('en'));
  if (voice) speech.voice = voice;
  document.body.dataset.speechStatus = 'requested';
  speech.onstart = () => { if (generation !== speechGeneration) return; clearTimeout(speechStartTimer); document.body.dataset.speechStatus = 'started'; state.speaking = key; syncAudioButtons(); };
  speech.onend = () => { if (generation !== speechGeneration) return; clearTimeout(speechStartTimer); document.body.dataset.speechStatus = 'ended'; state.speaking = null; syncAudioButtons(); };
  speech.onerror = (event) => { if (generation !== speechGeneration) return; clearTimeout(speechStartTimer); document.body.dataset.speechStatus = event.error; state.speaking = null; syncAudioButtons(); if (!['canceled', 'interrupted'].includes(event.error)) notify('当前环境的英语语音不可用，请在 Chrome 中尝试。'); };
  speechSynthesis.speak(speech);
  speechSynthesis.resume();
  speechStartTimer = setTimeout(() => { if (generation === speechGeneration && document.body.dataset.speechStatus === 'requested') { stopSpeaking(); document.body.dataset.speechStatus = 'timeout'; notify('语音没有启动，请检查浏览器的英语语音后再试。'); } }, 5000);
}

document.addEventListener('pointerdown', (event) => {
  document.body.classList.remove('keyboard-action');
  if (!event.target.closest('.demo-word, .inline-demo, .selection-actions, .translation-popover, .toggle-group, .settings-popover')) dismissSelection();
  if (!event.target.closest('.settings-popover, #settings-trigger')) { $('#settings-popover').hidden = true; $('#settings-trigger').setAttribute('aria-expanded', 'false'); }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  const selection = target.closest('[data-word]');
  if (selection) { window.getSelection()?.removeAllRanges(); showSelection(selection.dataset.word, selection); return; }
  const demo = target.closest('[data-demo-select]');
  if (demo) { demoSelection(demo.dataset.demoSelect); return; }
  const audio = target.closest('[data-speak]');
  if (audio) { speakWord(audio.dataset.speak, Boolean(audio.dataset.sentence)); return; }
  const open = target.closest('[data-open-word]');
  if (open) { stopSpeaking(); state.current = open.dataset.openWord; renderWords(true); if (document.body.classList.contains('keyboard-action')) focusVisibleControl(`[data-open-word="${state.current}"]`); return; }
  const step = target.closest('[data-step]');
  if (step) { const value = step.dataset.step; stepWord(Number(value)); if (document.body.classList.contains('keyboard-action')) focusVisibleControl(`[data-step="${value}"]`); return; }
  const remove = target.closest('[data-remove]');
  if (remove) {
    const removed = remove.dataset.remove;
    const index = state.saved.indexOf(removed);
    state.saved = state.saved.filter((id) => id !== removed);
    stopSpeaking();
    renderWords(true);
    notify(`已移除 ${dictionary[removed].word}`);
    $('#toast').insertAdjacentHTML('beforeend', '<button type="button" id="undo-remove">撤销</button>');
    $('#undo-remove').addEventListener('click', () => { if (!state.saved.includes(removed)) state.saved.splice(index, 0, removed); state.current = removed; renderWords(true); notify('已恢复收藏'); });
    return;
  }
  if (target.closest('[data-close-selection]')) { dismissSelection(); selectionOrigin?.focus({ preventScroll: true }); }
});

$('#article-body').addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  const text = selection?.toString().trim().toLowerCase();
  if (!text || text.length > 48 || !selection.rangeCount) return;
  const id = Object.keys(dictionary).find((key) => key === text || dictionary[key].form === text);
  if (!id) { if (!event.target.closest('button')) notify('演示预置了带点线的 6 个单词，可以先试试它们。'); return; }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const element = document.querySelector(`.demo-word[data-word="${id}"]`);
  showSelection(id, element);
  anchorRect = rect;
  positionSelection();
});

$('#save-selection').addEventListener('click', saveSelected);
$('#translation-switch').addEventListener('click', () => { state.translation = !state.translation; syncSwitches(); });
$('#settings-translation-switch').addEventListener('click', () => { state.translation = !state.translation; syncSwitches(); });
$('#collection-switch').addEventListener('click', () => { state.collection = !state.collection; syncSwitches(); });
$('#settings-trigger').addEventListener('click', () => { const open = $('#settings-popover').hidden; $('#settings-popover').hidden = !open; $('#settings-trigger').setAttribute('aria-expanded', String(open)); });
$('#words-tab').addEventListener('click', () => setPanel('words'));
$('#collection-trigger').addEventListener('click', () => setPanel('words'));
$('#chat-collection-link').addEventListener('click', () => setPanel('words'));
$('#chat-tab').addEventListener('click', () => setPanel('chat'));
$('#search-trigger').addEventListener('click', () => { setPanel('words'); $('#search-box').hidden = !$('#search-box').hidden; if (!$('#search-box').hidden) $('#search-input').focus(); else { state.query = ''; $('#search-input').value = ''; renderWords(); } });
$('#search-input').addEventListener('input', (event) => { state.query = event.target.value; renderWords(); });
['#variant-prev', '#variant-next', '#variant-label'].forEach((selector) => $(selector).addEventListener('click', () => setVariant(state.variant === 'A' ? 'B' : 'A')));
$('#mobile-toggle').addEventListener('click', () => { const words = document.body.dataset.mobile !== 'words'; document.body.dataset.mobile = words ? 'words' : 'reading'; $('#mobile-toggle').textContent = words ? '查看文章' : '查看收藏'; dismissSelection(); });
$('#reset-demo').addEventListener('click', () => {
  stopSpeaking();
  dismissSelection();
  Object.assign(state, { saved: ['adapt', 'navigate', 'recover'], current: 'adapt', query: '', translation: true, collection: true });
  $('#search-input').value = '';
  $('#search-box').hidden = true;
  $('#settings-popover').hidden = true;
  $('#settings-trigger').setAttribute('aria-expanded', 'false');
  syncSwitches();
  setPanel('words');
  renderWords(true);
  notify('已恢复演示中的 3 个词');
});
document.addEventListener('keydown', (event) => {
  document.body.classList.add('keyboard-action');
  if (event.key === 'Escape') { dismissSelection(); $('#settings-popover').hidden = true; $('#settings-trigger').setAttribute('aria-expanded', 'false'); return; }
  if (event.target.closest('input, textarea, [contenteditable]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-trigger').click(); return; }
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  if (event.target.closest('.album-navigation, .word-card, .recent-words, .journal-view')) {
    const step = event.target.closest('[data-step]')?.dataset.step;
    stepWord(event.key === 'ArrowRight' ? 1 : -1);
    focusVisibleControl(step ? `[data-step="${step}"]` : `[data-open-word="${state.current}"]`);
  }
  else setVariant(state.variant === 'A' ? 'B' : 'A');
});
$('.reading-pane').addEventListener('scroll', dismissSelection, { passive: true });
window.addEventListener('resize', dismissSelection);
window.addEventListener('popstate', () => setVariant(variantFromUrl(), false));
window.addEventListener('pagehide', stopSpeaking);

function focusVisibleControl(selector) {
  const scope = state.variant === 'A' ? '.album-view' : '.journal-view';
  document.querySelector(`${scope} ${selector}`)?.focus({ preventScroll: true });
}

setVariant(state.variant, false);
syncSwitches();
