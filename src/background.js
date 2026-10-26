// 截图任务的调度入口：注入页面脚本 → 用户选择 → 逐块滚动截图 → offscreen 拼接 → 下载
importScripts('lib/filename.js', 'lib/tiles.js', 'lib/urls.js');

const CONTENT_FILES = ['src/lib/tiles.js', 'src/content/agent.js', 'src/content/region.js', 'src/content/element.js'];
const CAPTURE_INTERVAL_MS = 550;   // captureVisibleTab 每秒最多 2 次
const KEEPALIVE_MS = 20000;
const BADGE_MS = 3000;
const EXT = { pdf: 'pdf', png: 'png', jpeg: 'jpg' };

let busy = false;
let lastCaptureAt = 0;
const pendingRevokes = new Map();   // downloadId → blob URL

const isUnsupportedUrl = (url) => Web2pdf.isUnsupportedUrl(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function injectAgent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

async function toTab(tabId, msg) {
  const res = await chrome.tabs.sendMessage(tabId, msg);
  if (!res?.ok && !res?.cancelled) throw new Error(res?.error || `${msg.type} 失败`);
  return res;
}

async function toOffscreen(msg) {
  const res = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  if (!res?.ok) throw new Error(res?.error || `${msg.type} 失败`);
  return res;
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['BLOBS'],
    justification: 'stitch screenshots into PNG/JPEG/PDF files',
  });
}

async function captureThrottled(windowId) {
  const wait = lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function flagError(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
    await chrome.action.setBadgeText({ text: '!', tabId });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), BADGE_MS);
  } catch (_) { /* 标签已关闭 */ }
}

// 截图期间标签被关闭、跳转或切走时中止
function watchTab(tabId) {
  const state = { aborted: false };
  const onRemoved = (id) => { if (id === tabId) state.aborted = true; };
  const onUpdated = (id, info) => {
    // 只认真正的跳转；滚动时改 hash / replaceState 的页面不应中止
    if (id === tabId && info.status === 'loading') state.aborted = true;
  };
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.tabs.onUpdated.addListener(onUpdated);
  state.stop = () => {
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  };
  return state;
}

async function startCapture(tabId, mode, format) {
  if (busy) return;
  busy = true;
  const keepalive = setInterval(() => chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);
  const watch = watchTab(tabId);
  const startedAt = new Date();
  let selected = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isUnsupportedUrl(tab.url)) throw new Error('unsupported');
    await injectAgent(tabId);

    const sel = await toTab(tabId, { type: 'w2p:select', mode });
    if (sel.cancelled) return;
    selected = true;
    const { tiles, width, height, viewportW } = sel.job;

    await ensureOffscreen();
    await toOffscreen({ type: 'w2p:compose-begin', width, height, format });
    for (let i = 0; i < tiles.length; i++) {
      if (watch.aborted) throw new Error('aborted');
      await toTab(tabId, { type: 'w2p:step', index: i });
      const current = await chrome.tabs.get(tabId);
      if (!current.active || watch.aborted) throw new Error('aborted');
      const dataUrl = await captureThrottled(tab.windowId);
      await toOffscreen({ type: 'w2p:compose-tile', dataUrl, clip: tiles[i].clip, destY: tiles[i].destY, viewportW });
      if (tiles.length > 1) await toTab(tabId, { type: 'w2p:progress', done: i + 1, total: tiles.length });
    }
    await toTab(tabId, { type: 'w2p:restore' });
    selected = false;

    const { files } = await toOffscreen({ type: 'w2p:compose-end' });
    if (watch.aborted) {
      await toOffscreen({ type: 'w2p:revoke', urls: files.map((f) => f.url) });
      throw new Error('aborted');
    }
    for (const f of files) {
      const filename = Web2pdf.buildFilename({ title: tab.title, url: tab.url, date: startedAt, ext: EXT[format], part: f.part });
      const id = await chrome.downloads.download({ url: f.url, filename, saveAs: false, conflictAction: 'uniquify' });
      pendingRevokes.set(id, f.url);
    }
  } catch (e) {
    console.warn('web2pdf capture failed:', e);
    if (selected) await chrome.tabs.sendMessage(tabId, { type: 'w2p:restore' }).catch(() => {});
    await flagError(tabId);
  } finally {
    watch.stop();
    clearInterval(keepalive);
    busy = false;
  }
}

chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!state || !pendingRevokes.has(id)) return;
  if (state.current !== 'complete' && state.current !== 'interrupted') return;
  const url = pendingRevokes.get(id);
  pendingRevokes.delete(id);
  toOffscreen({ type: 'w2p:revoke', urls: [url] }).catch(() => {});
});

// 快捷键：用上次在弹出菜单里选的格式
const COMMAND_MODES = {
  'capture-visible': 'visible',
  'capture-page': 'page',
  'capture-region': 'region',
  'capture-element': 'element',
};

chrome.commands.onCommand.addListener(async (command, tab) => {
  const mode = COMMAND_MODES[command];
  if (!mode) return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target) return;
  const { format = 'pdf' } = await chrome.storage.local.get('format');
  startCapture(target.id, mode, format);
});

// 弹出菜单：先确认页面可截，再回复让菜单关闭，然后开始任务
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'w2p:start') return;
  (async () => {
    if (busy) return { ok: false, error: 'busy' };
    const tab = await chrome.tabs.get(msg.tabId);
    if (isUnsupportedUrl(tab.url)) return { ok: false, error: 'unsupported' };
    try {
      await injectAgent(msg.tabId);
    } catch (_) {
      return { ok: false, error: 'unsupported' };
    }
    startCapture(msg.tabId, msg.mode, msg.format);
    return { ok: true };
  })().then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});
