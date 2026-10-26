// 弹出菜单：选择截图方式和格式
const MESSAGES = {
  unsupported: '此页面不支持截图',
  busy: '正在截图，请稍候',
};

function showMessage(text) {
  const p = document.querySelector('.msg');
  p.textContent = text;
  p.hidden = false;
}

async function init() {
  const { format = 'pdf' } = await chrome.storage.local.get('format');
  document.querySelector(`input[value="${format}"]`).checked = true;
  document.querySelectorAll('input[name="format"]').forEach((input) =>
    input.addEventListener('change', () => chrome.storage.local.set({ format: input.value })));

  document.querySelectorAll('button[data-mode]').forEach((btn) => btn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const format = document.querySelector('input[name="format"]:checked').value;
    const res = await chrome.runtime.sendMessage({ type: 'w2p:start', mode: btn.dataset.mode, format, tabId: tab.id });
    if (res?.ok) window.close();
    else showMessage(MESSAGES[res?.error] || `截图失败：${res?.error || '未知错误'}`);
  }));
}

init();
