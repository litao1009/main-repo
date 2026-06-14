// background.js — 铸文坊账号管家 Service Worker
// 支持平台：fanqie（番茄小说）、qimao（七猫）、zhulang（逐浪网）
// 负责：清除旧登录态 → 新建窗口打开登录页 → 监听 URL 跳转 → 抓取 Cookie → 获取用户名 → 结果回传前端

// ─────────────────────────────────────────────
// 平台配置表
// ─────────────────────────────────────────────
const PLATFORM_CONFIG = {
  fanqie: {
    domains: [
      '.fanqienovel.com',
      'fanqienovel.com',
      '.snssdk.com',
      '.bytedance.com',
      'passport.bytedance.com',
    ],
    clearOrigins: [
      'https://fanqienovel.com',
      'https://www.fanqienovel.com',
      'https://sso.snssdk.com',
      'https://passport.bytedance.com',
      'https://snssdk.com',
      'https://bytedance.com',
      'https://accounts.bytedance.com',
      'https://login.bytedance.com',
    ],
    loginUrl: 'https://fanqienovel.com/main/writer/login',
    writerUrl: 'https://fanqienovel.com/main/writer/',
    injectDomain: '.fanqienovel.com',
    injectUrl: 'https://fanqienovel.com',
    // 判断当前 URL 是否属于该平台（用于登录成功检测）
    isSiteDomain: (url) => url.includes('fanqienovel.com'),
    loginPendingMessage: '请在打开的番茄小说页面完成手机验证码登录...',
  },
  qimao: {
    domains: [
      '.qimao.com',
      'qimao.com',
      'zuozhe.qimao.com',
    ],
    clearOrigins: [
      'https://zuozhe.qimao.com',
      'https://qimao.com',
      'https://www.qimao.com',
    ],
    loginUrl: 'https://zuozhe.qimao.com/front/register-login/login',
    writerUrl: 'https://zuozhe.qimao.com/front/index',
    profileUrl: 'https://zuozhe.qimao.com/api/author/profile',
    injectDomain: '.qimao.com',
    injectUrl: 'https://zuozhe.qimao.com',
    isSiteDomain: (url) => url.includes('qimao.com'),
    isLoginPage: (url) => /register-login/i.test(url),
    isLoggedInUrl: (url) => /zuozhe\.qimao\.com\/front\/index\b/i.test(url),
    loginPendingMessage: '请在打开的七猫作家页面完成登录...',
  },
  zhulang: {
    domains: [
      '.zhulang.com',
      'www.zhulang.com',
      'writer.zhulang.com',
    ],
    clearOrigins: [
      'https://www.zhulang.com',
      'https://zhulang.com',
      'https://writer.zhulang.com',
    ],
    loginUrl: 'https://www.zhulang.com/login/index.html',
    writerUrl: 'https://writer.zhulang.com/author/index.html',
    injectDomain: '.zhulang.com',
    injectUrl: 'https://www.zhulang.com',
    isSiteDomain: (url) => url.includes('zhulang.com'),
    loginPendingMessage: '请在打开的逐浪网页面完成登录...',
  },
};

// 登录成功后页面会离开 /login 路径
const LOGIN_PAGE_PATTERN = /\/login/i;

// 番茄：等待用户开通作者身份（轮询 account/info）
const AUTHOR_POLL_INTERVAL_MS = 5000;
const AUTHOR_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

// 运行时状态（Service Worker 存活期内有效）
let state = {
  active: false,
  platform: 'fanqie',
  captureMode: 'bind',
  managementTabId: null,
  targetTabId: null,
  targetWinId: null,
};
let cookieListener = null;
let timeoutHandle = null;
let pollHandle = null;
let authorPollHandle = null;
let authorWaitStartedAt = 0;

// ─────────────────────────────────────────────
// 消息入口
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FANQIE_CAPTURE_START') {
    handleStartCapture(sender.tab.id, msg.platform || 'fanqie', msg.mode || 'bind');
    sendResponse({ ok: true });
  } else if (msg.type === 'FANQIE_MANUAL_CAPTURE') {
    if (state.active) pollAuthorOnceAndMaybeFinish(true);
    sendResponse({ ok: true });
  } else if (msg.type === 'FANQIE_CAPTURE_CANCEL') {
    if (state.active) doCancel('已取消绑定流程');
    sendResponse({ ok: true });
  } else if (msg.type === 'FANQIE_INJECT_COOKIES') {
    handleInjectCookies(msg.cookieStr, msg.platform || 'fanqie', sender.tab.id);
    sendResponse({ ok: true });
  }
  return true;
});

