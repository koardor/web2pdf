(function (root) {
  const MAX_TITLE = 50;
  const MAX_URL = 80;
  const MAX_TOTAL = 180;

  // 非法文件名字符、空白、控制字符 → "_"，合并连续 "_"，去掉首尾 "_" 和 "."
  function clean(s) {
    return String(s || '')
      .replace(/[\/:*?"<>|\s\u0000-\u001f]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.]+|[_.]+$/g, '');
  }

  function cut(s, n) {
    return clean(Array.from(s).slice(0, n).join(''));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function stamp(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function buildFilename({ title, url, date, ext, part }) {
    let t = cut(clean(title) || 'untitled', MAX_TITLE) || 'untitled';
    const u = cut(clean(String(url || '').replace(/^https?:\/\//i, '')), MAX_URL);
    const tail = `_${stamp(date)}${part ? `_part${part}` : ''}.${ext}`;
    const mid = u ? `_${u}` : '';
    const room = MAX_TOTAL - mid.length - tail.length;
    if (t.length > room) t = cut(t, Math.max(1, room));
    return `${t}${mid}${tail}`;
  }

  const api = { buildFilename };
  root.Web2pdf = Object.assign(root.Web2pdf || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
