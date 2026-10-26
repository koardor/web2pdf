// 拼接截图、按上限拆分、编码为 PNG / JPEG / PDF
const JPEG_QUALITY = 0.92;
const PT_PER_CSS_PX = 0.75;

let job = null;

function begin({ width, height, format }) {
  job = { width, height, format, scale: null, parts: null };
}

// 收到第一块后才知道真实缩放比例，再分配画布
function allocate(scale) {
  const { width, height, format } = job;
  const W = Web2pdf;
  const stripCss = Math.floor(W.MAX_CANVAS_PX / scale);
  job.scale = scale;
  job.parts = W.planSplits(height, W.splitLimitCss(format, scale)).map(({ start, end }) => {
    const strips = [];
    for (let s = start; s < end; s += stripCss) {
      const e = Math.min(end, s + stripCss);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(e * scale) - Math.round(s * scale);
      const ctx = canvas.getContext('2d');
      if (format === 'jpeg' || format === 'pdf') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      strips.push({ start: s, end: e, canvas, ctx });
    }
    return { start, end, strips };
  });
}

async function addTile({ dataUrl, clip, destY, viewportW }) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  if (!job.parts) allocate(img.naturalWidth / viewportW);
  const s = job.scale;
  const { dy, dh } = Web2pdf.tileDrawRect(destY, clip.h, s);
  const sx = Math.round(clip.x * s);
  const sy = Math.round(clip.y * s);
  const sw = Math.min(Math.round(clip.w * s), img.naturalWidth - sx);
  const sh = Math.min(Math.round(clip.h * s), img.naturalHeight - sy);
  for (const part of job.parts) {
    for (const strip of part.strips) {
      if (destY >= strip.end || destY + clip.h <= strip.start) continue;
      const top = dy - Math.round(strip.start * s);
      strip.ctx.drawImage(img, sx, sy, sw, sh, 0, top, strip.canvas.width, dh);
    }
  }
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

async function end() {
  if (!job || !job.parts) throw new Error('没有截到任何内容');
  const single = job.parts.length === 1;
  const files = [];
  for (let i = 0; i < job.parts.length; i++) {
    const blob = await encodePart(job.parts[i]);
    files.push({ url: URL.createObjectURL(blob), part: single ? null : i + 1 });
    job.parts[i].strips.forEach((st) => { st.canvas.width = st.canvas.height = 0; });
  }
  job = null;
  return files;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'w2p:compose-begin': begin(msg); return { ok: true };
      case 'w2p:compose-tile': await addTile(msg); return { ok: true };
      case 'w2p:compose-end': return { ok: true, files: await end() };
      case 'w2p:revoke': msg.urls.forEach((u) => URL.revokeObjectURL(u)); return { ok: true };
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});
