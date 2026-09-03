const variants = [
  { key: 'A', name: '柔性河流', className: 'variant-a', spacing: 86 },
  { key: 'B', name: '滚动牌组', className: 'variant-b', spacing: 78 },
  { key: 'C', name: '中心轨道', className: 'variant-c', spacing: 116 },
];

const cards = [
  {
    id: 'card-01', kind: '回答片段', title: '前缀不变，是 KV Cache 能复用的根基',
    excerpt: '模型只能往后看，恰好保证已计算过的前缀不会因为未来 token 而改变。',
    body: '模型“只能往后看”不是能力缺陷，而是下一词预测的结构性约束。因为前缀在后续生成中保持不变，前缀对应的 Key 与 Value 才能够被安全缓存。它既是模型的限制，也是工程上的机会。',
    source: '上下文工程 · AI Agents in Depth', site: '当前会话', date: '今天 19:46', accent: '#527aa8', soft: '#eaf1f8',
  },
  {
    id: 'card-02', kind: '完整回答', title: 'Agent.md 应保存身份与准则，而不是动态知识',
    excerpt: '会变化的知识、链接和任务状态，应当活在知识库、工具或对话里。',
    body: 'Agent.md 装的是“身份与准则”——至于知识、链接、状态这些会变化的东西，让它们活在知识库、工具和对话里。\n\n身份和准则需要在大量任务中保持稳定，例如写作习惯、风险边界与做决定时坚持的原则。动态知识则可能随时间变化；如果持续塞进 Agent.md，旧信息会在不恰当的任务中干扰模型。\n\n更稳健的方式，是让 Agent.md 足够小、足够稳定，而真正会增长的内容进入可检索知识库，并保留来源、更新时间与重新验证入口。',
    source: '上下文工程 · AI Agents in Depth', site: '当前会话', date: '今天 18:22', accent: '#73689a', soft: '#f0edf7',
  },
  {
    id: 'card-03', kind: '回答片段', title: '约束前置，比功能堆叠更能控制长期成本',
    excerpt: '功能做出来之前，先识别权限边界、数据模型与持续化方案。',
    body: '架构约束前置并不是为了拖慢开发，而是为了避免功能增量把长期成本藏起来。权限边界、数据模型、持久化和外部依赖决定的是系统骨架；功能可以在骨架内逐步增量实现。',
    source: 'Chrome 插件开发指南', site: '影刀 AI WorkOS', date: '今天 16:08', accent: '#4e7d6a', soft: '#e8f2ed',
  },
  {
    id: 'card-04', kind: '完整回答', title: '为什么上下文设计决定了 Agent 的上限',
    excerpt: '更长的上下文不等于更好的上下文，边界和来源身份同样重要。',
    body: '上下文工程不是把更多内容塞给模型，而是在有限注意力内保留正确的身份、来源和任务边界。一个可追溯、可裁剪的上下文模型，往往比单纯增加窗口长度更能稳定提升 Agent 的表现。',
    source: 'AI Agents in Depth', site: '网页阅读', date: '昨天 22:11', accent: '#a17848', soft: '#f6efe5',
  },
  {
    id: 'card-05', kind: '回答片段', title: '收藏不等于认同，更不等于已经掌握',
    excerpt: '先用低成本动作捕获，再由用户主动加工成可以复用的判断。',
    body: '收藏只说明“这个内容值得留下”。它可以是别人的观点，也可以是一段尚未验证的推理。只有经过用户主动加工、补充边界并确认后，它才可能成为能够再次参与判断的个人认知。',
    source: '页脉产品方向讨论', site: '当前会话', date: '昨天 20:34', accent: '#527aa8', soft: '#eaf1f8',
  },
  {
    id: 'card-06', kind: '完整回答', title: '深模块的价值来自隐藏复杂度，而不是代码少',
    excerpt: '好的接口提供少量高杠杆能力，并把大量策略留在边界内部。',
    body: '模块是否“深”，不取决于文件行数，而取决于接口暴露的复杂度和内部吸收的复杂度之比。接口越小、可提供的能力越完整，调用方越不需要知道内部策略，模块就越深。',
    source: '软件设计 · 深模块', site: '网页阅读', date: '昨天 14:02', accent: '#4e7d6a', soft: '#e8f2ed',
  },
  {
    id: 'card-07', kind: '回答片段', title: '视觉不是装饰，它决定用户是否愿意建立习惯',
    excerpt: '当基础功能都足够好时，体验的整体质感会成为真正的差异。',
    body: '对高频个人工具而言，视觉并不是完成核心功能后才添加的包装。它影响用户是否愿意打开、是否相信工具里的内容值得维护，以及是否能够把一次偶然使用变成长期习惯。',
    source: '产品方向梳理', site: '当前会话', date: '8 月 30 日', accent: '#a17848', soft: '#f6efe5',
  },
  {
    id: 'card-08', kind: '完整回答', title: '本地优先不意味着把数据库直接暴露给用户',
    excerpt: '可迁移资产、运行时索引和临时状态需要分层保存。',
    body: '本地优先的重点是资产所有权和可迁移性，而不是要求所有运行时状态都采用用户可读格式。认知可以使用普通 Markdown；搜索索引、界面状态和事务数据仍然适合保存在内部数据库。',
    source: '本地知识架构', site: '页脉设计', date: '8 月 29 日', accent: '#73689a', soft: '#f0edf7',
  },
  {
    id: 'card-09', kind: '回答片段', title: '减少上下文，不等于损失信息',
    excerpt: '如果来源身份和检索入口仍在，未注入的内容依然可以按需回来。',
    body: '上下文裁剪不是永久删除信息，而是把“每次都携带”改成“需要时检索”。只要来源身份、稳定引用和恢复入口仍然存在，更小的上下文反而能让重要信息获得更多注意力。',
    source: '上下文窗口设计', site: '网页阅读', date: '8 月 28 日', accent: '#527aa8', soft: '#eaf1f8',
  },
  {
    id: 'card-10', kind: '完整回答', title: '先验证重遇价值，再设计自动关联',
    excerpt: '没有真实收藏行为，任何主题聚类和知识图谱都只是想象出来的结构。',
    body: '自动聚类只有在用户确实积累了一批收藏并频繁重新访问时才有价值。当前更重要的是验证：用户会不会收藏、会不会回来、什么内容值得被再次看见。数据出现以后，再决定主题和关联应当如何形成。',
    source: '收藏优先产品方向', site: '页脉设计', date: '8 月 27 日', accent: '#4e7d6a', soft: '#e8f2ed',
  },
];

