(function (root) {
  const MAX_TOTAL_HEIGHT = 100000;   // 截取总高度硬上限（CSS px）
  const MAX_CANVAS_PX = 16384;       // 单张 canvas 高度上限（设备像素）
  const MAX_PDF_CSS = 19200;         // PDF 单页 14,400pt = 19,200 CSS px

  // 沿一个滚动轴把 [top, top+height) 切成若干块，每块在一次截图里可见。
  // startScroll：当前滚动位置；目标顶部已在屏幕上时第一块就用它，不移动页面
  function planTiles({ top, height, viewportHeight, scrollMax, startScroll = null }) {
    const tiles = [];
    const end = top + Math.min(height, MAX_TOTAL_HEIGHT);
    let cursor = top;
    while (cursor < end) {
      const onScreen = startScroll != null && cursor >= startScroll && cursor < startScroll + viewportHeight;
      const scroll = onScreen ? startScroll : Math.max(0, Math.min(cursor, scrollMax));
      const h = Math.min(end, scroll + viewportHeight) - cursor;
      if (h <= 0) break;
      tiles.push({ scroll, offsetInView: cursor - scroll, destY: cursor - top, h });
      cursor += h;
    }
    return tiles;
  }

  // 按上限等高拆分
  function planSplits(total, limit) {
    const n = Math.max(1, Math.ceil(total / limit));
    const size = Math.ceil(total / n);
    const parts = [];
    for (let start = 0; start < total; start += size) {
      parts.push({ start, end: Math.min(total, start + size) });
    }
    return parts.length ? parts : [{ start: 0, end: 0 }];
  }

  function splitLimitCss(format, dpr) {
    return format === 'pdf' ? MAX_PDF_CSS : Math.floor(MAX_CANVAS_PX / dpr);
  }

  function normalizeRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  // 按同一套取整画到成品里，相邻块首尾相接，不留缝
  function tileDrawRect(destY, h, scale) {
    const dy = Math.round(destY * scale);
    return { dy, dh: Math.round((destY + h) * scale) - dy };
  }

  // 拼接中间结果：按单张 canvas 上限依次切成若干段（CSS px）
  function planSegments(height, scale) {
    const size = Math.floor(MAX_CANVAS_PX / scale);
    const segs = [];
    for (let start = 0; start < height; start += size) segs.push({ start, end: Math.min(height, start + size) });
    return segs;
  }

  // 把中间段 seg 里与输出条 strip 重叠的设备像素行原样复制过去；取整规则与 tileDrawRect 一致
  function copyRows(strip, seg, scale) {
    const r = (v) => Math.round(v * scale);
    const from = Math.max(r(strip.start), r(seg.start));
    const to = Math.min(r(strip.end), r(seg.end));
    if (to <= from) return null;
    return { srcY: from - r(seg.start), dstY: from - r(strip.start), rows: to - from };
  }

  const api = { MAX_TOTAL_HEIGHT, MAX_CANVAS_PX, planTiles, planSplits, splitLimitCss, normalizeRect, tileDrawRect, planSegments, copyRows };
  root.Web2pdf = Object.assign(root.Web2pdf || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
