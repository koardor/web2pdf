// 选择区域：拖动框选，拖动时可滚轮滚动、贴边自动滚动；松开后可用手柄微调
(function () {
  const W = window.__w2p;
  if (!W || W.regionInstalled) return;
  W.regionInstalled = true;

  const EDGE = 40;          // 距视口上下边缘多少像素开始自动滚动
  const MAX_SPEED = 25;     // 自动滚动最快每帧像素
  const MIN_SIZE = 5;
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    .dim { position: fixed; background: rgba(0,0,0,.4); pointer-events: none; }
    .layer { position: fixed; inset: 0; cursor: crosshair; z-index: 2147483647; }
    .layer.idle { background: rgba(0,0,0,.25); }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px;
      background: rgba(17,24,39,.9); color: #fff; font: 13px/1.4 system-ui, "Microsoft YaHei", sans-serif; pointer-events: none; white-space: nowrap; }
    .box { position: fixed; outline: 2px solid #3b82f6; pointer-events: none; }
    .size { position: absolute; left: 0; top: -24px; padding: 2px 6px; border-radius: 4px; background: #3b82f6; color: #fff;
      font: 12px/1.4 system-ui, sans-serif; white-space: nowrap; }
    .handle { position: absolute; width: 10px; height: 10px; margin: -6px 0 0 -6px; background: #fff; border: 1px solid #3b82f6; pointer-events: auto; }
    .handle[data-h=nw], .handle[data-h=se] { cursor: nwse-resize; }
    .handle[data-h=ne], .handle[data-h=sw] { cursor: nesw-resize; }
    .handle[data-h=n], .handle[data-h=s] { cursor: ns-resize; }
    .handle[data-h=e], .handle[data-h=w] { cursor: ew-resize; }
    .bar { position: fixed; display: flex; gap: 6px; }
    .bar button { padding: 5px 12px; border: 0; border-radius: 4px; font: 13px system-ui, "Microsoft YaHei", sans-serif; cursor: pointer; }
    .ok { background: #2563eb; color: #fff; }
    .cancel { background: #fff; color: #111827; }
  `;

  function selectRegion() {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.setAttribute(W.MARK, '');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>
        <div class="layer idle"></div>
        <div class="dim"></div><div class="dim"></div><div class="dim"></div><div class="dim"></div>
        <div class="hint">拖动选择区域，可同时滚动滚轮；Enter 确认，Esc 取消</div>
        <div class="box" hidden><span class="size"></span>${HANDLES.map((h) => `<i class="handle" data-h="${h}"></i>`).join('')}</div>
        <div class="bar" hidden><button class="ok">确认</button><button class="cancel">取消</button></div>`;
      document.documentElement.appendChild(host);

      const $ = (s) => root.querySelector(s);
      const layer = $('.layer'), box = $('.box'), size = $('.size'), bar = $('.bar');
      const dims = [...root.querySelectorAll('.dim')];
      // 文档坐标；拖动时 l/t 不动、r/b 跟着鼠标，渲染时再规范化
      let r = null;
      let phase = 'idle';         // idle | drag | adjust
      let edges = '';             // 正在拖的边：n/s/e/w 的组合
      let cx = 0, cy = 0;         // 最后的鼠标视口坐标
      let raf = 0;

      const rect = () => Web2pdf.normalizeRect(r.l, r.t, r.r, r.b);

      function render() {
        if (!r) {
          box.hidden = true; bar.hidden = true; layer.classList.add('idle');
          dims.forEach((d) => { d.hidden = true; });
          return;
        }
        const { x, y, w, h } = rect();
        // 选区外四块变暗（选区可能超出视口，先截到视口内）
        const top = Math.min(innerHeight, Math.max(0, y - scrollY));
        const bottom = Math.min(innerHeight, Math.max(0, y - scrollY + h));
        const left = Math.min(innerWidth, Math.max(0, x - scrollX));
        const right = Math.min(innerWidth, Math.max(0, x - scrollX + w));
        [[0, 0, innerWidth, top], [0, bottom, innerWidth, innerHeight - bottom],
          [0, top, left, bottom - top], [right, top, innerWidth - right, bottom - top]].forEach(([dl, dt, dw, dh], i) => {
          dims[i].hidden = false;
          Object.assign(dims[i].style, { left: `${dl}px`, top: `${dt}px`, width: `${dw}px`, height: `${dh}px` });
        });
        layer.classList.remove('idle');
        box.hidden = false;
        Object.assign(box.style, { left: `${x - scrollX}px`, top: `${y - scrollY}px`, width: `${w}px`, height: `${h}px` });
        size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
        root.querySelectorAll('.handle').forEach((el) => {
          const k = el.dataset.h;
          el.style.left = k.includes('w') ? '0' : k.includes('e') ? '100%' : '50%';
          el.style.top = k.includes('n') ? '0' : k.includes('s') ? '100%' : '50%';
          el.style.display = phase === 'adjust' ? '' : 'none';
        });
        bar.hidden = phase !== 'adjust';
        if (!bar.hidden) {
          const by = Math.min(innerHeight - 40, Math.max(8, y - scrollY + h + 8));
          const bx = Math.min(innerWidth - 150, Math.max(8, x - scrollX + w - 140));
          Object.assign(bar.style, { left: `${bx}px`, top: `${by}px` });
        }
      }

      function track() {
        if (phase !== 'drag') return;
        const px = cx + scrollX, py = cy + scrollY;
        if (edges.includes('n')) r.t = py;
        if (edges.includes('s')) r.b = py;
        if (edges.includes('w')) r.l = px;
        if (edges.includes('e')) r.r = px;
        render();
      }

      function autoScroll() {
        raf = 0;
        if (phase !== 'drag') return;
        let dy = 0;
        if (cy < EDGE) dy = -Math.ceil(MAX_SPEED * (EDGE - cy) / EDGE);
        else if (cy > innerHeight - EDGE) dy = Math.ceil(MAX_SPEED * (cy - (innerHeight - EDGE)) / EDGE);
        if (dy) window.scrollBy(0, dy);
        raf = requestAnimationFrame(autoScroll);
      }

      function startDrag(e, which) {
        e.preventDefault();
        e.stopPropagation();
        cx = e.clientX; cy = e.clientY;
        if (!which) {
          const px = cx + scrollX, py = cy + scrollY;
          r = { l: px, t: py, r: px, b: py };
          which = 'se';
        } else {
          const n = rect();
          r = { l: n.x, t: n.y, r: n.x + n.w, b: n.y + n.h };
        }
        edges = which;
        phase = 'drag';
        render();
        if (!raf) raf = requestAnimationFrame(autoScroll);
      }

      function onMove(e) {
        cx = e.clientX; cy = e.clientY;
        track();
      }

      function onUp() {
        if (phase !== 'drag') return;
        const { w, h } = rect();
        phase = w < MIN_SIZE || h < MIN_SIZE ? 'idle' : 'adjust';
        if (phase === 'idle') r = null;
        render();
      }

      function onScroll() {
        track();
        render();
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === 'Enter' && phase === 'adjust') { e.preventDefault(); e.stopPropagation(); finish(true); }
      }

      function cleanup() {
        cancelAnimationFrame(raf);
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('keydown', onKey, true);
        host.remove();
      }

      function finish(ok) {
        const sel = ok && r ? rect() : null;
        cleanup();
        if (!sel) { resolve(null); return; }
        const job = W.pageRectJob(sel);
        W.setJob(job, { target: null });
        resolve(job);
      }

      layer.addEventListener('mousedown', (e) => { if (e.button === 0) startDrag(e, null); });
      root.querySelectorAll('.handle').forEach((el) =>
        el.addEventListener('mousedown', (e) => { if (e.button === 0) startDrag(e, el.dataset.h); }));
      $('.ok').addEventListener('click', () => finish(true));
      $('.cancel').addEventListener('click', () => finish(false));
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('keydown', onKey, true);
      render();
    });
  }

  W.registerMode('region', selectRegion);
})();
