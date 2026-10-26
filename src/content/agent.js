// 页面内代理：响应后台消息，负责选择目标、滚动、隐藏固定元素、进度提示和还原
(function () {
  if (window.__w2pInstalled) return;
  window.__w2pInstalled = true;

  const SETTLE_MS = 150;
  const MARK = 'data-w2p';   // 所有注入元素都带这个属性
  const modes = {};
  let job = null;
  let ctx = { innerEl: null, target: null };
  let saved = null;
  let hidden = [];
  let hiddenDone = false;
  let progressEl = null;

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function registerMode(name, selectFn) {
    modes[name] = selectFn;
  }

  function setJob(j, c) {
    job = j;
    ctx = { innerEl: null, target: null, ...c };
    if (ctx.innerEl) saved.innerTop = ctx.innerEl.scrollTop;
  }

  function override(el, prop, value) {
    hidden.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  }

  // fixed 元素隐藏；sticky 元素改成 static（留在原位，不再跟着滚动重复出现）。
  // 目标本身和它的祖先不动，否则会把要截的内容一起藏掉
  function hideFixed(target) {
    if (hiddenDone) return;
    hiddenDone = true;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.hasAttribute(MARK)) continue;
      if (target && el.contains(target)) continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed') override(el, 'visibility', 'hidden');
      else if (pos === 'sticky') override(el, 'position', 'static');
    }
  }

  function setProgress(text) {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.setAttribute(MARK, '');
      Object.assign(progressEl.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
        padding: '6px 12px', borderRadius: '6px', background: 'rgba(17,24,39,.85)',
        color: '#fff', font: '13px/1.4 system-ui, sans-serif', pointerEvents: 'none',
      });
      document.documentElement.appendChild(progressEl);
    }
    progressEl.textContent = text;
    progressEl.style.display = '';
  }

  function hideProgress() {
    if (progressEl) progressEl.style.display = 'none';
  }

  function restore() {
    hidden.reverse().forEach(([el, prop, value, priority]) => {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    });
    hidden = [];
    hiddenDone = false;
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
    progressEl = null;
    if (ctx.innerEl && saved?.innerTop != null) ctx.innerEl.scrollTop = saved.innerTop;
    if (saved) window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    job = null;
    ctx = { innerEl: null, target: null };
  }

  // 可见区域：当前视口一块
  registerMode('visible', async () => ({
    tiles: [{ pageScroll: window.scrollY, innerScroll: null, clip: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, destY: 0 }],
    width: window.innerWidth,
    height: window.innerHeight,
    viewportW: window.innerWidth,
  }));

  // 整个网页：只滚动文档本身，从顶到底
  registerMode('page', async () => {
    const H = document.scrollingElement.scrollHeight;
    const V = window.innerHeight;
    const tiles = Web2pdf.planTiles({ top: 0, height: H, viewportHeight: V, scrollMax: Math.max(0, H - V) })
      .map((t) => ({ pageScroll: t.scroll, innerScroll: null, clip: { x: 0, y: t.offsetInView, w: window.innerWidth, h: t.h }, destY: t.destY }));
    return { tiles, width: window.innerWidth, height: Math.min(H, Web2pdf.MAX_TOTAL_HEIGHT), viewportW: window.innerWidth };
  });

  // 文档坐标的矩形 → 靠滚动页面分块截取的计划；横向截到视口内。
  // keepView（区域模式）：顶部已在屏幕上就不动页面，固定元素同整页一样从第二块起才隐藏
  function pageRectJob(sel, { keepView = false } = {}) {
    const H = document.scrollingElement.scrollHeight;
    const vx = Math.max(0, sel.x - window.scrollX);
    const vr = Math.min(window.innerWidth, sel.x - window.scrollX + sel.w);
    const top = Math.max(0, sel.y);
    const height = Math.max(0, Math.min(H, sel.y + sel.h) - top);
    const width = Math.max(1, vr - vx);
    const tiles = Web2pdf.planTiles({
      top, height, viewportHeight: window.innerHeight, scrollMax: Math.max(0, H - window.innerHeight),
      startScroll: keepView ? window.scrollY : null,
    }).map((t) => ({ pageScroll: t.scroll, innerScroll: null, clip: { x: vx, y: t.offsetInView, w: width, h: t.h }, destY: t.destY }));
    return { tiles, width, height: Math.min(height, Web2pdf.MAX_TOTAL_HEIGHT), viewportW: window.innerWidth, hideFixedFrom: keepView ? 1 : 0 };
  }

  async function select(mode) {
    restore();
    saved = { x: window.scrollX, y: window.scrollY, innerTop: null };
    const fn = modes[mode];
    if (!fn) throw new Error(`unknown mode: ${mode}`);
    const j = await fn();
    if (!j) {
      restore();
      return { ok: false, cancelled: true };
    }
    if (job !== j) setJob(j, ctx);
    return { ok: true, job: j };
  }

  async function step(index) {
    const tile = job.tiles[index];
    hideProgress();
    // 整页第一块保留顶栏；区域/元素从第一块起就隐藏，免得顶栏盖住选中的内容
    if (index >= (job.hideFixedFrom ?? 1)) hideFixed(ctx.target);
    if (tile.pageScroll != null) window.scrollTo({ left: saved.x, top: tile.pageScroll, behavior: 'instant' });
    if (ctx.innerEl && tile.innerScroll != null) ctx.innerEl.scrollTop = tile.innerScroll;
    await nextFrame();
    await nextFrame();
    await sleep(SETTLE_MS);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (typeof msg?.type !== 'string' || !msg.type.startsWith('w2p:') || msg.target) return;
    (async () => {
      switch (msg.type) {
        case 'w2p:select': return select(msg.mode);
        case 'w2p:step': return step(msg.index);
        case 'w2p:progress': setProgress(`截取中 ${msg.done}/${msg.total}`); return { ok: true };
        case 'w2p:restore': restore(); return { ok: true };
        default: return undefined;
      }
    })().then((res) => res && reply(res), (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  });

  window.__w2p = { registerMode, setJob, hideFixed, restore, pageRectJob, MARK };
})();
