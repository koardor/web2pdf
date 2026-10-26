// 预览页：显示拼好的截图，确认后再按选定格式保存
const EXT = { pdf: 'pdf', png: 'png', jpeg: 'jpg' };
const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.querySelector(s);
let shot = null;

function showStatus(text) {
  const p = $('.status');
  p.textContent = text;
  p.hidden = !text;
}

function format() {
  return document.querySelector('input[name="format"]:checked').value;
}

// 文件名、尺寸和拆分情况随格式变化
function renderInfo() {
  const { width, height, scale } = shot.composed;
  const parts = Web2pdf.planSplits(height, Web2pdf.splitLimitCss(format(), scale));
  const name = Web2pdf.buildFilename({
    title: shot.title, url: shot.url, date: new Date(shot.startedAt), ext: EXT[format()], part: parts.length > 1 ? 1 : null,
  });
  $('.name').textContent = name;
  $('.name').title = name;
  $('.meta').textContent = `${Math.round(width)} × ${Math.round(height)} 像素` +
    (parts.length > 1 ? ` · 将拆成 ${parts.length} 个文件（_part1 … _part${parts.length}）` : '');
  const box = $('.shot');
  box.querySelectorAll('.mark').forEach((m) => m.remove());
  parts.slice(1).forEach((p, i) => {
    const mark = document.createElement('div');
    mark.className = 'mark';
    mark.style.top = `${(p.start / height) * 100}%`;
    mark.innerHTML = `<span>第 ${i + 2} 个文件从这里开始</span>`;
    box.appendChild(mark);
  });
}

function setZoom(mode) {
  const { width, scale } = shot.composed;
  $('.stage').classList.toggle('fit', mode === 'fit');
  // 适应宽度：按页面上的 CSS 宽度显示，窗口窄时缩小；原始大小：截图的实际像素
  $('.shot').style.width = mode === 'fit' ? `min(100%, ${width}px)` : `${Math.round(width * scale)}px`;
  document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('on', b.dataset.zoom === mode));
}

async function act(type) {
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  showStatus(type === 'w2p:save' ? '正在保存…' : '');
  const res = await chrome.runtime.sendMessage({ type, id, format: format() });
  if (!res?.ok) {
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    showStatus(res?.error === 'expired' ? '这个预览已失效，请重新截图。' : `操作失败：${res?.error || '未知错误'}`);
  }
  // 成功时后台会关闭本页
}

async function init() {
  const key = `preview:${id}`;
  shot = (await chrome.storage.session.get(key))[key];
  if (!shot) {
    showStatus('这个预览已失效，请重新截图。');
    document.querySelectorAll('.controls button, .controls input').forEach((el) => { el.disabled = true; });
    return;
  }
  document.title = `预览 - ${shot.title || shot.url}`;
  document.querySelector(`input[value="${shot.format}"]`).checked = true;
  const box = $('.shot');
  for (const seg of shot.composed.segments) {
    const img = document.createElement('img');
    img.src = seg.url;
    img.alt = '';
    box.appendChild(img);
  }
  setZoom('fit');
  renderInfo();
  document.querySelectorAll('input[name="format"]').forEach((i) => i.addEventListener('change', renderInfo));
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => setZoom(b.dataset.zoom)));
  $('.save').addEventListener('click', () => act('w2p:save'));
  $('.retake').addEventListener('click', () => act('w2p:retake'));
  $('.cancel').addEventListener('click', () => act('w2p:discard'));
}

init();
