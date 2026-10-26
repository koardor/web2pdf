// 拼接截图、按上限拆分、编码为 PNG / JPEG / PDF。
// 块按 destY 从上到下依次到达：每段在第一块到达时才分配画布，段画满就立即编码并释放，
// 同一时间只占用一两段的内存
const JPEG_QUALITY = 0.92;
const PT_PER_CSS_PX = 0.75;

let job = null;

function begin({ width, height, format }) {
  job = { width, height, format, scale: null, parts: null, files: [] };
}

// 收到第一块后才知道真实缩放比例，再规划分段
function planParts(scale) {
  job.scale = scale;
  job.parts = Web2pdf.planSplits(job.height, Web2pdf.splitLimitCss(job.format, scale))
    .map(({ start, end }, i) => ({ index: i, start, end, strips: null, done: false }));
}

function allocate(part) {
  const { width, format, scale } = job;
  const stripCss = Math.floor(Web2pdf.MAX_CANVAS_PX / scale);
  part.strips = [];
  for (let s = part.start; s < part.end; s += stripCss) {
    const e = Math.min(part.end, s + stripCss);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(e * scale) - Math.round(s * scale);
    const ctx = canvas.getContext('2d');
    if (format === 'jpeg' || format === 'pdf') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    part.strips.push({ start: s, end: e, canvas, ctx });
  }
}

function liveStrips() {
  return job.parts ? job.parts.reduce((n, p) => n + (p.strips && !p.done ? p.strips.length : 0), 0) : 0;
}

async function addTile({ dataUrl, clip, destY, viewportW }) {
  // createImageBitmap 不依赖页面渲染；img.decode() 在从不渲染的 offscreen 文档里可能一直不返回
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  if (!job.parts) planParts(img.width / viewportW);
  const s = job.scale;
  const { dy, dh } = Web2pdf.tileDrawRect(destY, clip.h, s);
  const sx = Math.round(clip.x * s);
  const sy = Math.round(clip.y * s);
  const sw = Math.min(Math.round(clip.w * s), img.width - sx);
  const sh = Math.min(Math.round(clip.h * s), img.height - sy);
  for (const part of job.parts) {
    if (part.done || destY >= part.end || destY + clip.h <= part.start) continue;
    if (!part.strips) allocate(part);
    for (const strip of part.strips) {
      if (destY >= strip.end || destY + clip.h <= strip.start) continue;
      strip.ctx.drawImage(img, sx, sy, sw, sh, 0, dy - Math.round(strip.start * s), strip.canvas.width, dh);
    }
  }
  img.close();
  // 之后的块都在这块下面，已经画满的段可以先编码释放
  for (const part of job.parts) {
    if (part.strips && !part.done && part.end <= destY + clip.h) await finishPart(part);
  }
  return liveStrips();
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败'))), type, quality));
}

async function encodePart(part) {
  const { format, width } = job;
  if (format === 'png') return toBlob(part.strips[0].canvas, 'image/png');
  if (format === 'jpeg') return toBlob(part.strips[0].canvas, 'image/jpeg', JPEG_QUALITY);
  const wPt = width * PT_PER_CSS_PX;
  const hPt = (part.end - part.start) * PT_PER_CSS_PX;
  const pdf = new jspdf.jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'l' : 'p', compress: true });
  for (const strip of part.strips) {
    pdf.addImage(strip.canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG',
      0, (strip.start - part.start) * PT_PER_CSS_PX, wPt, (strip.end - strip.start) * PT_PER_CSS_PX);
  }
  return pdf.output('blob');
}

async function finishPart(part) {
  const blob = await encodePart(part);
  part.strips.forEach((st) => { st.canvas.width = st.canvas.height = 0; });
  part.strips = [];
  part.done = true;
  job.files.push({ index: part.index, url: URL.createObjectURL(blob) });
}

async function end() {
  if (!job || !job.parts) throw new Error('没有截到任何内容');
  for (const part of job.parts) {
    if (part.strips && !part.done) await finishPart(part);
  }
  const single = job.parts.length === 1;
  const files = job.files.map((f) => ({ url: f.url, part: single ? null : f.index + 1 }));
  job = null;
  return files;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'w2p:compose-begin': begin(msg); return { ok: true };
      case 'w2p:compose-tile': return { ok: true, live: await addTile(msg) };
      case 'w2p:compose-end': return { ok: true, files: await end() };
      case 'w2p:revoke': msg.urls.forEach((u) => URL.revokeObjectURL(u)); return { ok: true };
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});
