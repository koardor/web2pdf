const test = require('node:test');
const assert = require('node:assert');
const { isUnsupportedUrl } = require('../../src/lib/urls.js');

test('browser pages unsupported', () => {
  for (const u of ['edge://extensions/', 'chrome://settings', 'about:blank', 'view-source:https://a.com',
    'chrome-extension://abc/x.html', 'extension://abc/x.html',
    'https://microsoftedge.microsoft.com/addons/detail/x', 'https://chromewebstore.google.com/detail/x', '', undefined]) {
    assert.strictEqual(isUnsupportedUrl(u), true, String(u));
  }
});
test('normal pages supported', () => {
  for (const u of ['https://example.com/', 'http://localhost:8000/test/pages/short.html', 'file:///D:/a.html']) {
    assert.strictEqual(isUnsupportedUrl(u), false, u);
  }
});