const root = document.querySelector('#prototype-root');
const label = document.querySelector('#variant-label');
const stateLabel = document.querySelector('#variant-state');
const announcer = document.querySelector('#prototype-announcer');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let variant = getVariant();
let frame = 0;
let position = 0;
let velocity = 0;
let dragging = false;
let dragMoved = false;
let pressedCardId = null;
let pointerOpenedCardId = null;
let lastY = 0;
let lastTime = 0;
let hoveredId = null;
let selectedId = null;
let returnPosition = null;

function getVariant() {
  const key = new URLSearchParams(window.location.search).get('variant')?.toUpperCase() ?? 'A';
  return variants.find((item) => item.key === key) ?? variants[0];
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

function shortestRelative(index, current, length) {
  const raw = index - wrap(current, length);
  return wrap(raw + length / 2, length) - length / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function currentIndex() {
  return wrap(Math.round(position), cards.length);
}

function cardMarkup(card, index) {
  return `
    <article class="loop-card" data-card-id="${card.id}" data-card-index="${index}" style="--accent:${card.accent};--soft:${card.soft}">
      <span class="loop-card__accent" aria-hidden="true"></span>
      <button type="button" class="loop-card__button" aria-label="阅读收藏：${escapeHtml(card.title)}">
        <span class="loop-card__topline">
          <span class="loop-card__kind">${card.kind}</span>
          <span class="loop-card__source">${escapeHtml(card.source)}</span>
          ${index === 0 ? '<span class="loop-card__latest">最新</span>' : ''}
        </span>
        <strong>${escapeHtml(card.title)}</strong>
        <span class="loop-card__excerpt">${escapeHtml(card.excerpt)}</span>
        <span class="loop-card__meta"><span>${escapeHtml(card.site)}</span><time>${escapeHtml(card.date)}</time></span>
      </button>
    </article>`;
}

function appMarkup() {
  return `
    <section class="prototype-frame ${variant.className}" aria-label="无限收藏卡片河流原型">
      <header class="topbar">
        <div class="brand"><img src="/icon.svg" alt="" /><strong>页脉</strong></div>
        <div class="topbar__actions"><button type="button" aria-label="搜索">⌕</button><button type="button" aria-label="设置">⚙</button></div>
      </header>
      <section class="collection-shell">
        <header class="collection-header">
          <div><p>Collection</p><h1>收藏</h1></div>
          <div class="collection-header__actions">
            <button type="button" data-export>导出全部</button><span>${cards.length}</span><button type="button" aria-label="关闭收藏">×</button>
          </div>
        </header>
        <div class="loop-stage" tabindex="0" aria-label="无限收藏河流，可使用滚轮、拖拽或上下方向键浏览">
          <div class="loop-stage__wash loop-stage__wash--top" aria-hidden="true"></div>
          <div class="loop-stage__wash loop-stage__wash--bottom" aria-hidden="true"></div>
          <svg class="loop-path" aria-hidden="true" viewBox="0 0 700 800" preserveAspectRatio="none"><path d="M 350 -40 C 455 120, 245 260, 350 410 C 455 560, 245 690, 350 840" /></svg>
          <div class="loop-cards" role="list">${cards.map(cardMarkup).join('')}</div>
          <div class="position-rail">
            <span data-position-label>1 / ${cards.length}</span>
            <button type="button" data-latest>回到最新</button>
          </div>
          <div class="loop-instruction"><span>滚轮 / 拖拽</span><small>持续翻阅收藏</small></div>
          <button class="reader-scrim" type="button" tabindex="-1" aria-label="返回收藏河流"></button>
          <section class="reader" aria-hidden="true" inert>
            <header class="reader__header">
              <button type="button" class="reader__back" aria-label="返回收藏河流">←</button>
              <div><small></small><h2></h2></div>
            </header>
            <div class="reader__body"><p></p><div class="reader__source"></div></div>
            <footer class="reader__footer"><button type="button">回到原对话</button><button type="button">导出 Markdown</button><button type="button">取消收藏</button></footer>
          </section>
        </div>
      </section>
    </section>`;
}

function setup() {
  cancelAnimationFrame(frame);
  variant = getVariant();
  position = 0;
  velocity = 0;
  hoveredId = null;
  selectedId = null;
  returnPosition = null;
  root.innerHTML = appMarkup();
  document.body.dataset.variant = variant.key;
  label.textContent = `${variant.key} · ${variant.name}`;

  const stage = root.querySelector('.loop-stage');
  const cardNodes = [...root.querySelectorAll('.loop-card')];
  const reader = root.querySelector('.reader');
  const scrim = root.querySelector('.reader-scrim');
  const positionLabel = root.querySelector('[data-position-label]');

  function openReader(card) {
    returnPosition = position;
    selectedId = card.id;
    velocity = 0;
    reader.querySelector('small').textContent = `${card.kind} · 收藏于 ${card.date}`;
    reader.querySelector('h2').textContent = card.title;
    reader.querySelector('.reader__body p').textContent = card.body;
    reader.querySelector('.reader__source').textContent = `来源 · ${card.source}`;
    reader.classList.add('is-open');
    scrim.classList.add('is-open');
    reader.removeAttribute('inert');
    reader.setAttribute('aria-hidden', 'false');
    reader.querySelector('.reader__back').focus({ preventScroll: true });
  }

  function closeReader() {
    if (!selectedId) return;
    const focusId = selectedId;
    selectedId = null;
    position = returnPosition ?? position;
    returnPosition = null;
    velocity = 0;
    reader.classList.remove('is-open');
    scrim.classList.remove('is-open');
    reader.setAttribute('inert', '');
    reader.setAttribute('aria-hidden', 'true');
    requestAnimationFrame(() => {
      root.querySelector(`[data-card-id="${focusId}"] .loop-card__button`)?.focus({ preventScroll: true });
    });
  }

  function poseFor(index, width, height) {
    const relative = shortestRelative(index, position, cards.length);
    const centerY = height * 0.5;
    const hoveredIndex = cards.findIndex((card) => card.id === hoveredId);
    const hoveredRelative = hoveredIndex < 0 ? null : shortestRelative(hoveredIndex, position, cards.length);
    let y;
    let x;
    let scale;
    let rotate = 0;

    if (variant.key === 'B') {
      const behind = relative < 0;
      y = centerY + (behind ? relative * 26 : relative * variant.spacing);
      x = width / 2 + (behind ? relative * -4 : Math.sin(relative * 0.54) * 18);
      scale = behind ? 1 + relative * 0.035 : 1 - Math.min(relative * 0.012, 0.05);
      rotate = behind ? relative * -0.35 : relative * 0.28;
    } else if (variant.key === 'C') {
      y = centerY + relative * variant.spacing;
      x = width / 2;
      scale = 1 - Math.min(Math.abs(relative) * 0.035, 0.12);
    } else {
      y = centerY + relative * variant.spacing;
      x = width / 2 + Math.sin(relative * 0.66) * Math.min(34, width * 0.07);
      scale = 1 - Math.min(Math.abs(relative) * 0.018, 0.09);
      if (Math.abs(relative) > 1.2) rotate = clamp(relative * -0.32, -1.4, 1.4);
    }

    if (hoveredRelative !== null && cards[index].id !== hoveredId) {
      const distance = relative - hoveredRelative;
      if (Math.abs(distance) < 1.6) y += Math.sign(distance) * (1.6 - Math.abs(distance)) * 11;
    }
    if (cards[index].id === hoveredId) {
      x += variant.key === 'C' ? 0 : 6;
      scale += 0.018;
    }

    const edgeDistance = Math.abs(y - centerY) / Math.max(centerY, 1);
    const opacity = 1 - smoothstep(0.68, 1.02, edgeDistance);
    return { relative, x, y, scale, rotate, opacity };
  }

  function render() {
    const bounds = stage.getBoundingClientRect();
    cardNodes.forEach((node, index) => {
      const pose = poseFor(index, bounds.width, bounds.height);
      const cardWidth = Math.min(390, Math.max(bounds.width - 78, 0));
      const cardHeight = variant.key === 'C' ? 112 : 98;
      const x = Math.round(pose.x - cardWidth / 2);
      const y = Math.round(pose.y - cardHeight / 2);
      node.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${pose.rotate.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;
      node.style.opacity = pose.opacity.toFixed(3);
      node.style.zIndex = String(30 - Math.round(Math.abs(pose.relative) * 2));
      node.style.pointerEvents = pose.opacity < 0.18 || selectedId ? 'none' : 'auto';
      node.toggleAttribute('inert', pose.opacity < 0.18 || Boolean(selectedId));
      node.classList.toggle('is-center', Math.abs(pose.relative) < 0.55);
      node.classList.toggle('is-hovered', cards[index].id === hoveredId);
    });
    const index = currentIndex();
    positionLabel.textContent = `${index + 1} / ${cards.length}`;
    stateLabel.textContent = `${selectedId ? '阅读层' : Math.abs(velocity) > 0.004 ? '滚动中' : '循环'} · ${index + 1} / ${cards.length}`;
  }

  function tick() {
    if (!dragging && !selectedId) {
      position += velocity;
      velocity *= reducedMotion ? 0 : 0.91;
      if (Math.abs(velocity) < 0.0008) velocity = 0;
    }
    render();
    frame = requestAnimationFrame(tick);
  }

  stage.addEventListener('wheel', (event) => {
    if (selectedId) return;
    event.preventDefault();
    hoveredId = null;
    if (reducedMotion) {
      position += Math.sign(event.deltaY) * 0.32;
      velocity = 0;
    } else {
      velocity = clamp(velocity + clamp(event.deltaY, -120, 120) * 0.00125, -0.55, 0.55);
    }
  }, { passive: false });

  stage.addEventListener('pointerdown', (event) => {
    if (selectedId || event.button !== 0) return;
    dragging = true;
    dragMoved = false;
    pressedCardId = event.target.closest('.loop-card')?.dataset.cardId ?? null;
    lastY = event.clientY;
    lastTime = performance.now();
    velocity = 0;
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = lastY - event.clientY;
    if (!dragMoved && Math.abs(delta) < 6) return;
    event.preventDefault();
    dragMoved = true;
    hoveredId = null;
    const now = performance.now();
    const elapsed = Math.max(8, now - lastTime);
    position += delta / variant.spacing;
    velocity = reducedMotion ? 0 : clamp((delta / variant.spacing) * (16.67 / elapsed), -0.48, 0.48);
    lastY = event.clientY;
    lastTime = now;
  });

  function endDrag(event) {
    if (!dragging) return;
    const releasedCardId = event.type === 'pointerup'
      ? document.elementFromPoint(event.clientX, event.clientY)?.closest('.loop-card')?.dataset.cardId ?? null
      : null;
    const cardIdToOpen = !dragMoved && pressedCardId === releasedCardId ? pressedCardId : null;
    dragging = false;
    pressedCardId = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (cardIdToOpen) {
      pointerOpenedCardId = cardIdToOpen;
      const card = cards.find((item) => item.id === cardIdToOpen);
      if (card) openReader(card);
    }
    setTimeout(() => {
      dragMoved = false;
      pointerOpenedCardId = null;
    }, 0);
  }

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  cardNodes.forEach((node, index) => {
    const button = node.querySelector('button');
    button.addEventListener('pointerenter', () => { if (!dragging && Math.abs(velocity) < 0.04) hoveredId = cards[index].id; });
    button.addEventListener('pointerleave', () => { if (hoveredId === cards[index].id) hoveredId = null; });
    button.addEventListener('click', () => {
      if (pointerOpenedCardId === cards[index].id) {
        pointerOpenedCardId = null;
        return;
      }
      if (!dragMoved) openReader(cards[index]);
    });
  });

  stage.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedId) {
      event.preventDefault();
      closeReader();
      return;
    }
    if (selectedId || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    position = Math.round(position) + (event.key === 'ArrowDown' ? 1 : -1);
    velocity = 0;
    render();
  });

  reader.querySelector('.reader__back').addEventListener('click', closeReader);
  scrim.addEventListener('click', closeReader);
  root.querySelector('[data-latest]').addEventListener('click', () => {
    position = 0;
    velocity = 0;
    announcer.textContent = '已回到最新收藏';
  });
  root.querySelector('[data-export]').addEventListener('click', () => { announcer.textContent = '原型：导出全部'; });

  frame = requestAnimationFrame(tick);
}

function switchVariant(direction) {
  const current = variants.findIndex((item) => item.key === variant.key);
  const next = wrap(current + direction, variants.length);
  const url = new URL(window.location.href);
  url.searchParams.set('variant', variants[next].key);
  history.replaceState({}, '', url);
  setup();
  announcer.textContent = `已切换至方案 ${variants[next].key}：${variants[next].name}`;
}

document.querySelector('[data-switch="previous"]').addEventListener('click', () => switchVariant(-1));
document.querySelector('[data-switch="next"]').addEventListener('click', () => switchVariant(1));
document.querySelector('[data-reset]').addEventListener('click', setup);
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (event.altKey && event.key === 'ArrowLeft') switchVariant(-1);
  if (event.altKey && event.key === 'ArrowRight') switchVariant(1);
});

setup();
