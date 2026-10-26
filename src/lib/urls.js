(function (root) {
  // 浏览器不允许扩展注入脚本的页面
  const BLOCKED_PREFIXES = [
    'edge:', 'chrome:', 'about:', 'view-source:', 'chrome-extension:', 'extension:',
    'https://microsoftedge.microsoft.com/addons', 'https://chromewebstore.google.com',
  ];

  function isUnsupportedUrl(url) {
    if (!url) return true;
    return BLOCKED_PREFIXES.some((p) => url.startsWith(p));
  }

  const api = { isUnsupportedUrl };
  root.Web2pdf = Object.assign(root.Web2pdf || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
