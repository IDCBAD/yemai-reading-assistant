const variants = [
  {
    key: 'E',
    slug: 'variant-e',
    name: '焦点阅读层',
    title: '收藏',
    description: '',
    spacing: 96,
  },
  {
    key: 'D',
    slug: 'variant-d',
    name: '紧凑河道',
    title: '收藏',
    description: '',
    spacing: 96,
  },
  {
    key: 'A',
    slug: 'variant-a',
    name: '缓弯河道',
    title: '让收藏重新流经眼前',
    description: '低振幅曲线保留阅读宽度；滚轮推动整条河流，悬停只抽出一张卡片。',
    spacing: 112,
  },
  {
    key: 'B',
    slug: 'variant-b',
    name: '双岸潮汐',
    title: '在两岸之间重遇线索',
    description: '卡片交替停靠在河道两侧，中心留作时间轴与抽卡阅读区。',
    spacing: 118,
  },
  {
    key: 'C',
    slug: 'variant-c',
    name: '纵深牌组',
    title: '像翻阅一叠正在呼吸的卡片',
    description: '压缩纵向间距，用层级和景深容纳更高密度的收藏。',
    spacing: 82,
  },
];

const MOUSE_DRAG_ACTIVATION_DISTANCE = 6;
const TOUCH_DRAG_ACTIVATION_DISTANCE = 8;