// ─────────────────────────────────────────────
// Step 1：开始抓取流程
// ─────────────────────────────────────────────
async function handleStartCapture(managementTabId, platform, captureMode = 'bind') {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.fanqie;

  if (state.active) {
    sendToTab(managementTabId, {
      type: 'FANQIE_CAPTURE_STATUS',
      status: 'busy',
      message: '已有抓取任务进行中，请等待当前流程完成',
    });
    return;
  }

  if (cfg.openOnly) {
    await handleOpenLoginOnly(managementTabId, cfg);
    return;
  }

  state = { active: true, platform, captureMode, managementTabId, targetTabId: null, targetWinId: null };
  loginDetected = false;

  sendToTab(managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'clearing',
    message: '正在清除旧登录态...',
  });

  // browsingData.remove 清除 localStorage 等
  try {
    await chrome.browsingData.remove(
      { origins: cfg.clearOrigins },
      { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true }
    );
  } catch (e) {
    console.warn('[Ext] browsingData.remove error:', e);
  }

  // cookies API 逐条删除，覆盖跨子域漏删的情况
  for (const domain of cfg.domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[Ext] cookies.remove(${domain}) error:`, e);
    }
  }

  sendToTab(managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'login_pending',
    message: cfg.loginPendingMessage,
  });

  const win = await chrome.windows.create({
    url: cfg.loginUrl,
    type: 'normal',
    focused: true,
    width: 1024,
    height: 768,
  });
  state.targetTabId = win.tabs?.[0]?.id ?? null;
  state.targetWinId = win.id ?? null;

  startLoginMonitor();

  timeoutHandle = setTimeout(() => {
    if (state.active) doCancel('等待登录超时（5 分钟），请重新操作');
  }, 5 * 60 * 1000);
}

/** 七猫等尚未接入抓取的平台：只打开登录页，不监听、不关窗、不抓 Cookie */
async function handleOpenLoginOnly(managementTabId, cfg) {
  sendToTab(managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'window_opened',
    message: cfg.loginPendingMessage,
  });

  await chrome.windows.create({
    url: cfg.loginUrl,
    type: 'normal',
    focused: true,
    width: 1024,
    height: 768,
  });
}

// ─────────────────────────────────────────────
// Step 2：监听 Tab URL 变化，检测登录成功
// 双重保障：chrome.tabs.onUpdated 事件 + 每 2 秒轮询
// ─────────────────────────────────────────────
function startLoginMonitor() {
  cookieListener = (tabId, changeInfo, tab) => {
    if (!state.active) return;
    if (tabId !== state.targetTabId) return;
    const url = changeInfo.url || (changeInfo.status === 'complete' ? tab.url : '');
    if (!url) return;
    checkLoginSuccess(url);
  };
  chrome.tabs.onUpdated.addListener(cookieListener);

  pollHandle = setInterval(async () => {
    if (!state.active || !state.targetTabId) return;
    try {
      const tab = await chrome.tabs.get(state.targetTabId);
      if (tab?.url) checkLoginSuccess(tab.url);
    } catch (_) {}
  }, 2000);
}

let loginDetected = false;
function checkLoginSuccess(url) {
  if (!state.active || loginDetected) return;
  const cfg = PLATFORM_CONFIG[state.platform] || PLATFORM_CONFIG.fanqie;
  const isSite = cfg.isSiteDomain(url);

  let loggedIn = false;
  if (cfg.isLoggedInUrl) {
    loggedIn = isSite && cfg.isLoggedInUrl(url);
  } else {
    const isLoginPage = cfg.isLoginPage ? cfg.isLoginPage(url) : LOGIN_PAGE_PATTERN.test(url);
    loggedIn = isSite && !isLoginPage;
  }

  if (!loggedIn) return;

  loginDetected = true;
  stopLoginMonitor();

  sendToTab(state.managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'capturing',
    message: state.captureMode === 'relogin'
      ? '检测到登录成功，正在收集 Cookie...'
      : '检测到登录成功，正在获取作者资料...',
  });

  setTimeout(afterLoginDetected, 2000);
}

async function afterLoginDetected() {
  if (!state.active) return;
  const cfg = PLATFORM_CONFIG[state.platform] || PLATFORM_CONFIG.fanqie;

  if (state.platform !== 'fanqie') {
    sendToTab(state.managementTabId, {
      type: 'FANQIE_CAPTURE_STATUS',
      status: 'capturing',
      message: '检测到登录成功，正在收集 Cookie...',
    });
    const delayMs = state.platform === 'qimao' ? 2500 : 2000;
    setTimeout(() => captureCookiesAndFinish(), delayMs);
    return;
  }

  // 重新登录：账号已在系统中，作者身份已开通，登录后直接抓取
  if (state.captureMode === 'relogin') {
    await finishFanqieReloginCapture(cfg);
    return;
  }

  // 首次绑定：等待用户在弹出窗口完成作家入驻
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  timeoutHandle = setTimeout(() => {
    if (state.active) doCancel('等待开通作者超时（15 分钟），请完成作家入驻后重试');
  }, AUTHOR_WAIT_TIMEOUT_MS);

  sendToTab(state.managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'author_pending',
    message: '登录成功！请在弹出窗口完成作家入驻，完成后将自动获取资料',
  });

  try {
    await chrome.tabs.update(state.targetTabId, { url: cfg.writerUrl });
  } catch (e) {
    console.warn('[Ext] navigate to writer failed:', e);
  }

  authorWaitStartedAt = Date.now();
  await pollAuthorOnceAndMaybeFinish(false);
  if (!state.active) return;
  authorPollHandle = setInterval(() => {
    pollAuthorOnceAndMaybeFinish(false);
  }, AUTHOR_POLL_INTERVAL_MS);
}

async function finishFanqieReloginCapture(cfg) {
  sendToTab(state.managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'capturing',
    message: '登录成功，正在收集 Cookie 与作者资料...',
  });

  try {
    await chrome.tabs.update(state.targetTabId, { url: cfg.writerUrl });
  } catch (e) {
    console.warn('[Ext] navigate to writer failed:', e);
  }

  await new Promise((r) => setTimeout(r, 4000));

  let profile = null;
  try {
    profile = await tryFetchFanqieProfile();
  } catch (e) {
    console.warn('[Ext] relogin profile fetch failed:', e);
  }

  await captureCookiesAndFinish(profile);
}

function isFanqieAuthorReady(profile) {
  if (!profile) return false;
  return !!(profile.mp_name || profile.author_name);
}

async function pollAuthorOnceAndMaybeFinish(manual) {
  if (!state.active || state.platform !== 'fanqie') return;

  if (state.captureMode === 'relogin') {
    await finishFanqieReloginCapture(PLATFORM_CONFIG.fanqie);
    return;
  }

  let profile = null;
  try {
    profile = await tryFetchFanqieProfile();
  } catch (e) {
    console.warn('[Ext] author poll failed:', e);
  }

  if (isFanqieAuthorReady(profile)) {
    stopAuthorPoll();
    sendToTab(state.managementTabId, {
      type: 'FANQIE_CAPTURE_STATUS',
      status: 'capturing',
      message: `已检测到作者身份${profile.author_name ? `（${profile.author_name}）` : ''}，正在收集 Cookie...`,
    });
    await captureCookiesAndFinish(profile);
    return;
  }

  const waitedSec = Math.max(0, Math.floor((Date.now() - authorWaitStartedAt) / 1000));
  sendToTab(state.managementTabId, {
    type: 'FANQIE_CAPTURE_STATUS',
    status: 'author_pending',
    message: manual
      ? '尚未检测到作者身份，请继续在弹出窗口完成作家入驻'
      : `等待开通作者身份…（已等待 ${waitedSec} 秒，请勿关闭窗口）`,
  });
}

function stopAuthorPoll() {
  if (authorPollHandle) {
    clearInterval(authorPollHandle);
    authorPollHandle = null;
  }
}

function stopLoginMonitor() {
  if (cookieListener) {
    chrome.tabs.onUpdated.removeListener(cookieListener);
    cookieListener = null;
  }
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

// ─────────────────────────────────────────────
// Step 3：收集 Cookie + 尝试获取用户名 + 回传结果
// ─────────────────────────────────────────────
async function captureCookiesAndFinish(prefetchedProfile = null) {
  if (!state.active) return;

  stopAuthorPoll();
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  const cfg = PLATFORM_CONFIG[state.platform] || PLATFORM_CONFIG.fanqie;

  // 收集所有目标域 Cookie，去重
  const seen = new Set();
  const allCookies = [];
  for (const domain of cfg.domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const key = `${c.name}@${c.domain}`;
        if (!seen.has(key)) {
          seen.add(key);
          allCookies.push(c);
        }
      }
    } catch (e) {
      console.warn(`[Ext] getAll(${domain}) failed:`, e);
    }
  }

  if (allCookies.length === 0) {
    doCancel('未能获取到 Cookie，请重试');
    return;
  }

  const cookieStr = allCookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // 尝试获取作者资料
  let authorProfile = prefetchedProfile;
  let username = null;
  if (state.platform === 'fanqie') {
    try {
      if (!authorProfile) authorProfile = await tryFetchFanqieProfile();
      username = authorProfile?.author_name || null;
      if (state.captureMode !== 'relogin' && !isFanqieAuthorReady(authorProfile)) {
        doCancel('尚未检测到作者身份，请完成作家入驻后重试');
        return;
      }
    } catch (e) {
      console.warn('[Ext] fetchProfile(fanqie) failed:', e);
      doCancel('获取作者资料失败，请重试');
      return;
    }
  } else if (state.platform === 'zhulang') {
    try {
      authorProfile = await tryFetchZhulangProfile();
      username = authorProfile?.author_name || null;
    } catch (e) {
      console.warn('[Ext] fetchProfile(zhulang) failed:', e);
    }
  } else if (state.platform === 'qimao') {
    try {
      authorProfile = await tryFetchQimaoProfile();
      username = authorProfile?.author_name || null;
      if (!username) {
        doCancel('未能获取七猫作者资料，请确认已登录并重试');
        return;
      }
    } catch (e) {
      console.warn('[Ext] fetchProfile(qimao) failed:', e);
      doCancel('获取七猫作者资料失败，请重试');
      return;
    }
  }

  const targetTabId = state.targetTabId;
  const targetWinId = state.targetWinId;
  const managementTabId = state.managementTabId;
  state = { active: false, platform: 'fanqie', captureMode: 'bind', managementTabId: null, targetTabId: null, targetWinId: null };
  loginDetected = false;

  // 抓取完毕后清除浏览器里的平台 Cookie，避免 Vault session 被浏览器操作意外失效
  for (const domain of cfg.domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[Ext] post-capture clear(${domain}) error:`, e);
    }
  }

  sendToTab(managementTabId, {
    type: 'FANQIE_CAPTURE_RESULT',
    cookieStr,
    username,
    phoneNumber: authorProfile?.phone_number || null,
    avatarUrl: authorProfile?.avatar_url || null,
    isAuth: authorProfile?.is_auth ?? null,
    identityCodeMask: authorProfile?.identity_code_mask || null,
    identityNameMask: authorProfile?.identity_name_mask || null,
    cookieCount: allCookies.length,
  });

  if (targetWinId) {
    chrome.windows.remove(targetWinId).catch(() => {});
  } else if (targetTabId) {
    chrome.tabs.remove(targetTabId).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// 辅助：获取番茄作者资料（平台专属）
// ─────────────────────────────────────────────
async function tryFetchFanqieProfile() {
  if (!state.targetTabId) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: state.targetTabId },
      func: async () => {
        const normalizeAvatarUrl = (url) => {
          if (!url || typeof url !== 'string') return null;
          const trimmed = url.trim().replace(/\\u0026/gi, '&').replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>');
          if (!trimmed) return null;
          if (trimmed.includes('fqnovelpic.com')) return trimmed;
          const q = trimmed.search(/[?#]/);
          const pathOnly = q >= 0 ? trimmed.slice(0, q) : trimmed;
          const match = pathOnly.match(/novel-static\/([a-f0-9]+)/i);
          if (match) {
            return `https://p3-novel.byteimg.com/img/novel-static/${match[1].toLowerCase()}~tplv-obj.image`;
          }
          if (pathOnly.includes('byteimg.com')) return pathOnly;
          if (pathOnly.startsWith('/')) return `https://fanqienovel.com${pathOnly}`;
          return trimmed;
        };
        const parseProfile = (data) => {
          if (data?.code !== 0 || !data?.data) return null;
          const d = data.data;
          const parseIsAuth = (v) => {
            if (v === true || v === 1 || v === '1') return true;
            if (v === false || v === 0 || v === '0') return false;
            return false;
          };
          const isAuth = parseIsAuth(d.is_auth);
          return {
            author_name: d.author_name || null,
            mp_name: d.mp_name || null,
            phone_number: d.phone_number || null,
            avatar_url: normalizeAvatarUrl(d.avatar_url),
            is_auth: isAuth,
            identity_code_mask: isAuth ? (d.identity_code_mask || null) : null,
            identity_name_mask: isAuth ? (d.identity_name_mask || null) : null,
          };
        };
        const resources = performance.getEntriesByType('resource');

        for (const entry of resources) {
          if (!entry.name.includes('/api/author/account/info/v0/')) continue;
          try {
            const resp = await fetch(entry.name, { credentials: 'include' });
            if (!resp.ok) continue;
            const profile = parseProfile(await resp.json());
            if (profile) return profile;
          } catch (_) {}
        }

        let aBogus = '';
        for (const entry of resources) {
          if (!entry.name.includes('a_bogus=')) continue;
          const match = entry.name.match(/[?&]a_bogus=([^&]+)/);
          if (match) { aBogus = decodeURIComponent(match[1]); break; }
        }

        try {
          const msToken = localStorage.getItem('xmst') || '';
          const params = new URLSearchParams({ aid: '2503', app_name: 'muye_novel' });
          if (msToken) params.set('msToken', msToken);
          if (aBogus) params.set('a_bogus', aBogus);
          const resp = await fetch(
            `https://fanqienovel.com/api/author/account/info/v0/?${params.toString()}`,
            { credentials: 'include' }
          );
          if (!resp.ok) return null;
          return parseProfile(await resp.json());
        } catch (_) {}

        return null;
      },
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.warn('[Ext] executeScript for fanqie profile failed:', e);
  }

  return null;
}

// ─────────────────────────────────────────────
// 辅助：获取七猫作者资料（/api/author/profile）
// ─────────────────────────────────────────────
const QIMAO_PROFILE_URL = 'https://zuozhe.qimao.com/api/author/profile';

async function tryFetchQimaoProfile() {
  if (!state.targetTabId) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: state.targetTabId },
      func: async (profileUrl) => {
        const parseRealStatus = (v) => v === 1 || v === '1';
        const resp = await fetch(profileUrl, { credentials: 'include' });
        if (!resp.ok) return null;
        const json = await resp.json();
        if (json?.code !== 200 || !json?.data?.user) return null;
        const u = json.data.user;
        const isAuth = parseRealStatus(u.real_status);
        return {
          author_name: u.pen_name || null,
          phone_number: u.phone || null,
          avatar_url: u.avatar || null,
          is_auth: isAuth,
          identity_code_mask: null,
          identity_name_mask: null,
        };
      },
      args: [QIMAO_PROFILE_URL],
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.warn('[Ext] fetchProfile(qimao) failed:', e);
  }

  return null;
}

