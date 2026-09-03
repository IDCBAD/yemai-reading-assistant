const VARIANTS = {
  A: { name: '内联生长', description: '认知从回答中自然长出来' },
  B: { name: '专注工作台', description: '用一次短暂的聚焦任务完成确认' },
  C: { name: '双层脉络', description: '同时看见当前材料和个人认知' },
};

const PHASES = ['发现候选', '确认理解', '写入认知', '旧知重遇', '比较观点', '处理完成'];
const DEFAULT_BOUNDARY = '当后端约束决定安全性、成本或核心可行性时，需要先验证后端。';

const model = {
  variant: normalizedVariant(new URLSearchParams(window.location.search).get('variant')),
  phase: 0,
  boundary: DEFAULT_BOUNDARY,
  revisionChoice: 'revise',
  candidateDismissed: false,
  revisitDeferred: false,
  workbenchClosed: false,
};

const root = document.querySelector('#prototype-root');
const variantLabel = document.querySelector('#variant-label');
const phaseLabel = document.querySelector('#phase-label');
const announcer = document.querySelector('#prototype-announcer');

function normalizedVariant(value) {
  return Object.hasOwn(VARIANTS, value) ? value : 'A';
}

function icon(name, size = 16) {
  return `<span class="proto-icon" style="--proto-icon:url('/icons/koboyo/${name}.svg');--proto-icon-size:${size}px" aria-hidden="true"></span>`;
}

function brandHeader(extra = '') {
  return `
    <header class="proto-topbar">
      <div class="proto-brand">
        <img src="/icon.svg" alt="" aria-hidden="true" />
        <div><strong>页脉</strong><span>${extra || '设计问题：认知如何真正成为我的？'}</span></div>
      </div>
      <span class="proto-icon-button proto-icon-button--decorative" aria-hidden="true">${icon('bookmark', 17)}</span>
    </header>
  `;
}

function pageIdentity(kind = 'original') {
  const revisit = kind === 'revisit';
  return `
    <section class="page-identity ${revisit ? 'is-revisit' : ''}">
      <span class="page-identity__icon">${icon('globe', 14)}</span>
      <div>
        <strong>${revisit ? '什么时候不应该前端先行？' : '为什么不确定产品应该先做原型？'}</strong>
        <span>${revisit ? 'martinfowler.com / architecture' : 'productnotes.cc / prototyping'}</span>
      </div>
      ${revisit ? '<span class="knowledge-signal" aria-label="发现相关认知">1</span>' : ''}
    </section>
  `;
}

function assistantAnswer(compact = false) {
  return `
    <article class="assistant-turn ${compact ? 'is-compact' : ''}">
      <div class="assistant-turn__mark"><img src="/icon.svg" alt="" /></div>
      <div class="assistant-turn__body">
        <p>先做前端原型的真正目的，不是节省开发时间，而是把模糊讨论变成可以被观察和反驳的具体体验。</p>
        ${compact ? '' : '<p>只有当后端约束决定产品是否可行、安全或负担得起时，才应该先验证后端。</p>'}
      </div>
    </article>
  `;
}

function userQuestion() {
  return `
    <div class="user-turn">
      <span>那“前端原型优先”是不是应该成为一条固定原则？</span>
    </div>
  `;
}

function candidateCore(layout = 'inline') {
  if (model.candidateDismissed) {
    return `
      <section class="quiet-receipt quiet-receipt--${layout}">
        <span>${icon('cross', 14)}</span>
        <div><strong>这次不会沉淀</strong><small>对话保持原样，没有内容写入认知目录。</small></div>
        <button class="text-action" type="button" data-action="undo-dismiss-candidate">撤销</button>
      </section>
    `;
  }
  return `
    <section class="cognition-candidate cognition-candidate--${layout}">
      <div class="candidate-kicker">${icon('selection', 13)}<span>可能形成了新的理解</span></div>
      <h2>原型优先，但不是无条件优先</h2>
      <p>你把一条固定开发顺序，修正成了带前提条件的判断原则。</p>
      <button class="primary-action" type="button" data-action="open-confirm">看看这个理解 ${icon('send', 13)}</button>
      <button class="text-action" type="button" data-action="dismiss-candidate">这次不沉淀</button>
    </section>
  `;
}

