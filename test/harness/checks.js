// 回归检查（在浏览器面板里对测试页运行）：每个函数返回 { pass, detail }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shadow = () => document.querySelector('[data-w2p]')?.shadowRoot;

async function selectRegion(x1, y1, x2, y2) {
  const p = w2pSend({ type: 'w2p:select', mode: 'region' });
  await sleep(50);
  shadow().querySelector('.layer').dispatchEvent(new MouseEvent('mousedown', { clientX: x1, clientY: y1, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x2, clientY: y2 }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: x2, clientY: y2 }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  return p;
}

// #1 chat.html：区域选择不能把 fixed 外壳藏掉
export async function regionKeepsFixedShell() {
  const sel = await selectRegion(300, 100, 700, 400);
  await w2pSend({ type: 'w2p:step', index: 0 });
  const vis = getComputedStyle(document.querySelector('.shell')).visibility;
  await w2pSend({ type: 'w2p:restore' });
  return { pass: vis === 'visible' && sel.job.tiles.length === 1, detail: { vis, tiles: sel.job.tiles } };
}

// #2 区域确认按钮必须是点击时最上层的元素
export async function regionButtonsOnTop() {
  const p = w2pSend({ type: 'w2p:select', mode: 'region' });
  await sleep(50);
  const root = shadow();
  root.querySelector('.layer').dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: 400, clientY: 300 }));
  await sleep(20);
  const hit = (el) => { const r = el.getBoundingClientRect(); return root.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
  const ok = root.querySelector('.ok');
  const handle = root.querySelector('.handle[data-h=se]');
  const res = { okHit: hit(ok)?.className, handleHit: hit(handle)?.className };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await p;
  return { pass: res.okHit === 'ok' && res.handleHit === 'handle', detail: res };
}

// 每块截图时，clip 顶部必须正好对着目标元素的顶部（第一块）
async function clipMatchesTarget(el, sel) {
  await w2pSend({ type: 'w2p:step', index: 0 });
  const r = el.getBoundingClientRect();
  const clip = sel.job.tiles[0].clip;
  await w2pSend({ type: 'w2p:restore' });
  return { pass: Math.abs(clip.y - r.top) < 1 && Math.abs(clip.x - r.left) < 1, detail: { clip, rect: { top: r.top, left: r.left } } };
}

// #3 fixed 小部件里的普通元素，页面可滚动
export async function elementInFixedWidget() {
  const el = document.getElementById('target');
  const p = w2pSend({ type: 'w2p:select', mode: 'element' });
  await sleep(50);
  const r = el.getBoundingClientRect();
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 20, clientY: r.top + 20 }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  const sel = await p;
  return clipMatchesTarget(el, sel);
}
