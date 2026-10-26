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

  function hideEl(el) {
    hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
    el.style.setProperty('visibility', 'hidden', 'important');
  }

  // 隐藏 fixed / sticky 元素，但不能隐藏目标本身或它的祖先
  function hideFixed(target) {
    if (hiddenDone) return;
    hiddenDone = true;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.hasAttribute(MARK)) continue;
      if (target && el.contains(target)) continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') hideEl(el);
    }
    // 内部滚动元素里的 sticky 后代（如日期头），否则每块都会重复
    if (ctx.innerEl) {
      for (const el of ctx.innerEl.querySelectorAll('*')) {
        if (getComputedStyle(el).position === 'sticky' && !el.contains(target)) hideEl(el);
      }
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
    hidden.forEach(([el, value, priority]) => {
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
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
    if (index > 0) hideFixed(ctx.target);
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

  window.__w2p = { registerMode, setJob, hideFixed, restore, MARK };
})();