function confirmationCore(layout = 'inline') {
  return `
    <section class="confirmation confirmation--${layout}">
      <div class="confirmation__heading">
        <span>${icon('quote', 14)}</span>
        <div><small>补上适用边界</small><h2>什么情况下不能先做前端原型？</h2></div>
      </div>
      <label for="boundary-${layout}">用你的话回答</label>
      <textarea id="boundary-${layout}" data-boundary-input rows="4">${escapeHtml(model.boundary)}</textarea>
      <div class="confirmation__footer">
        <button class="secondary-action" type="button" data-action="back">返回</button>
        <button class="primary-action" type="button" data-action="save-cognition">形成认知 ${icon('solid-checkmark', 13)}</button>
      </div>
    </section>
  `;
}

function savedCore(layout = 'inline') {
  return `
    <section class="saved-cognition saved-cognition--${layout}">
      <div class="saved-cognition__mark">${icon('solid-checkmark', 17)}</div>
      <div class="saved-cognition__copy">
        <small>已写入 Yemai / 产品设计</small>
        <h2>原型优先，但不是无条件优先</h2>
        <p>${escapeHtml(model.boundary)}</p>
      </div>
      <button class="primary-action" type="button" data-action="open-revisit">看看它以后如何出现</button>
    </section>
  `;
}

function localRelation() {
  return `
    <div class="local-relation" aria-label="当前文章挑战了一条已有认知">
      <span class="local-relation__node is-source">当前文章</span>
      <span class="local-relation__verb">挑战</span>
      <span class="local-relation__node is-cognition">原型优先，但不是无条件优先</span>
    </div>
  `;
}

function relevanceReason() {
  return `
    <div class="relevance-reason">
      <span>${icon('link', 13)}</span>
      <p><strong>为什么相关</strong>：新文章讨论的正是你为“原型优先”留下的例外条件。</p>
    </div>
  `;
}

function revisitCore(layout = 'inline') {
  if (model.revisitDeferred) {
    return `
      <section class="quiet-receipt quiet-receipt--${layout}">
        <span>${icon('eye-off', 14)}</span>
        <div><strong>已保持安静</strong><small>旧认知和当前材料都没有被修改。</small></div>
        <button class="text-action" type="button" data-action="undo-defer-revisit">重新显示</button>
      </section>
    `;
  }
  return `
    <section class="revisit-card revisit-card--${layout}">
      <div class="revisit-card__heading">
        <span class="revisit-pulse" aria-hidden="true"></span>
        <div><small>一条旧认知被重新唤醒</small><h2>这篇文章可能挑战你以前的判断</h2></div>
      </div>
      ${relevanceReason()}
      ${layout === 'inline' ? localRelation() : ''}
      <blockquote>“当后端约束决定安全性、成本或核心可行性时，需要先验证后端。”</blockquote>
      <button class="primary-action" type="button" data-action="compare">比较新旧观点</button>
      <button class="text-action" type="button" data-action="defer-revisit">先不处理</button>
    </section>
  `;
}

