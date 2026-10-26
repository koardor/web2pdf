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
    await toOffscreen({ type: 'w2p:compose-begin', width, height });
    for (let i = 0; i < tiles.length; i++) {
      if (watch.aborted) throw new Error('aborted');
      const stepped = await toTab(tabId, { type: 'w2p:step', index: i });
      const current = await chrome.tabs.get(tabId);
      if (!current.active || watch.aborted) throw new Error('aborted');
      const dataUrl = await captureThrottled(tab.windowId);
      await toOffscreen({ type: 'w2p:compose-tile', dataUrl, clip: stepped.clip || tiles[i].clip, destY: tiles[i].destY, viewportW });
      if (tiles.length > 1) await toTab(tabId, { type: 'w2p:progress', done: i + 1, total: tiles.length });
    }
    await toTab(tabId, { type: 'w2p:restore' });
    selected = false;

    const { ok, ...composed } = await toOffscreen({ type: 'w2p:compose-end' });
    if (watch.aborted) {
      await revokeSegments(composed);
      throw new Error('aborted');
    }
    const shot = { tabId, windowId: tab.windowId, mode, format, title: tab.title, url: tab.url, startedAt: startedAt.getTime(), composed };
    const { preview = true } = await chrome.storage.local.get('preview');
    if (preview) await openPreview(shot, tab);
    else await saveShot(shot, format);
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

function revokeSegments(composed) {
  return toOffscreen({ type: 'w2p:revoke', urls: composed.segments.map((g) => g.url) }).catch(() => {});
}

// 按选定格式编码并下载；拼接的中间段随后释放
async function saveShot(shot, format) {
  const { files } = await toOffscreen({ type: 'w2p:encode', ...shot.composed, format });
  for (const f of files) {
    const filename = Web2pdf.buildFilename({ title: shot.title, url: shot.url, date: new Date(shot.startedAt), ext: EXT[format], part: f.part });
    const id = await chrome.downloads.download({ url: f.url, filename, saveAs: false, conflictAction: 'uniquify' });
    pendingRevokes.set(id, f.url);
  }
  await revokeSegments(shot.composed);
}

// 预览：截图信息存在 storage.session（后台进程休眠重启后仍在），预览页按 id 读取
const sessionKey = (id) => `preview:${id}`;

async function openPreview(shot, tab) {
  const id = `${shot.startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const page = await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/preview/preview.html?id=${id}`),
    index: tab.index + 1,
    openerTabId: tab.id,
  });
  await chrome.storage.session.set({ [sessionKey(id)]: { ...shot, id, previewTabId: page.id } });
}

async function takeShot(id) {
  const key = sessionKey(id);
  const shot = (await chrome.storage.session.get(key))[key];
  if (shot) await chrome.storage.session.remove(key);
  return shot;
}

async function onPreviewMessage(msg, previewTabId) {
  const shot = await takeShot(msg.id);
  if (!shot) return { ok: false, error: 'expired' };
  if (msg.type === 'w2p:save') {
    await saveShot(shot, msg.format);
    await chrome.storage.local.set({ format: msg.format });
  } else {
    await revokeSegments(shot.composed);
  }
  await chrome.tabs.remove(previewTabId).catch(() => {});
  if (msg.type === 'w2p:retake') {
    await chrome.tabs.update(shot.tabId, { active: true });
    await chrome.windows.update(shot.windowId, { focused: true }).catch(() => {});
    startCapture(shot.tabId, shot.mode, shot.format);
  }
  return { ok: true };
}

// 预览标签被直接关掉：释放中间段
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const all = await chrome.storage.session.get(null);
  for (const shot of Object.values(all)) {
    if (shot?.previewTabId === tabId) {
      await chrome.storage.session.remove(sessionKey(shot.id));
      await revokeSegments(shot.composed);
    }
  }
});

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
const PREVIEW_MESSAGES = ['w2p:save', 'w2p:discard', 'w2p:retake'];

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!PREVIEW_MESSAGES.includes(msg?.type)) return;
  onPreviewMessage(msg, sender.tab?.id).then(reply, (e) => {
    console.warn('web2pdf preview action failed:', e);
    reply({ ok: false, error: String(e?.message || e) });
  });
  return true;
});

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
