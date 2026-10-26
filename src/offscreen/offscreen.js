// 两步：
// 1. 拼接：截图块按 destY 从上到下到达，画进一段段画布（每段不超过单张 canvas 上限），
//    段画满就存成无损 PNG 并释放画布 —— 这些段既用于预览，也是第 2 步的原料。
// 2. 编码：按选定格式的上限拆分，逐段把像素行原样复制进输出画布，编码成 PNG / JPEG / PDF。
const JPEG_QUALITY = 0.92;
const PT_PER_CSS_PX = 0.75;

let job = null;

function begin({ width, height }) {
  job = { width, height, scale: null, segs: null };
}

function newCanvas(width, rows, opaque) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, rows);
  }
  return { canvas, ctx };
}

function free(canvas) {
  canvas.width = canvas.height = 0;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败'))), type, quality));
}

// createImageBitmap 不依赖页面渲染；img.decode() 在从不渲染的 offscreen 文档里可能一直不返回
async function loadBitmap(url) {
  return createImageBitmap(await (await fetch(url)).blob());
}

function liveSegments() {
  return job.segs ? job.segs.filter((g) => g.canvas && !g.url).length : 0;
}

async function addTile({ dataUrl, clip, destY, viewportW }) {
  const img = await loadBitmap(dataUrl);
  if (!job.segs) {
    job.scale = img.width / viewportW;
    job.segs = Web2pdf.planSegments(job.height, job.scale).map((g) => ({ ...g, canvas: null, ctx: null, url: null }));
  }
  const s = job.scale;
  const { dy, dh } = Web2pdf.tileDrawRect(destY, clip.h, s);
  const sx = Math.round(clip.x * s);
  const sy = Math.round(clip.y * s);
  const sw = Math.min(Math.round(clip.w * s), img.width - sx);
  const sh = Math.min(Math.round(clip.h * s), img.height - sy);
  for (const seg of job.segs) {
    if (seg.url || destY >= seg.end || destY + clip.h <= seg.start) continue;
    if (!seg.canvas) {
      Object.assign(seg, newCanvas(Math.round(job.width * s), Math.round(seg.end * s) - Math.round(seg.start * s), false));
    }
    seg.ctx.drawImage(img, sx, sy, sw, sh, 0, dy - Math.round(seg.start * s), seg.canvas.width, dh);
  }
  img.close();
  // 之后的块都在这块下面，画满的段先存起来
  for (const seg of job.segs) {
    if (seg.canvas && !seg.url && seg.end <= destY + clip.h) await sealSegment(seg);
  }
  return liveSegments();
}

async function sealSegment(seg) {
  seg.url = URL.createObjectURL(await toBlob(seg.canvas, 'image/png'));
  free(seg.canvas);
  seg.canvas = seg.ctx = null;
}

async function end() {
  if (!job || !job.segs) throw new Error('没有截到任何内容');
  for (const seg of job.segs) {
    if (seg.canvas && !seg.url) await sealSegment(seg);
  }
  const result = {
    width: job.width,
    height: job.height,
    scale: job.scale,
    segments: job.segs.filter((g) => g.url).map(({ start, end: e, url }) => ({ start, end: e, url })),
  };
  job = null;
  return result;
}

// 把与输出条重叠的各段像素行复制进去
async function fillStrip(strip, segments, scale, cache) {
  for (const seg of segments) {
    const c = Web2pdf.copyRows(strip, seg, scale);
    if (!c) continue;
    if (cache.url !== seg.url) {
      cache.bmp?.close();
      cache.bmp = await loadBitmap(seg.url);
      cache.url = seg.url;
    }
    strip.ctx.drawImage(cache.bmp, 0, c.srcY, cache.bmp.width, c.rows, 0, c.dstY, strip.canvas.width, c.rows);
  }
}

async function encode({ width, height, scale, segments, format }) {
  const stripCss = Math.floor(Web2pdf.MAX_CANVAS_PX / scale);
  const parts = Web2pdf.planSplits(height, Web2pdf.splitLimitCss(format, scale));
  const cache = { url: null, bmp: null };
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const strips = [];
    for (let s = part.start; s < part.end; s += stripCss) {
      const e = Math.min(part.end, s + stripCss);
      const strip = { start: s, end: e, ...newCanvas(Math.round(width * scale), Math.round(e * scale) - Math.round(s * scale), format !== 'png') };
      await fillStrip(strip, segments, scale, cache);
      strips.push(strip);
    }
    let blob;
    if (format === 'png') blob = await toBlob(strips[0].canvas, 'image/png');
    else if (format === 'jpeg') blob = await toBlob(strips[0].canvas, 'image/jpeg', JPEG_QUALITY);
    else {
      const wPt = width * PT_PER_CSS_PX;
      const hPt = (part.end - part.start) * PT_PER_CSS_PX;
      const pdf = new jspdf.jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'l' : 'p', compress: true });
      for (const st of strips) {
        pdf.addImage(st.canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG',
          0, (st.start - part.start) * PT_PER_CSS_PX, wPt, (st.end - st.start) * PT_PER_CSS_PX);
      }
      blob = pdf.output('blob');
    }
    strips.forEach((st) => free(st.canvas));
    files.push({ url: URL.createObjectURL(blob), part: parts.length === 1 ? null : i + 1 });
  }
  cache.bmp?.close();
  return files;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'w2p:compose-begin': begin(msg); return { ok: true };
      case 'w2p:compose-tile': return { ok: true, live: await addTile(msg) };
      case 'w2p:compose-end': return { ok: true, ...(await end()) };
      case 'w2p:encode': return { ok: true, files: await encode(msg) };
      case 'w2p:revoke': msg.urls.forEach((u) => URL.revokeObjectURL(u)); return { ok: true };
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});