function compareCore(layout = 'inline') {
  const choices = [
    ['revise', '修订适用边界', '新材料补充了一个更精确的判断条件'],
    ['keep', '保持原判断', '新材料仍在原有边界范围内'],
    ['later', '暂不判断', '证据还不足，留待以后验证'],
  ];
  return `
    <section class="comparison comparison--${layout}">
      ${layout === 'focus-a' ? '<button class="workbench-back" type="button" data-action="return-revisit">返回当前文章</button>' : ''}
      <header><small>新旧观点比较</small><h2>问题不在“先做哪一端”，而在先验证哪种风险</h2></header>
      <div class="comparison__sources">
        <article><small>你原来的理解</small><p>后端约束决定可行性时，先验证后端。</p></article>
        <article><small>新材料补充</small><p>还要判断哪种未知会最早让方案失效，而不只是区分前端或后端。</p></article>
      </div>
      <fieldset>
        <legend>这次如何处理？</legend>
        ${choices.map(([value, title, description]) => `
          <label class="decision-option ${model.revisionChoice === value ? 'is-selected' : ''}">
            <input type="radio" name="revision-choice" value="${value}" ${model.revisionChoice === value ? 'checked' : ''} />
            <span>${icon(model.revisionChoice === value ? 'solid-checkmark' : 'selection', 13)}</span>
            <span><strong>${title}</strong><small>${description}</small></span>
          </label>
        `).join('')}
      </fieldset>
      <button class="primary-action" type="button" data-action="apply-revision">${model.revisionChoice === 'revise' ? '应用修订' : model.revisionChoice === 'keep' ? '保留原认知' : '保存为待验证'}</button>
    </section>
  `;
}

function revisionOutcome() {
  return model.revisionChoice === 'keep'
    ? {
        icon: 'shield-check',
        label: '原认知保持不变',
        title: '原型优先，但不是无条件优先',
        summary: '新材料仍然落在原有适用边界内。它被记录为补充证据，没有改写你当前认可的判断。',
        current: '记录新材料，保持原有边界',
      }
    : model.revisionChoice === 'later'
      ? {
          icon: 'quote',
          label: '已经保存为待验证',
          title: '最先验证什么，仍需要更多证据',
          summary: '新材料可能改变旧理解，但目前证据不足。页脉保留这次冲突，等待未来资料继续验证。',
          current: '发现潜在冲突，暂不下结论',
        }
      : {
          icon: 'cycle',
          label: '认知已经演化',
          title: '先验证最可能让方案失效的未知',
          summary: '前端原型通常适合验证体验和需求；当安全、成本、性能或数据约束更早决定可行性时，应先验证相应的后端风险。',
          current: '改为优先验证最致命的未知',
        };
}

function evolvedCore(layout = 'inline') {
  const outcome = revisionOutcome();
  return `
    <section class="evolved evolved--${layout}">
      <header>
        <span>${icon(outcome.icon, 17)}</span>
        <div><small>${outcome.label}</small><h2>${outcome.title}</h2></div>
      </header>
      <p class="evolved__summary">${outcome.summary}</p>
      <ol class="evolution-line">
        <li><time>最初</time><span>把“前端先行”理解成固定顺序</span></li>
        <li><time>形成</time><span>增加后端可行性例外</span></li>
        <li class="is-current"><time>现在</time><span>${outcome.current}</span></li>
      </ol>
      <button class="secondary-action" type="button" data-action="${layout === 'focus-a' ? 'close-workbench' : 'reset'}">${layout === 'focus-a' ? '回到对话' : '重新体验'}</button>
    </section>
  `;
}

function revisitContextCore() {
  return `
    <section class="revisit-context">
      <small>当前文章的核心判断</small>
      <p>最先验证的应该是最可能让方案失效的约束，而不是机械地选择前端或后端。</p>
      ${localRelation()}
    </section>
  `;
}

function finalReceiptCore() {
  const outcome = revisionOutcome();
  return `
    <section class="final-receipt">
      <span class="final-receipt__mark">${icon(outcome.icon, 15)}</span>
      <div>
        <small>${outcome.label}</small>
        <strong>${outcome.title}</strong>
      </div>
      <button class="text-action" type="button" data-action="reopen-workbench">查看演化</button>
    </section>
  `;
}