// ─────────────────────────────────────────────
// 辅助：获取逐浪作者资料（作家资料页 HTML + 内嵌 dftInfoData / zluser）
// ─────────────────────────────────────────────
const ZHULANG_AUTHOR_URL = 'https://writer.zhulang.com/author/index.html';

async function tryFetchZhulangProfile() {
  if (!state.targetTabId) return null;

  try {
    await chrome.tabs.update(state.targetTabId, { url: ZHULANG_AUTHOR_URL });

    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === state.targetTabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    await new Promise((r) => setTimeout(r, 1500));

    const results = await chrome.scripting.executeScript({
      target: { tabId: state.targetTabId },
      world: 'MAIN',
      func: () => {
        const readInputByLabel = (labelText) => {
          const items = document.querySelectorAll('.el-form-item');
          for (const item of items) {
            const label = item.querySelector('.el-form-item__label');
            if (!label?.textContent?.includes(labelText)) continue;
            const input = item.querySelector('input.el-input__inner, textarea.el-input__inner');
            const val = input?.value?.trim();
            if (val) return val;
          }
          return null;
        };

        const info = window.dftInfoData || {};
        const user = window.zluser || {};

        const penname = (info.penname || readInputByLabel('笔名') || document.querySelector('.uinfo em')?.textContent?.trim() || '').trim();
        const phone = (info.phone || readInputByLabel('手机号码') || '').trim();
        const realname = (info.realname || readInputByLabel('姓名') || '').trim();
        const identityCode = (info.ID || readInputByLabel('身份证号') || '').trim();
        const isAuth = !!(realname && identityCode);

        if (!penname && !phone && !user.uid) return null;

        return {
          author_name: penname || null,
          mp_name: user.uid ? String(user.uid) : null,
          phone_number: phone || null,
          avatar_url: user.avatar || null,
          is_auth: isAuth,
          identity_name_mask: isAuth ? realname : null,
          identity_code_mask: isAuth ? identityCode : null,
        };
      },
    });

    return results?.[0]?.result || null;
  } catch (e) {
    console.warn('[Ext] fetchZhulangProfile failed:', e);
  }

  return null;
}

