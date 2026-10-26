// 在普通测试页里模拟扩展环境：桩 chrome.runtime，按顺序加载 content scripts。
// 用法（浏览器控制台）：await import('/test/harness/inject.js'); await w2pSend({type:'w2p:select', mode:'page'})
const listeners = [];
window.chrome = window.chrome || {};
window.chrome.runtime = { onMessage: { addListener: (fn) => listeners.push(fn) } };
window.w2pSend = (msg) => new Promise((resolve) => {
  const handled = listeners.some((fn) => fn(msg, {}, resolve) === true);
  if (!handled) resolve(undefined);
});
// 隐藏的浏览器面板里 requestAnimationFrame 不触发，这里退化为定时器（只影响测试页）
const rafWorks = await Promise.race([
  new Promise((r) => requestAnimationFrame(() => r(true))),
  new Promise((r) => setTimeout(() => r(false), 200)),
]);
if (!rafWorks) window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
for (const src of ['/src/lib/tiles.js', '/src/content/agent.js', '/src/content/region.js', '/src/content/element.js']) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${src}?t=${Date.now()}`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