function renderVariantA() {
  const inlineContent = model.phase === 0 ? candidateCore('inline')
    : model.phase === 1 ? confirmationCore('inline')
      : model.phase === 2 ? savedCore('inline')
        : model.phase === 3 ? revisitCore('inline')
          : `${revisitContextCore()}${model.phase === 5 && model.workbenchClosed ? finalReceiptCore() : ''}`;
  const revisit = model.phase >= 3;
  const workbenchOpen = model.phase === 4 || (model.phase === 5 && !model.workbenchClosed);
  const workspace = model.phase === 4 ? compareCore('focus-a') : evolvedCore('focus-a');
  return `
    <div class="sidepanel variant-a">
      ${brandHeader(revisit ? '当前网页唤醒了 1 条认知' : '对话中的认知自然生长')}
      ${pageIdentity(revisit ? 'revisit' : 'original')}
      <div class="conversation-scroll">
        ${revisit ? `<div class="context-shift"><span>后来，你打开了另一篇文章</span></div>` : `${userQuestion()}${assistantAnswer()}`}
        ${inlineContent}
      </div>
      <div class="composer-ghost"><span>${revisit ? '围绕新文章继续提问…' : '继续追问…'}</span><button type="button" aria-label="发送（原型中不可用）" disabled>${icon('send', 15)}</button></div>
      ${workbenchOpen ? `
        <div class="workbench-scrim" aria-hidden="true"></div>
        <section class="focus-workbench focus-workbench--a" role="dialog" aria-label="认知比较工作台">
          <div class="focus-workbench__handle" aria-hidden="true"></div>
          <div class="focus-workbench__progress"><span style="--progress:${(model.phase + 1) / PHASES.length}"></span><small>${PHASES[model.phase]}</small></div>
          ${workspace}
        </section>
      ` : ''}
    </div>
  `;
}

function renderVariantB() {
  const workspace = model.phase === 0 ? candidateCore('workbench')
    : model.phase === 1 ? confirmationCore('workbench')
      : model.phase === 2 ? savedCore('workbench')
        : model.phase === 3 ? revisitCore('workbench')
          : model.phase === 4 ? compareCore('workbench')
            : evolvedCore('workbench');
  const revisit = model.phase >= 3;
  return `
    <div class="sidepanel variant-b">
      ${brandHeader('认知工作台')}
      <div class="variant-b__conversation ${model.phase > 0 ? 'is-receded' : ''}">
        ${pageIdentity(revisit ? 'revisit' : 'original')}
        ${revisit ? `<div class="article-excerpt"><strong>架构不是顺序问题</strong><p>最先验证的应该是最可能让方案失效的约束，而不是机械地选择前端或后端。</p></div>` : `${userQuestion()}${assistantAnswer(true)}`}
      </div>
      <div class="focus-workbench">
        <div class="focus-workbench__handle" aria-hidden="true"></div>
        <div class="focus-workbench__progress"><span style="--progress:${(model.phase + 1) / PHASES.length}"></span><small>${PHASES[model.phase]}</small></div>
        ${workspace}
      </div>
    </div>
  `;
}