const cards = [
  {
    id: 'card-01',
    kind: '回答片段',
    title: '前缀不变，是 KV Cache 能复用的根基',
    excerpt: '模型只能往后看，恰好保证已计算过的前缀不会因为未来 token 而改变。',
    body: '模型“只能往后看”不是能力缺陷，而是下一词预测的结构性约束。因为前缀在后续生成中保持不变，前缀对应的 Key 与 Value 才能够被安全缓存；这既是模型的“枷锁”，也是工程上的“金矿”。',
    source: '上下文工程 · AI Agents in Depth',
    site: '当前会话',
    date: '今天 19:46',
    group: '今天',
    color: '#5579a8',
    soft: '#eaf0f8',
  },
  {
    id: 'card-02',
    kind: '完整回答',
    title: 'Agent.md 应保存身份与准则，而不是动态知识',
    excerpt: '默认少放：会变化的知识、链接和任务状态，应当活在知识库、工具或对话里。',
    body: `Agent.md 装的是“身份与准则”——至于知识、链接、状态这些会变化的东西，让它们活在知识库、工具和对话里。每次想往 Agent.md 加东西，先问：这是我这个人该背下来的，还是这件事该带着的？

为什么要做这个区分

身份和准则需要在大量任务中保持稳定，例如你的写作习惯、风险边界、做决定时坚持的原则。它们出现频率高、变化速度慢，适合成为 Agent 每次工作时都携带的基础约束。

动态知识则不同。某个项目的状态、临时判断、网页材料和正在验证的假设，都可能随着时间发生变化。如果把这些内容不断写进 Agent.md，文件会越来越长，旧信息也会在不恰当的任务中持续干扰模型。

一个更稳健的分层方式

第一层保存身份：我是谁，我希望工具怎样与我协作。第二层保存长期准则：哪些判断可以跨任务复用。第三层是可检索的知识和资料，它们只在当前问题真正需要时进入上下文。最后一层是当前会话状态，任务结束后可以归档或丢弃。

所以，Agent.md 的目标并不是变成无所不包的个人百科，而是成为一个足够小、足够稳定、能够反复加载的行为边界。真正会增长的内容应该进入知识库，并且保留来源、更新时间和重新验证的入口。`,
    source: '上下文工程 · AI Agents in Depth',
    site: '当前会话',
    date: '今天 18:22',
    group: '今天',
    color: '#6d6595',
    soft: '#eeebf6',
  },
  {
    id: 'card-03',
    kind: '回答片段',
    title: '约束前置，比功能堆叠更能控制长期成本',
    excerpt: '功能做出来之前，先识别权限边界、数据模型与持续化方案。',
    body: '架构约束前置并不是为了拖慢开发，而是为了避免功能增量把长期成本藏起来。权限边界、数据模型、持久化和外部依赖决定的是系统骨架；功能可以在骨架内少量增量实现。',
    source: 'Chrome 插件开发指南',
    site: '影刀 AI WorkOS',
    date: '今天 16:08',
    group: '今天',
    color: '#4f7c69',
    soft: '#e8f1ec',
  },
  {
    id: 'card-04',
    kind: '完整回答',
    title: '为什么上下文设计决定了 Agent 的上限',
    excerpt: '更长的上下文不等于更好的上下文，边界和来源身份同样重要。',
    body: '上下文工程不是把更多内容塞给模型，而是在有限注意力内保留正确的身份、来源和任务边界。一个可追溯、可裁剪的上下文模型，往往比单纯增加窗口长度更能稳定提升 Agent 的表现。',
    source: 'AI Agents in Depth',
    site: '网页阅读',
    date: '昨天 22:11',
    group: '昨天',
    color: '#9b7445',
    soft: '#f5eee3',
  },
  {
    id: 'card-05',
    kind: '回答片段',
    title: '收藏不等于认同，更不等于已经掌握',
    excerpt: '先用低成本动作捕获，再由用户主动加工成可以复用的判断。',
    body: '收藏只说明“这个内容值得留下”，它可以是别人的观点，也可以是一段尚未验证的推理。只有经过用户主动加工、补充边界并确认后，它才可能成为能够再次参与判断的个人认知。',
    source: '页脉产品方向讨论',
    site: '当前会话',
    date: '昨天 20:34',
    group: '昨天',
    color: '#5579a8',
    soft: '#eaf0f8',
  },
  {
    id: 'card-06',
    kind: '完整回答',
    title: '深模块的价值来自隐藏复杂度，而不是代码少',
    excerpt: '好的接口提供少量高杠杆能力，并把大量策略留在边界内部。',
    body: '模块是否“深”，不取决于文件行数，而取决于接口暴露的复杂度和内部吸收的复杂度之比。接口越小、可提供的能力越完整，调用方越不需要知道内部策略，模块就越深。',
    source: '软件设计：深模块',
    site: '网页阅读',
    date: '昨天 14:02',
    group: '昨天',
    color: '#4f7c69',
    soft: '#e8f1ec',
  },
  {
    id: 'card-07',
    kind: '回答片段',
    title: '视觉不是装饰，它决定用户是否愿意建立习惯',
    excerpt: '当基础功能都足够好时，体验的整体质感会成为真正的差异。',
    body: '对高频个人工具而言，视觉并不是完成核心功能后才添加的包装。它影响用户是否愿意打开、是否相信工具里的内容值得维护，以及是否能够把一次偶然使用变成长期习惯。',
    source: '产品方向梳理',
    site: '当前会话',
    date: '8 月 30 日',
    group: '本周',
    color: '#9b7445',
    soft: '#f5eee3',
  },
  {
    id: 'card-08',
    kind: '完整回答',
    title: '本地优先并不意味着把数据库文件直接暴露给用户',
    excerpt: '可迁移资产、运行时索引和临时状态需要分层保存。',
    body: '本地优先的重点是资产所有权和可迁移性，而不是要求所有运行时状态都采用用户可读格式。认知可以使用普通 Markdown；搜索索引、界面状态和事务数据仍然适合保存在内部数据库。',
    source: '本地知识架构',
    site: '页脉设计',
    date: '8 月 29 日',
    group: '本周',
    color: '#6d6595',
    soft: '#eeebf6',
  },
  {
    id: 'card-09',
    kind: '回答片段',
    title: '减少上下文，不等于损失信息',
    excerpt: '如果来源身份和检索入口仍在，未注入的内容依然可以按需回来。',
    body: '上下文裁剪不是永久删除信息，而是把“每次都携带”改成“需要时检索”。只要来源身份、稳定引用和恢复入口仍然存在，更小的上下文反而能让重要信息获得更多注意力。',
    source: '上下文窗口设计',
    site: '网页阅读',
    date: '8 月 28 日',
    group: '本周',
    color: '#5579a8',
    soft: '#eaf0f8',
  },
  {
    id: 'card-10',
    kind: '完整回答',
    title: '先验证重遇价值，再设计自动关联',
    excerpt: '没有真实收藏行为，任何主题聚类和知识图谱都只是想象出来的结构。',
    body: '自动聚类只有在用户确实积累了一批收藏并频繁重新访问时才有价值。当前更重要的是验证：用户会不会收藏、会不会回来、什么内容值得被再次看见。数据出现以后，再决定主题和关联应当如何形成。',
    source: '收藏优先产品方向',
    site: '页脉设计',
    date: '8 月 27 日',
    group: '本周',
    color: '#4f7c69',
    soft: '#e8f1ec',
  },
  {
    id: 'card-11',
    kind: '回答片段',
    title: '可观测性是 Agent 产品体验的一部分',
    excerpt: '用户不需要看见每一步推理，但必须知道系统已经接收、正在处理还是等待输入。',
    body: 'Agent 的内部过程可以保持抽象，但它的外部状态不能保持沉默。接收请求、读取上下文、等待工具、生成回答和需要用户确认，都应该给出层级恰当的反馈。',
    source: 'Agent 运行状态优化',
    site: '当前会话',
    date: '8 月 25 日',
    group: '更早',
    color: '#9b7445',
    soft: '#f5eee3',
  },
  {
    id: 'card-12',
    kind: '完整回答',
    title: '输入响应优先级应高于非关键界面更新',
    excerpt: '长文本编辑卡顿通常来自每次输入触发了不必要的全树渲染或同步存储。',
    body: '输入框是用户和产品之间最直接的控制面。任何昂贵计算、持久化或跨组件同步都不应阻塞按键反馈；先更新本地输入状态，再把其他工作延后、分片或隔离。',
    source: '输入框性能诊断',
    site: '页脉优化',
    date: '8 月 24 日',
    group: '更早',
    color: '#6d6595',
    soft: '#eeebf6',
  },
];