// ─────────────────────────────────────────────
// 辅助：获取逐浪作者名（兼容旧逻辑，已弃用）
// ─────────────────────────────────────────────
async function tryFetchZhulangUsername() {
  const profile = await tryFetchZhulangProfile();
  return profile?.author_name || null;
}

// ─────────────────────────────────────────────
// 辅助：取消并通知
// ─────────────────────────────────────────────
function doCancel(reason) {
  stopLoginMonitor();
  stopAuthorPoll();
  if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
  loginDetected = false;

  const managementTabId = state.managementTabId;
  const targetTabId = state.targetTabId;
  const targetWinId = state.targetWinId;
  state = { active: false, platform: 'fanqie', captureMode: 'bind', managementTabId: null, targetTabId: null, targetWinId: null };

  if (targetWinId) {
    chrome.windows.remove(targetWinId).catch(() => {});
  } else if (targetTabId) {
    chrome.tabs.remove(targetTabId).catch(() => {});
  }
  if (managementTabId) {
    sendToTab(managementTabId, { type: 'FANQIE_CAPTURE_ERROR', message: reason });
  }
}

function sendToTab(tabId, msg) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg).catch((e) => {
    console.warn('[Ext] sendMessage to tab failed:', e);
  });
  if (msg.type === 'FANQIE_CAPTURE_STATUS') {
    chrome.storage.local.set({ captureActive: true, captureMessage: msg.message });
  } else if (msg.type === 'FANQIE_CAPTURE_RESULT' || msg.type === 'FANQIE_CAPTURE_ERROR') {
    chrome.storage.local.set({ captureActive: false, captureMessage: '' });
  }
}