function renderVariantC() {
  const content = model.phase === 0 ? candidateCore('map')
    : model.phase === 1 ? confirmationCore('map')
      : model.phase === 2 ? savedCore('map')
        : model.phase === 3 ? revisitCore('map')
          : model.phase === 4 ? compareCore('map')
            : evolvedCore('map');
  const revisit = model.phase >= 3;
  return `
    <div class="sidepanel variant-c">
      ${brandHeader('当前材料与个人认知')}
      <div class="context-tabs" aria-label="并列查看当前材料和认知脉络">
        <span>当前材料</span>
        <span>认知脉络 <b>1</b></span>
      </div>
      <div class="layered-canvas">
        <aside class="material-layer">
          ${pageIdentity(revisit ? 'revisit' : 'original')}
          <div class="material-quote">${revisit ? '先验证最可能让方案失效的约束。' : '原型把模糊讨论变成可以观察和反驳的体验。'}</div>
          <span class="source-caption">网页资料</span>
        </aside>
        <div class="pulse-rail" aria-hidden="true"><span class="pulse-rail__node"></span><span class="pulse-rail__line"></span></div>
        <section class="cognition-layer">
          <div class="cognition-layer__label">${model.phase < 2 ? '正在形成' : model.phase < 5 ? '我的认知' : '已经演化'}</div>
          ${content}
        </section>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function render() {
  const renderer = model.variant === 'A' ? renderVariantA : model.variant === 'B' ? renderVariantB : renderVariantC;
  root.innerHTML = renderer();
  variantLabel.textContent = `${model.variant === 'A' ? 'A+' : model.variant} ${VARIANTS[model.variant].name}`;
  phaseLabel.textContent = `${model.phase + 1}/${PHASES.length} ${PHASES[model.phase]}`;
  document.title = `页脉认知循环 · ${model.variant === 'A' ? 'A+' : model.variant} ${VARIANTS[model.variant].name}`;
  root.querySelector('[data-boundary-input]')?.focus({ preventScroll: true });
}

function announce(message) {
  announcer.textContent = '';
  window.setTimeout(() => { announcer.textContent = message; }, 20);
}

function setPhase(phase) {
  model.phase = Math.max(0, Math.min(PHASES.length - 1, phase));
  if (model.phase < 5) model.workbenchClosed = false;
  render();
  announce(`进入${PHASES[model.phase]}`);
}

function resetPrototype() {
  model.phase = 0;
  model.boundary = DEFAULT_BOUNDARY;
  model.revisionChoice = 'revise';
  model.candidateDismissed = false;
  model.revisitDeferred = false;
  model.workbenchClosed = false;
  render();
  announce('原型已经重新开始');
}

function switchVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const offset = direction === 'next' ? 1 : -1;
  const currentIndex = keys.indexOf(model.variant);
  model.variant = keys[(currentIndex + offset + keys.length) % keys.length];
  const url = new URL(window.location.href);
  url.searchParams.set('variant', model.variant);
  window.history.replaceState({}, '', url);
  render();
  announce(`方案 ${model.variant}，${VARIANTS[model.variant].name}`);
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const switchDirection = target.dataset.switchVariant;
  if (switchDirection) {
    switchVariant(switchDirection);
    return;
  }
  if (target.matches('[data-reset-prototype]')) {
    resetPrototype();
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  if (action === 'open-confirm') setPhase(1);
  if (action === 'back') setPhase(0);
  if (action === 'save-cognition') {
    const input = document.querySelector('[data-boundary-input]');
    model.boundary = input?.value.trim() || model.boundary;
    setPhase(2);
  }
  if (action === 'open-revisit') setPhase(3);
  if (action === 'compare') setPhase(4);
  if (action === 'apply-revision') {
    model.workbenchClosed = false;
    setPhase(5);
  }
  if (action === 'return-revisit') setPhase(3);
  if (action === 'close-workbench') {
    model.workbenchClosed = true;
    render();
    announce('已回到对话，认知演化结果保留在当前上下文中');
  }
  if (action === 'reopen-workbench') {
    model.workbenchClosed = false;
    render();
    announce('重新打开认知演化过程');
  }
  if (action === 'reset') resetPrototype();
  if (action === 'dismiss-candidate') {
    model.candidateDismissed = true;
    render();
    announce('已忽略，这条内容不会进入认知目录');
  }
  if (action === 'undo-dismiss-candidate') {
    model.candidateDismissed = false;
    render();
  }
  if (action === 'defer-revisit') {
    model.revisitDeferred = true;
    render();
    announce('已保持安静，本次不处理旧认知');
  }
  if (action === 'undo-defer-revisit') {
    model.revisitDeferred = false;
    render();
  }
});

document.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'revision-choice') return;
  model.revisionChoice = event.target.value;
  render();
});

window.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active?.isContentEditable;
  if (editing) return;
  if (event.key === 'ArrowLeft') switchVariant('previous');
  if (event.key === 'ArrowRight') switchVariant('next');
});

render();