const root = document.querySelector('#prototype-root');
const announcer = document.querySelector('#prototype-announcer');
const variantLabel = document.querySelector('#variant-label');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let activeVariant = getVariant();
let frameId = 0;
let toastTimer = 0;
let closePreviewTimer = 0;

function getVariant() {
  const key = new URLSearchParams(window.location.search).get('variant')?.toUpperCase() ?? 'E';
  return variants.find((variant) => variant.key === key) ?? variants.find((variant) => variant.key === 'E');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cardMarkup(card) {
  return `
    <article
      class="river-card"
      role="listitem"
      data-card-id="${card.id}"
      style="--card-color:${card.color}; --card-soft:${card.soft}"
    >
      <span class="river-card__accent" aria-hidden="true"></span>
      <button class="river-card__button" type="button" aria-label="预览收藏：${escapeHtml(card.title)}">
        <span class="river-card__topline">
          <span class="river-card__kind">${card.kind}</span>
          <span class="river-card__source">${escapeHtml(card.source)}</span>
        </span>
        <strong>${escapeHtml(card.title)}</strong>
        <span class="river-card__excerpt">${escapeHtml(card.excerpt)}</span>
        <span class="river-card__meta">
          <span>${escapeHtml(card.site)}</span>
          <time>${escapeHtml(card.date)}</time>
        </span>
      </button>
    </article>
  `;
}

function appMarkup(variant) {
  const compactHeader = variant.key === 'D' || variant.key === 'E';
  return `
    <section class="prototype-frame ${variant.slug}" aria-label="收藏河流交互原型">
      <header class="prototype-topbar">
        <div class="brand">
          <img src="/icon.svg" alt="" />
          <strong>页脉</strong>
          <small>收藏河流 · 交互原型</small>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" type="button" data-prototype-action="search" aria-label="搜索">⌕</button>
          <button class="icon-button" type="button" data-prototype-action="settings" aria-label="设置">⚙</button>
        </div>
      </header>

      <section class="river-shell">
        <header class="river-intro${compactHeader ? ' river-intro--compact' : ''}">
          ${compactHeader ? `
            <div class="compact-heading">
              <h1>${variant.title}</h1>
              <span>${cards.length}</span>
            </div>
          ` : `
            <div>
              <p class="eyebrow">Collection river · ${variant.key}</p>
              <h1>${variant.title}</h1>
              <p>${variant.description}</p>
            </div>
            <div class="view-toggle" aria-label="收藏视图">
              <button type="button" aria-pressed="true">河流</button>
              <button type="button" aria-pressed="false" data-prototype-action="list-view">列表</button>
            </div>
          `}
        </header>

        <div class="river-viewport" tabindex="0" aria-label="收藏卡片河流，可使用滚轮或上下方向键浏览">
          <svg class="river-path" aria-hidden="true" preserveAspectRatio="none">
            <defs>
              <linearGradient id="river-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#cbd8d1" stop-opacity="0" />
                <stop offset="0.22" stop-color="#a9bbb1" stop-opacity="0.8" />
                <stop offset="0.78" stop-color="#a9bbb1" stop-opacity="0.8" />
                <stop offset="1" stop-color="#cbd8d1" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path></path>
          </svg>

          <div class="river-date-marker"><span>当前位置</span><strong data-current-group>今天</strong></div>
          <div class="river-progress" aria-hidden="true"><span></span></div>
          <div class="river-cards" role="list">${cards.map(cardMarkup).join('')}</div>

          <button class="detail-scrim" type="button" tabindex="-1" aria-label="关闭固定详情"></button>
          <article class="focus-preview" aria-hidden="true" inert>
            <header class="focus-preview__header">
              <div class="focus-preview__heading">
                <small></small>
                <h2></h2>
              </div>
              <button class="preview-pin" type="button" aria-label="固定卡片预览" title="固定卡片">◇</button>
            </header>
            <div class="focus-preview__body">
              <p></p>
              <div class="focus-preview__context"><i></i><span></span></div>
            </div>
            <footer class="focus-preview__footer">
              <button class="preview-action" type="button" data-preview-action="source">回到原对话</button>
              <button class="preview-action" type="button" data-preview-action="export">导出 Markdown</button>
              <button class="preview-action" type="button" data-preview-action="remove">取消收藏</button>
            </footer>
            <span class="focus-preview__pin-help">点击卡片可固定，Esc 返回河流</span>
          </article>

          <div class="edge-resistance edge-resistance--top">已经是最近的收藏</div>
          <div class="edge-resistance edge-resistance--bottom">已经到达河流末端</div>
          <div class="river-hint"><kbd>滚轮</kbd><span>控制速度 · 靠近卡片预览</span></div>
          <div class="river-status" data-state="静止"><i></i><span>静止</span></div>
        </div>
        <div class="prototype-toast" role="status"></div>
      </section>
    </section>
  `;
}

function setupPrototype() {
  window.cancelAnimationFrame(frameId);
  window.clearTimeout(closePreviewTimer);
  activeVariant = getVariant();
  document.body.dataset.variant = activeVariant.key;
  root.innerHTML = appMarkup(activeVariant);
  variantLabel.textContent = `${activeVariant.key} · ${activeVariant.name}`;
  document.title = `页脉 · ${activeVariant.name}收藏河流原型`;

  const frame = root.querySelector('.prototype-frame');
  const viewport = root.querySelector('.river-viewport');
  const path = root.querySelector('.river-path path');
  const progressBar = root.querySelector('.river-progress > span');
  const groupLabel = root.querySelector('[data-current-group]');
  const status = root.querySelector('.river-status');
  const preview = root.querySelector('.focus-preview');
  const scrim = root.querySelector('.detail-scrim');
  const topEdge = root.querySelector('.edge-resistance--top');
  const bottomEdge = root.querySelector('.edge-resistance--bottom');
  const cardNodes = new Map(
    [...root.querySelectorAll('.river-card')].map((node) => [node.dataset.cardId, node]),
  );
  const positions = new Map();
  const avoidance = new Map(cards.map((card) => [card.id, { value: 0, velocity: 0 }]));

  const state = {
    position: 1.35,
    velocity: 0,
    hoveredId: null,
    pinnedId: null,
    dragging: false,
    dragMoved: false,
    pressedCardId: null,
    pointerOpenedCardId: null,
    pointerOverPreview: false,
    lastPointerY: 0,
    lastPointerTime: 0,
    lastWheelAt: 0,
    lastFrameAt: performance.now(),
  };

  function currentCard() {
    return cards.find((card) => card.id === (state.pinnedId ?? state.hoveredId));
  }

  function setStatus() {
    let label = '静止';
    if (state.pinnedId) label = '已固定';
    else if (state.hoveredId) label = '预览中';
    else if (state.dragging) label = '拖动中';
    else if (Math.abs(state.velocity) > 0.018) label = '滚动中';
    status.dataset.state = label;
    status.querySelector('span').textContent = label;
  }

  function variantPosition(index, width, height) {
    const relative = index - state.position;
    const y = height / 2 + relative * activeVariant.spacing;
    const normalized = (y - height / 2) / Math.max(height / 2, 1);
    let x = width / 2;
    let rotate = 0;
    let scale = 1;
    let opacity = 1;

    if (activeVariant.key === 'A' || activeVariant.key === 'D' || activeVariant.key === 'E') {
      const amplitude = clamp(width * 0.135, 28, 74);
      const phase = (y / Math.max(height, 1)) * Math.PI * 1.62 - 0.82;
      x += Math.sin(phase) * amplitude;
      rotate = Math.cos(phase) * -2.5;
      scale = 1 - Math.min(Math.abs(normalized) * 0.085, 0.12);
      opacity = 1 - Math.min(Math.abs(normalized) * 0.34, 0.68);
    } else if (activeVariant.key === 'B') {
      const bank = index % 2 === 0 ? -1 : 1;
      const bankDistance = clamp(width * 0.19, 45, 124);
      x += bank * bankDistance + Math.sin(y / 150) * 8;
      rotate = bank * 1.7;
      scale = 1 - Math.min(Math.abs(normalized) * 0.07, 0.1);
      opacity = 1 - Math.min(Math.abs(normalized) * 0.31, 0.64);
    } else {
      x += Math.sin(relative * 0.66) * clamp(width * 0.045, 12, 31);
      rotate = Math.sin(relative * 0.48) * 1.35;
      scale = 1 - Math.min(Math.abs(normalized) * 0.16, 0.25);
      opacity = 1 - Math.min(Math.abs(normalized) * 0.38, 0.73);
    }

    return { x, y, normalized, rotate, scale, opacity, relative };
  }

  function updatePath(width, height) {
    const points = [];
    for (let step = 0; step <= 20; step += 1) {
      const y = (height / 20) * step;
      let x = width / 2;
      if (activeVariant.key === 'A' || activeVariant.key === 'D' || activeVariant.key === 'E') {
        x += Math.sin((y / Math.max(height, 1)) * Math.PI * 1.62 - 0.82) * clamp(width * 0.135, 28, 74);
      } else if (activeVariant.key === 'B') {
        x += Math.sin(y / 150) * 8;
      } else {
        x += Math.sin((y / Math.max(height, 1)) * Math.PI * 2.1) * clamp(width * 0.026, 7, 18);
      }
      points.push(`${step === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    path.setAttribute('d', points.join(' '));
  }

  function closePreview(force = false) {
    if (state.pinnedId && !force) return;
    state.hoveredId = null;
    if (force) state.pinnedId = null;
    preview.classList.remove('is-visible', 'is-pinned', 'is-reading-layer');
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    viewport.classList.remove('has-pinned-card');
    preview.querySelector('.preview-pin').textContent = '◇';
    layoutCards(1);
    setStatus();
  }

  function schedulePreviewClose() {
    window.clearTimeout(closePreviewTimer);
    closePreviewTimer = window.setTimeout(() => {
      if (!state.pointerOverPreview && !state.pinnedId) closePreview();
    }, 85);
  }

  function showPreview(cardId, mode = 'hover') {
    if ((Math.abs(state.velocity) > 0.045 || state.dragging) && mode === 'hover') return;
    const card = cards.find((item) => item.id === cardId);
    if (!card || (state.pinnedId && state.pinnedId !== cardId)) return;

    window.clearTimeout(closePreviewTimer);
    state.hoveredId = cardId;
    if (activeVariant.key === 'E' && mode !== 'pin') {
      preview.classList.remove('is-visible', 'is-pinned', 'is-reading-layer');
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      setStatus();
      return;
    }
    if (mode === 'pin') state.pinnedId = cardId;

    preview.style.setProperty('--preview-color', card.color);
    const cardPosition = cards.findIndex((item) => item.id === card.id) + 1;
    preview.querySelector('.focus-preview__heading small').textContent = activeVariant.key === 'E'
      ? `${card.kind} · ${cardPosition} / ${cards.length} · 收藏于 ${card.date}`
      : `${card.kind} · 收藏于 ${card.date}`;
    preview.querySelector('.focus-preview__heading h2').textContent = card.title;
    preview.querySelector('.focus-preview__body p').textContent = card.body;
    preview.querySelector('.focus-preview__context span').textContent = `${card.source} · ${card.site}`;
    preview.classList.toggle('is-pinned', Boolean(state.pinnedId));
    preview.classList.toggle('is-reading-layer', activeVariant.key === 'E' && Boolean(state.pinnedId));
    preview.classList.add('is-visible');
    preview.setAttribute('aria-hidden', 'false');
    preview.inert = false;
    viewport.classList.toggle('has-pinned-card', Boolean(state.pinnedId));
    preview.querySelector('.preview-pin').textContent = activeVariant.key === 'E' && state.pinnedId ? '←' : state.pinnedId ? '◆' : '◇';
    preview.querySelector('.preview-pin').setAttribute('aria-label', activeVariant.key === 'E' && state.pinnedId
      ? '返回收藏河流'
      : state.pinnedId ? '取消固定卡片预览' : '固定卡片预览');
    layoutCards(1);
    announcer.textContent = `${state.pinnedId ? '已固定' : '正在预览'}：${card.title}`;
    setStatus();
  }

  function pinCurrentCard() {
    const card = currentCard();
    if (!card) return;
    if (state.pinnedId === card.id) {
      if (activeVariant.key === 'E') {
        closePreview(true);
        return;
      }
      state.pinnedId = null;
      preview.classList.remove('is-pinned');
      viewport.classList.remove('has-pinned-card');
      preview.querySelector('.preview-pin').textContent = '◇';
      setStatus();
      return;
    }
    showPreview(card.id, 'pin');
  }

  function showToast(message) {
    const toast = root.querySelector('.prototype-toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1_600);
  }

  function layoutCards(deltaFactor) {
    const bounds = viewport.getBoundingClientRect();
    const width = bounds.width;
    const height = bounds.height;
    const focusedCard = currentCard();
    const focusedIndex = focusedCard ? cards.findIndex((card) => card.id === focusedCard.id) : -1;
    const hoverLiftOnly = activeVariant.key === 'E' && Boolean(state.hoveredId) && !state.pinnedId;
    const readingLayerOpen = activeVariant.key === 'E' && Boolean(state.pinnedId);
    const firstNode = cardNodes.values().next().value;
    const cardWidth = firstNode?.offsetWidth ?? 292;
    const cardHeight = firstNode?.offsetHeight ?? 94;

    updatePath(width, height);
    positions.clear();

    cards.forEach((card, index) => {
      const node = cardNodes.get(card.id);
      const base = variantPosition(index, width, height);
      const motion = avoidance.get(card.id);
      let targetAvoidance = 0;

      if (focusedIndex >= 0 && index !== focusedIndex) {
        const difference = index - focusedIndex;
        const strength = Math.exp(-(difference * difference) / (2 * 1.12 * 1.12));
        const avoidanceDistance = activeVariant.key === 'C' ? 54 : hoverLiftOnly ? 25 : 43;
        targetAvoidance = readingLayerOpen ? 0 : Math.sign(difference) * strength * avoidanceDistance;
      }

      if (prefersReducedMotion) {
        motion.value = targetAvoidance;
        motion.velocity = 0;
      } else {
        const acceleration = (targetAvoidance - motion.value) * 0.14 * deltaFactor;
        motion.velocity = (motion.velocity + acceleration) * Math.pow(0.7, deltaFactor);
        motion.value += motion.velocity * deltaFactor;
      }

      let y = base.y + motion.value;
      let x = base.x;
      if (focusedIndex === index) x += (width / 2 - x) * 0.36;

      let displayRotate = base.rotate;
      let displayScale = base.scale;
      let displayOpacity = base.opacity;

      if (readingLayerOpen) {
        x = width >= 600 ? 56 : 34;
        y = height / 2 + (index - state.position) * 55;
        displayRotate = 0;
        displayScale = 0.34;
        displayOpacity = focusedIndex === index ? 0.08 : 0.27;
      } else if (hoverLiftOnly && focusedIndex === index) {
        y -= 2;
        displayRotate *= 0.18;
        displayScale *= 1.035;
        displayOpacity = Math.max(displayOpacity, 0.96);
      }

      const outside = y < -cardHeight * 1.5 || y > height + cardHeight * 1.5;
      const focusSource = focusedIndex === index && !hoverLiftOnly;
      const opacity = outside ? 0 : readingLayerOpen ? displayOpacity : focusSource ? base.opacity * 0.13 : displayOpacity;
      const scale = focusSource && !readingLayerOpen ? displayScale * 0.985 : displayScale;
      const zIndex = focusedIndex === index ? 19 : Math.max(2, 15 - Math.round(Math.abs(base.relative)));

      node.style.opacity = opacity.toFixed(3);
      node.style.pointerEvents = outside || Math.abs(state.velocity) > 0.08 ? 'none' : 'auto';
      node.style.zIndex = String(zIndex);
      node.style.transform = `translate3d(${(x - cardWidth / 2).toFixed(2)}px, ${(y - cardHeight / 2).toFixed(2)}px, 0) rotate(${displayRotate.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      node.classList.toggle('is-focus-source', focusSource);
      positions.set(card.id, { x, y });
    });

    const progress = clamp(state.position / (cards.length - 1), 0, 1);
    progressBar.style.transform = `scaleY(${Math.max(0.1, progress).toFixed(3)})`;
    const nearestCard = cards[clamp(Math.round(state.position), 0, cards.length - 1)];
    groupLabel.textContent = nearestCard.group;

    const previewCard = currentCard();
    if (previewCard && preview.classList.contains('is-visible')) {
      const origin = positions.get(previewCard.id);
      const previewWidth = preview.offsetWidth || 372;
      const previewHeight = preview.offsetHeight || 260;
      if (readingLayerOpen) {
        const preferredX = width >= 680 ? width * 0.62 : width / 2;
        const finalX = clamp(preferredX, previewWidth / 2 + 14, width - previewWidth / 2 - 14);
        const finalY = height / 2;
        preview.style.left = `${finalX}px`;
        preview.style.top = `${finalY}px`;
        if (origin) {
          const originX = clamp(previewWidth / 2 + origin.x - finalX, 0, previewWidth);
          const originY = clamp(previewHeight / 2 + origin.y - finalY, 0, previewHeight);
          preview.style.transformOrigin = `${originX}px ${originY}px`;
        }
      } else {
        const preferredY = origin?.y ?? height / 2;
        preview.style.left = `${clamp(width / 2, previewWidth / 2 + 16, width - previewWidth / 2 - 16)}px`;
        preview.style.top = `${clamp(preferredY, previewHeight / 2 + 18, height - previewHeight / 2 - 54)}px`;
      }
    }

    topEdge.classList.toggle('is-visible', state.position < -0.08);
    bottomEdge.classList.toggle('is-visible', state.position > cards.length - 0.92);
    setStatus();
  }

  function tick(now) {
    const deltaFactor = clamp((now - state.lastFrameAt) / 16.667, 0.25, 2.25);
    state.lastFrameAt = now;

    if (!state.dragging && !state.pinnedId) {
      if (!prefersReducedMotion) {
        state.position += state.velocity * deltaFactor;
        state.velocity *= Math.pow(0.895, deltaFactor);

        if (state.position < 0) {
          state.velocity += (0 - state.position) * 0.065 * deltaFactor;
          state.velocity *= Math.pow(0.78, deltaFactor);
        } else if (state.position > cards.length - 1) {
          state.velocity -= (state.position - (cards.length - 1)) * 0.065 * deltaFactor;
          state.velocity *= Math.pow(0.78, deltaFactor);
        }

        state.position = clamp(state.position, -0.52, cards.length - 0.48);
        if (Math.abs(state.velocity) < 0.0015 && state.position >= 0 && state.position <= cards.length - 1) {
          state.velocity = 0;
        }
      }
    }

    layoutCards(deltaFactor);
    frameId = window.requestAnimationFrame(tick);
  }

  cardNodes.forEach((node, cardId) => {
    const button = node.querySelector('button');
    button.addEventListener('pointerenter', () => showPreview(cardId));
    button.addEventListener('pointerleave', schedulePreviewClose);
    button.addEventListener('focus', () => showPreview(cardId, 'focus'));
    button.addEventListener('blur', schedulePreviewClose);
    button.addEventListener('click', (event) => {
      if (state.pointerOpenedCardId === cardId) {
        state.pointerOpenedCardId = null;
        return;
      }
      if (state.dragMoved) {
        event.preventDefault();
        return;
      }
      showPreview(cardId, 'pin');
    });
  });

  preview.addEventListener('pointerenter', () => {
    state.pointerOverPreview = true;
    window.clearTimeout(closePreviewTimer);
  });
  preview.addEventListener('pointerleave', () => {
    state.pointerOverPreview = false;
    schedulePreviewClose();
  });
  preview.addEventListener('click', (event) => {
    if (!state.pinnedId && !event.target.closest('button')) pinCurrentCard();
  });
  preview.querySelector('.preview-pin').addEventListener('click', () => {
    if (activeVariant.key === 'E' && state.pinnedId) closePreview(true);
    else pinCurrentCard();
  });
  preview.querySelectorAll('[data-preview-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const labels = {
        source: '原型反馈：这里将返回原对话',
        export: '原型反馈：这里将导出 Markdown',
        remove: '原型不会修改真实收藏',
      };
      showToast(labels[button.dataset.previewAction]);
    });
  });

  scrim.addEventListener('click', () => closePreview(true));

  viewport.addEventListener('wheel', (event) => {
    if (state.pinnedId) return;
    event.preventDefault();
    viewport.classList.add('has-moved');
    closePreview();
    state.lastWheelAt = performance.now();

    if (prefersReducedMotion) {
      state.position = clamp(state.position + event.deltaY * 0.0045, 0, cards.length - 1);
      state.velocity = 0;
    } else {
      state.velocity += clamp(event.deltaY, -120, 120) * 0.00145;
      state.velocity = clamp(state.velocity, -0.72, 0.72);
    }
  }, { passive: false });

  viewport.addEventListener('pointerdown', (event) => {
    if (state.pinnedId || event.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.pressedCardId = event.target.closest('.river-card')?.dataset.cardId ?? null;
    state.lastPointerY = event.clientY;
    state.lastPointerTime = performance.now();
    state.velocity = 0;
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const now = performance.now();
    const deltaY = state.lastPointerY - event.clientY;
    const elapsed = Math.max(8, now - state.lastPointerTime);
    const activationDistance = event.pointerType === 'touch'
      ? TOUCH_DRAG_ACTIVATION_DISTANCE
      : MOUSE_DRAG_ACTIVATION_DISTANCE;
    const hasActivatedDrag = state.dragMoved || Math.abs(deltaY) >= activationDistance;
    if (hasActivatedDrag && deltaY !== 0) {
      state.dragMoved = true;
      viewport.classList.add('has-moved');
      closePreview();
      state.position = clamp(state.position + deltaY / activeVariant.spacing, -0.5, cards.length - 0.5);
      state.velocity = prefersReducedMotion ? 0 : clamp((deltaY / activeVariant.spacing) * (16.667 / elapsed), -0.62, 0.62);
      state.lastPointerY = event.clientY;
      state.lastPointerTime = now;
    }
  });

  const endDrag = (event) => {
    if (!state.dragging) return;
    const releasedCardId = event.type === 'pointerup'
      ? document.elementFromPoint(event.clientX, event.clientY)?.closest('.river-card')?.dataset.cardId
      : null;
    const cardIdToOpen = !state.dragMoved && releasedCardId === state.pressedCardId
      ? state.pressedCardId
      : null;
    state.dragging = false;
    state.pressedCardId = null;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (cardIdToOpen) {
      state.pointerOpenedCardId = cardIdToOpen;
      showPreview(cardIdToOpen, 'pin');
    }
    window.setTimeout(() => {
      state.dragMoved = false;
      state.pointerOpenedCardId = null;
    }, 0);
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePreview(true);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    closePreview(true);
    state.velocity = 0;
    state.position = clamp(Math.round(state.position) + (event.key === 'ArrowDown' ? 1 : -1), 0, cards.length - 1);
  });

  frame.querySelectorAll('[data-prototype-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const feedback = {
        search: '搜索不在本轮原型范围内',
        settings: '设置不在本轮原型范围内',
        'list-view': '列表视图保留，河流只负责探索与重遇',
      };
      showToast(feedback[button.dataset.prototypeAction]);
    });
  });

  const resizeObserver = new ResizeObserver(() => layoutCards(1));
  resizeObserver.observe(viewport);
  frameId = window.requestAnimationFrame(tick);
}

function switchVariant(direction) {
  const currentIndex = variants.findIndex((variant) => variant.key === activeVariant.key);
  const nextIndex = (currentIndex + direction + variants.length) % variants.length;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', variants[nextIndex].key);
  window.location.assign(url);
}

document.querySelector('[data-switch-variant="previous"]').addEventListener('click', () => switchVariant(-1));
document.querySelector('[data-switch-variant="next"]').addEventListener('click', () => switchVariant(1));
document.querySelector('[data-reset-prototype]').addEventListener('click', () => setupPrototype());

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (event.key === 'ArrowLeft') switchVariant(-1);
  if (event.key === 'ArrowRight') switchVariant(1);
});

setupPrototype();
