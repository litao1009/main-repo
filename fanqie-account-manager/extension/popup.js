const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// 轮询抓取状态（每秒刷新一次，Service Worker 存活时有效）
function refreshStatus() {
  chrome.storage.local.get(['captureActive', 'captureMessage'], (result) => {
    if (result.captureActive) {
      statusBar.className = 'status-bar status-active';
      statusDot.className = 'status-dot dot-active';
      statusText.textContent = result.captureMessage || '正在抓取中...';
    } else {
      statusBar.className = 'status-bar status-idle';
      statusDot.className = 'status-dot dot-idle';
      statusText.textContent = '就绪';
    }
  });
}

refreshStatus();
const timer = setInterval(refreshStatus, 1000);
window.addEventListener('unload', () => clearInterval(timer));
