// 在 Node 里用假的 chrome API 运行 background.js，检查调度流程
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function event() {
  const fns = [];
  return { addListener: (f) => fns.push(f), removeListener: (f) => fns.splice(fns.indexOf(f), 1), fns };
}

function load({ url = 'https://example.com/post?id=1', title = 'Post', tiles = 3, onStep } = {}) {
  const log = [];
  const tab = { id: 7, windowId: 1, url, title, active: true };
  const job = {
    tiles: Array.from({ length: tiles }, (_, i) => ({ pageScroll: i * 100, innerScroll: null, clip: { x: 0, y: 0, w: 10, h: 100 }, destY: i * 100 })),
    width: 10, height: tiles * 100, viewportW: 10,
  };
  const chrome = {
    runtime: {
      onMessage: event(),
      getContexts: async () => [],
      getPlatformInfo: async () => ({}),
      sendMessage: async (msg) => {
        log.push(msg.type);
        if (msg.type === 'w2p:compose-end') return { ok: true, files: [{ url: 'blob:1', part: 1 }, { url: 'blob:2', part: 2 }] };
        return { ok: true };
      },
    },
    offscreen: { createDocument: async () => log.push('createDocument') },
    scripting: {
      executeScript: async () => {
        if (tab.url.startsWith('file:')) throw new Error('Cannot access contents of the page');
        log.push('inject');
      },
    },
    tabs: {
      get: async () => ({ ...tab }),
      query: async () => [tab],
      onRemoved: event(),
      onUpdated: event(),
      sendMessage: async (_id, msg) => {
        log.push(msg.type === 'w2p:step' ? `step${msg.index}` : msg.type);
        if (msg.type === 'w2p:select') return { ok: true, job };
        if (msg.type === 'w2p:step' && onStep) onStep(msg.index, chrome, tab);
        return { ok: true };
      },
      captureVisibleTab: async () => { log.push('capture'); return 'data:image/png;base64,AA=='; },
    },
    downloads: {
      onChanged: event(),
      download: async (opts) => { log.push(['download', opts.filename, opts.saveAs]); return log.length; },
    },
    action: { setBadgeText: async ({ text }) => log.push(['badge', text]), setBadgeBackgroundColor: async () => {} },
    commands: { onCommand: event() },
    storage: { local: { get: async () => ({ format: 'png' }) } },
  };
  const timers = new Set();
  const ctx = {
    chrome, console: { warn: () => {} }, Date, URL,
    setTimeout: (f, ms) => setTimeout(f, ms > 1000 ? 0 : 0),   // 节流等待直接跳过
    setInterval: (f, ms) => { const t = setInterval(f, ms); timers.add(t); return t; },
    clearInterval: (t) => { clearInterval(t); timers.delete(t); },
  };
  ctx.globalThis = ctx;
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx));
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8'), ctx);
  return { ctx, chrome, log, tab };
}

test('capture runs select → step/capture per tile → restore → compose → downloads', async () => {
  const { ctx, log } = load();
  await ctx.startCapture(7, 'page', 'png');
  const flow = log.map((x) => (Array.isArray(x) ? x[0] : x));
  assert.deepStrictEqual(flow, [
    'inject', 'w2p:select', 'createDocument', 'w2p:compose-begin',
    'step0', 'capture', 'w2p:compose-tile', 'w2p:progress',
    'step1', 'capture', 'w2p:compose-tile', 'w2p:progress',
    'step2', 'capture', 'w2p:compose-tile', 'w2p:progress',
    'w2p:restore', 'w2p:compose-end', 'download', 'download',
  ]);
  const names = log.filter((x) => Array.isArray(x) && x[0] === 'download');
  assert.match(names[0][1], /^Post_example\.com_post_id=1_\d{8}-\d{6}_part1\.png$/);
  assert.match(names[1][1], /_part2\.png$/);
  assert.strictEqual(names[0][2], false);
});

test('jpeg format downloads with .jpg extension', async () => {
  const { ctx, log } = load({ tiles: 1 });
  await ctx.startCapture(7, 'visible', 'jpeg');
  assert.match(log.find((x) => Array.isArray(x) && x[0] === 'download')[1], /\.jpg$/);
});

test('unsupported page flags the badge and does nothing else', async () => {
  const { ctx, log } = load({ url: 'edge://extensions/' });
  await ctx.startCapture(7, 'page', 'pdf');
  assert.deepStrictEqual(log, [['badge', '!']]);
});

test('injection failure flags the badge', async () => {
  const { ctx, log } = load({ url: 'file:///D:/a.html' });
  await ctx.startCapture(7, 'page', 'pdf');
  assert.deepStrictEqual(log, [['badge', '!']]);
});

test('navigation mid-capture aborts: no download, page restored, badge shown', async () => {
  const { ctx, log } = load({
    onStep: (i, chrome) => { if (i === 1) chrome.tabs.onUpdated.fns.forEach((f) => f(7, { status: 'loading' })); },
  });
  await ctx.startCapture(7, 'page', 'pdf');
  assert.ok(!log.some((x) => Array.isArray(x) && x[0] === 'download'));
  assert.ok(log.includes('w2p:restore'));
  assert.deepStrictEqual(log.at(-1), ['badge', '!']);
});

test('switching to another tab mid-capture aborts before capturing it', async () => {
  const { ctx, log } = load({ onStep: (i, _c, tab) => { if (i === 1) tab.active = false; } });
  await ctx.startCapture(7, 'page', 'pdf');
  assert.strictEqual(log.filter((x) => x === 'capture').length, 1);
  assert.ok(!log.some((x) => Array.isArray(x) && x[0] === 'download'));
});

test('keyboard command uses the stored format', async () => {
  const { chrome, log } = load({ tiles: 1 });
  await chrome.commands.onCommand.fns[0]('capture-visible', { id: 7 });
  await new Promise((r) => setTimeout(r, 20));
  assert.match(log.find((x) => Array.isArray(x) && x[0] === 'download')[1], /\.png$/);
});

test('popup start replies unsupported for browser pages', async () => {
  const { chrome } = load({ url: 'chrome://settings' });
  const res = await new Promise((resolve) => chrome.runtime.onMessage.fns[0]({ type: 'w2p:start', mode: 'page', format: 'pdf', tabId: 7 }, {}, resolve));
  assert.deepStrictEqual({ ...res }, { ok: false, error: 'unsupported' });
});

test('uses the clip returned by step (actual scroll position)', async () => {
  const { ctx, chrome, log } = load({ tiles: 1 });
  const sent = [];
  const orig = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async (msg) => { if (msg.type === 'w2p:compose-tile') sent.push(msg.clip); return orig(msg); };
  const origTab = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = async (id, msg) => (msg.type === 'w2p:step'
    ? { ok: true, clip: { x: 0, y: 7, w: 10, h: 100 } } : origTab(id, msg));
  await ctx.startCapture(7, 'page', 'png');
  assert.strictEqual(sent[0].y, 7);
  assert.ok(log.length > 0);
});
