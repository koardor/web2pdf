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

// #4 有横向滚动条时，整页分块必须按去掉滚动条后的可视高度，clip 不含滚动条
export async function pageTilesExcludeScrollbars() {
  const sel = await w2pSend({ type: 'w2p:select', mode: 'page' });
  await w2pSend({ type: 'w2p:restore' });
  const de = document.documentElement;
  const t = sel.job.tiles;
  const bad = t.filter((x) => x.clip.y + x.clip.h > de.clientHeight || x.clip.w > de.clientWidth);
  return { pass: bad.length === 0, detail: { clientH: de.clientHeight, innerH: innerHeight, clientW: de.clientWidth, first: t[0], bad: bad.length } };
}

// #5 内部滚动容器设置了 scroll-behavior: smooth 时，每一步也要立刻滚到位
export async function innerScrollIgnoresSmooth() {
  const box = document.querySelector('.box');
  box.style.scrollBehavior = 'smooth';
  const p = w2pSend({ type: 'w2p:select', mode: 'element' });
  await sleep(50);
  const r = box.getBoundingClientRect();
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 2, clientY: Math.max(r.top, 0) + 300 }));
  const root = shadow();
  for (let i = 0; i < 5 && !root.querySelector('.label').textContent.startsWith('div.box'); i++) window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  const sel = await p;
  const off = [];
  for (let i = 0; i < sel.job.tiles.length; i++) {
    await w2pSend({ type: 'w2p:step', index: i });
    if (Math.abs(box.scrollTop - sel.job.tiles[i].innerScroll) > 1) off.push([i, box.scrollTop, sel.job.tiles[i].innerScroll]);
  }
  await w2pSend({ type: 'w2p:restore' });
  box.style.scrollBehavior = '';
  return { pass: off.length === 0, detail: { tiles: sel.job.tiles.length, off } };
}

// #6 页面滚不到计划位置时，step 返回按实际滚动位置修正后的 clip
export async function stepReportsActualScroll() {
  const max = document.scrollingElement.scrollHeight - document.documentElement.clientHeight;
  const job = { tiles: [{ pageScroll: max + 50, innerScroll: null, clip: { x: 0, y: 0, w: 100, h: 100 }, destY: 0 }], width: 100, height: 100, viewportW: innerWidth };
  await w2pSend({ type: 'w2p:select', mode: 'visible' });
  window.__w2p.setJob(job, {});
  const res = await w2pSend({ type: 'w2p:step', index: 0 });
  await w2pSend({ type: 'w2p:restore' });
  return { pass: res?.clip?.y === 50, detail: res };
}
