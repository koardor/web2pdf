// 选择元素：悬停高亮，滚轮（或 ↑/↓）切换父/子元素，点击或 Enter 确认；支持元素内部滚动
(function () {
  const W = window.__w2p;
  if (!W || W.elementInstalled) return;
  W.elementInstalled = true;

  const CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    .box { position: fixed; z-index: 2147483647; outline: 2px solid #f97316; background: rgba(249,115,22,.12); pointer-events: none; }
    .label { position: fixed; z-index: 2147483647; padding: 2px 6px; border-radius: 4px; background: #f97316; color: #fff;
      font: 12px/1.4 system-ui, sans-serif; white-space: nowrap; pointer-events: none; }
    .hint { position: fixed; z-index: 2147483647; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px;
      background: rgba(17,24,39,.9); color: #fff; font: 13px/1.4 system-ui, "Microsoft YaHei", sans-serif; pointer-events: none; white-space: nowrap; }
  `;

  function isInnerScroller(el) {
    if (el === document.body || el === document.documentElement) return false;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    return ['auto', 'scroll', 'overlay'].includes(getComputedStyle(el).overflowY);
  }

  // 自身或祖先是 fixed：滚动页面不会移动它
  function inFixed(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }

  function describe(el) {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    const id = el.id ? `#${el.id}` : '';
    const h = isInnerScroller(el) ? el.scrollHeight : Math.round(el.getBoundingClientRect().height);
    return `${el.tagName.toLowerCase()}${id}${cls}  ${Math.round(el.getBoundingClientRect().width)} × ${h}`;
  }

  function selectElement() {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.setAttribute(W.MARK, '');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="box" hidden></div><div class="label" hidden></div>
        <div class="hint">点击选择元素；滚轮或 ↑/↓ 切换上级/下级；Enter 确认，Esc 取消</div>`;
      document.documentElement.appendChild(host);
      const box = root.querySelector('.box'), label = root.querySelector('.label');

      let current = null;   // 当前高亮的元素
      let base = null;      // 鼠标直接指着的元素
      let stack = [];       // 往上切换时走过的子元素

      function render() {
        if (!current || !current.isConnected) { box.hidden = label.hidden = true; return; }
        const r = current.getBoundingClientRect();
        box.hidden = label.hidden = false;
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        label.textContent = describe(current);
        const ly = r.top >= 24 ? r.top - 22 : Math.min(innerHeight - 22, Math.max(0, r.top) + 2);
        Object.assign(label.style, { left: `${Math.max(0, Math.min(innerWidth - 200, r.left))}px`, top: `${ly}px` });
      }

      function pick(el) {
        if (!el || el === document.documentElement || el.hasAttribute?.(W.MARK)) return;
        if (el !== base) {
          base = el;
          current = el;
          stack = [];
          render();
        }
      }

      function up() {
        if (current && current.parentElement && current !== document.body) {
          stack.push(current);
          current = current.parentElement;
          render();
        }
      }

      function down() {
        if (stack.length) {
          current = stack.pop();
          render();
        }
      }

      const block = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const onMove = (e) => pick(document.elementFromPoint(e.clientX, e.clientY));
      // 鼠标进入 iframe 后父页面收不到 mousemove，但 iframe 元素本身会收到 mouseover
      const onOver = (e) => { if (e.target instanceof HTMLIFrameElement) pick(e.target); };
      const onWheel = (e) => { block(e); if (e.deltaY < 0) up(); else if (e.deltaY > 0) down(); };
      const onClick = (e) => { block(e); finish(true); };
      const onKey = (e) => {
        if (e.key === 'Escape') { block(e); finish(false); }
        else if (e.key === 'Enter') { block(e); finish(true); }
        else if (e.key === 'ArrowUp') { block(e); up(); }
        else if (e.key === 'ArrowDown') { block(e); down(); }
      };
      const onScroll = () => render();

      const listeners = [
        ['mousemove', onMove], ['mouseover', onOver], ['wheel', onWheel], ['click', onClick],
        ['mousedown', block], ['mouseup', block], ['pointerdown', block], ['pointerup', block],
        ['keydown', onKey], ['scroll', onScroll],
      ];
      listeners.forEach(([type, fn]) => window.addEventListener(type, fn, { capture: true, passive: false }));

      function finish(ok) {
        listeners.forEach(([type, fn]) => window.removeEventListener(type, fn, { capture: true }));
        host.remove();
        if (!ok || !current) { resolve(null); return; }
        const el = current;
        const inner = isInnerScroller(el);
        const fixed = inFixed(el);
        const job = inner ? innerJob(el, fixed) : fixed ? viewportJob(el) : W.pageRectJob(docRect(el));
        W.setJob(job, { innerEl: inner ? el : null, target: el });
        resolve(job);
      }
    });
  }

  function docRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  // fixed 容器里的普通元素：原地截一块，不滚动页面
  function viewportJob(el) {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.max(1, Math.min(innerWidth, r.right) - x);
    const h = Math.max(1, Math.min(innerHeight, r.bottom) - y);
    return { tiles: [{ pageScroll: null, innerScroll: null, clip: { x, y, w, h }, destY: 0 }], width: w, height: h, viewportW: innerWidth, hideFixedFrom: 0 };
  }

  // 内部滚动元素：先滚动元素内部；元素比视口高时，内部滚到底后再滚动页面截剩下的部分。
  // 在 fixed 容器里时页面滚动不起作用，只截屏幕上看得到的那一段窗口
  function innerJob(el, fixed) {
    const H = document.scrollingElement.scrollHeight;
    const pageMax = Math.max(0, H - innerHeight);
    const r = el.getBoundingClientRect();
    const cTop = r.top + el.clientTop;
    const cLeft = r.left + el.clientLeft;
    const cH = el.clientHeight;
    const docTop = cTop + scrollY;
    const fits = fixed || (cTop >= 0 && cTop + cH <= innerHeight);
    const page0 = fits ? scrollY : Math.max(0, Math.min(docTop, pageMax));
    const wTop = docTop - page0;
    const vh = Math.max(1, Math.min(cH, innerHeight - wTop));
    const innerMax = el.scrollHeight - cH;
    const vx = Math.max(0, cLeft);
    const width = Math.max(1, Math.min(innerWidth, cLeft + el.clientWidth) - vx);
    const height = Math.min(el.scrollHeight, Web2pdf.MAX_TOTAL_HEIGHT);

    const tiles = Web2pdf.planTiles({ top: 0, height: Math.min(innerMax + vh, el.scrollHeight), viewportHeight: vh, scrollMax: innerMax })
      .map((t) => ({ pageScroll: page0, innerScroll: t.scroll, clip: { x: vx, y: wTop + t.offsetInView, w: width, h: t.h }, destY: t.destY }));
    if (!fixed && cH > vh) {
      const done = innerMax + vh;
      Web2pdf.planTiles({ top: docTop + vh, height: cH - vh, viewportHeight: innerHeight, scrollMax: pageMax }).forEach((t) =>
        tiles.push({ pageScroll: t.scroll, innerScroll: innerMax, clip: { x: vx, y: t.offsetInView, w: width, h: t.h }, destY: done + t.destY }));
    }
    // 总高度上限：丢掉超出的块，最后一块截短
    const kept = tiles.filter((t) => t.destY < height);
    const last = kept[kept.length - 1];
    if (last && last.destY + last.clip.h > height) last.clip.h = height - last.destY;
    return { tiles: kept, width, height, viewportW: innerWidth, hideFixedFrom: 0 };
  }

  W.registerMode('element', selectElement);
})();