// 用户手动关闭了登录窗口 → 取消流程
chrome.windows.onRemoved.addListener((winId) => {
  if (state.active && winId === state.targetWinId) {
    state.targetTabId = null;
    state.targetWinId = null;
    doCancel('登录窗口被关闭，请重新操作');
  }
});

// ─────────────────────────────────────────────
// Cookie 注入：把 Vault 里存的 Cookie 写入浏览器，然后打开目标平台
// ─────────────────────────────────────────────
function parseCookieString(cookieStr) {
  return cookieStr.split(';').map(s => s.trim()).filter(Boolean).map(seg => {
    const idx = seg.indexOf('=');
    if (idx <= 0) return null;
    return { name: seg.slice(0, idx).trim(), value: seg.slice(idx + 1).trim() };
  }).filter(Boolean);
}

async function handleInjectCookies(cookieStr, platform, managementTabId) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.fanqie;

  if (!cookieStr) {
    sendToTab(managementTabId, { type: 'FANQIE_INJECT_ERROR', message: 'Cookie 为空' });
    return;
  }

  sendToTab(managementTabId, { type: 'FANQIE_INJECT_STATUS', message: '正在清除旧登录态...' });

  for (const domain of cfg.domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[Ext] inject clear(${domain}) error:`, e);
    }
  }

  sendToTab(managementTabId, { type: 'FANQIE_INJECT_STATUS', message: '正在注入 Cookie...' });

  const cookies = parseCookieString(cookieStr);
  let successCount = 0;
  for (const { name, value } of cookies) {
    try {
      await chrome.cookies.set({
        url: cfg.injectUrl,
        name,
        value,
        domain: cfg.injectDomain,
        path: '/',
        secure: true,
        sameSite: 'lax',
      });
      successCount++;
    } catch (e) {
      console.warn(`[Ext] set cookie ${name} failed:`, e);
    }
  }

  if (successCount === 0) {
    sendToTab(managementTabId, { type: 'FANQIE_INJECT_ERROR', message: 'Cookie 注入失败，请重试' });
    return;
  }

  sendToTab(managementTabId, { type: 'FANQIE_INJECT_STATUS', message: `已注入 ${successCount} 条 Cookie，正在打开页面...` });
  chrome.tabs.create({ url: cfg.writerUrl, active: true });
  sendToTab(managementTabId, { type: 'FANQIE_INJECT_DONE' });
}
