/*
 * xIT - background.
 *
 * Chrome loads this as an MV3 service worker (importScripts below).
 * Firefox loads lib/*.js ahead of it as event-page scripts, so the guard
 * keeps the same file working in both.
 */
'use strict';

if (typeof importScripts === 'function' && !globalThis.XIT) {
  importScripts('lib/redirectors.js', 'lib/storage.js');
}

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
const XIT = globalThis.XIT;
const XITStore = globalThis.XITStore;
XITStore.startWriter();

const MENU_ROOT_LINK = 'xit-link-root';
const MENU_ROOT_PAGE = 'xit-page-root';
const LEGACY_SETTINGS = ['browseRedirect', 'browseRedirectorId', 'browseScope', 'browsePausedUntil'];

const LINK_PATTERNS = [
  '*://x.com/*', '*://www.x.com/*',
  '*://twitter.com/*', '*://www.twitter.com/*',
  '*://mobile.twitter.com/*', '*://m.twitter.com/*',
];

/* -------------------------------------------------------------------- *
 * Context menus
 * -------------------------------------------------------------------- */

function removeAllMenus() {
  // Firefox's browser namespace returns a promise; Chrome 111 needs callbacks.
  if (typeof browser !== 'undefined' && api === browser) return api.contextMenus.removeAll();
  return new Promise((resolve, reject) => {
    api.contextMenus.removeAll(() => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function createMenu(opts) {
  return new Promise((resolve, reject) => {
    api.contextMenus.create(opts, () => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function buildMenus(settings) {
  await removeAllMenus();
  if (!settings.contextMenu) return;

  const list = XITStore.enabledRedirectors(settings);
  if (!list.length) return;

  // On a tweet link anywhere on the web.
  await createMenu({ id: MENU_ROOT_LINK, title: 'xIT', contexts: ['link'], targetUrlPatterns: LINK_PATTERNS });
  await createMenu({ id: 'xit-link-copy-default', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS,
    title: 'Copy as ' + XITStore.defaultRedirector(settings).name });
  await createMenu({ id: 'xit-link-sep1', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, type: 'separator' });

  for (const g of XIT.GROUPS) {
    const inGroup = list.filter((r) => r.group === g.id);
    if (!inGroup.length) continue;
    const groupId = 'xit-link-g-' + g.id;
    await createMenu({ id: groupId, parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: g.label });
    for (const r of inGroup) {
      await createMenu({ id: 'xit-link-copy:' + r.id, parentId: groupId, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Copy as ' + r.name });
      await createMenu({ id: 'xit-link-open:' + r.id, parentId: groupId, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Open with ' + r.name });
    }
  }
  await createMenu({ id: 'xit-link-sep2', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, type: 'separator' });
  await createMenu({ id: 'xit-link-copy-original', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Copy clean x.com link' });
  await createMenu({ id: 'xit-link-open-original', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Open on X' });

  // On the page itself while browsing X.
  await createMenu({ id: MENU_ROOT_PAGE, title: 'xIT', contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS });
  await createMenu({ id: 'xit-page-copy-default', parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS,
    title: 'Copy this page as ' + XITStore.defaultRedirector(settings).name });
  await createMenu({ id: 'xit-page-open-original', parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS, title: 'Open on X' });
  for (const r of list) {
    await createMenu({ id: 'xit-page-open:' + r.id, parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS,
      title: 'Open this page with ' + r.name });
  }
}

/* -------------------------------------------------------------------- *
 * Clipboard
 *
 * A service worker has no DOM, so the write happens in the page. A
 * context-menu click grants activeTab, which is what makes this allowed.
 * -------------------------------------------------------------------- */

function clipboardPayload(text, showToast) {
  const write = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to the textarea route */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  };
  return write().then((ok) => {
    if (showToast) {
      try {
        window.dispatchEvent(new CustomEvent('xit:toast', {
          detail: { text: ok ? 'Copied: ' + text : 'Could not copy', ok },
        }));
      } catch (_) { /* no content script on this page; silent */ }
    }
    return ok;
  });
}

async function copyInTab(tabId, text, showToast) {
  // Prefer the content script: it owns the in-page toast.
  try {
    const res = await api.tabs.sendMessage(tabId, { type: 'xit:copy-text', text });
    if (res && res.ok) return true;
  } catch (_) { /* not injected here */ }

  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: clipboardPayload,
      args: [text, !!showToast],
    });
    return !!(results && results[0] && results[0].result);
  } catch (e) {
    console.warn('[xit] clipboard write failed', e);
    return false;
  }
}

/* -------------------------------------------------------------------- *
 * Menu clicks
 * -------------------------------------------------------------------- */

async function handleMenuClick(info, tab) {
  const settings = await XITStore.load();
  const opts = { stripTracking: settings.stripTracking, extraHosts: XITStore.extraHosts(settings) };
  const target = info.linkUrl || (tab && tab.url) || '';
  const id = String(info.menuItemId || '');

  if (id === 'xit-link-open-original' || id === 'xit-page-open-original') {
    await openOriginal(target, tab);
    return;
  }

  if (id === 'xit-link-copy-original') {
    const clean = XIT.canonical(target, opts);
    if (clean && tab) await copyInTab(tab.id, clean, settings.toast);
    return;
  }

  let action = null;
  let redirectorId = null;
  if (id === 'xit-link-copy-default' || id === 'xit-page-copy-default') {
    action = 'copy';
    redirectorId = settings.defaultRedirector;
  } else {
    const m = /^xit-(?:link|page)-(copy|open):(.+)$/.exec(id);
    if (!m) return;
    action = m[1];
    redirectorId = m[2];
  }

  const redirector = XITStore.findRedirector(settings, redirectorId);
  const out = XIT.convert(target, redirector, opts);
  if (!out.ok) {
    if (tab) await copyInTab(tab.id, target, false).catch(() => {});
    console.warn('[xit]', out.reason);
    return;
  }

  if (action === 'copy') {
    if (tab) await copyInTab(tab.id, out.url, settings.toast);
  } else {
    await api.tabs.create({ url: out.url, index: tab ? tab.index + 1 : undefined, active: true });
  }
}

async function openOriginal(input, tab) {
  const settings = await XITStore.load();
  const url = XIT.canonical(input, { stripTracking: settings.stripTracking, extraHosts: XITStore.extraHosts(settings) });
  if (!url) throw new Error('Open a tweet or paste an X link first.');
  await api.tabs.create({ url, index: tab ? tab.index + 1 : undefined, active: true });
}

// Only fixed status fields enter the report. Do not include raw errors,
// user-agent strings, tab URLs, custom templates, or copied text.
async function diagnostics() {
  await init('diagnostics').catch(() => {});
  const settings = await XITStore.load();
  const report = { extension: 'xIT', version: api.runtime.getManifest().version };
  if (api.runtime.getBrowserInfo) {
    const info = await api.runtime.getBrowserInfo();
    report.browser = info.name + ' ' + info.version;
  } else {
    const match = /(?:Chrome|Chromium)\/([\d.]+)/.exec(globalThis.navigator && navigator.userAgent || '');
    report.browser = match ? 'Chromium ' + match[1] : 'Chromium';
  }
  report.xAccess = await api.permissions.contains({ origins: LINK_PATTERNS }) ? 'granted' : 'incomplete';
  const stored = await api.storage.local.get(['menuError']);
  // Should always be 0. Anything else means the 1.0.7 cleanup did not run.
  const dnr = api.declarativeNetRequest;
  report.legacyRedirectRules = dnr && dnr.getDynamicRules ? (await dnr.getDynamicRules()).length : 0;
  report.contextMenus = stored.menuError ? 'error' : settings.contextMenu ? 'enabled' : 'disabled';
  report.copyButton = settings.copyButton;
  report.nativeCopy = settings.hijackNativeCopy;
  report.contentScript = 'no accessible X tab';
  const tabs = await api.tabs.query({ url: LINK_PATTERNS });
  if (tabs.length) {
    const tab = tabs.find((t) => t.active) || tabs[0];
    try {
      const response = await api.tabs.sendMessage(tab.id, { type: 'xit:ping' });
      report.contentScript = response && response.ok ? 'responding' : 'not responding';
    } catch (_) { report.contentScript = 'not responding'; }
  }
  return report;
}

/* -------------------------------------------------------------------- *
 * Cleanup for page redirecting, removed in 1.0.7
 *
 * Earlier versions installed declarativeNetRequest rules that sent X page
 * loads to a third-party front-end, including ones xIT no longer offers.
 * Dynamic rules survive extension updates, so they are removed on every
 * start. declarativeNetRequest stays in the manifest for this release only,
 * so this can run; drop the permission once users have had time to update.
 * -------------------------------------------------------------------- */

async function clearLegacyRedirects() {
  const dnr = api.declarativeNetRequest;
  if (dnr && dnr.getDynamicRules && dnr.updateDynamicRules) {
    // xIT no longer installs any rules, so every dynamic rule is a leftover.
    const ids = (await dnr.getDynamicRules()).map((r) => r.id);
    if (ids.length) await dnr.updateDynamicRules({ removeRuleIds: ids, addRules: [] });
  }
  // A paused redirect set a toolbar badge.
  if (api.action && api.action.setBadgeText) await api.action.setBadgeText({ text: '' });
  const stored = await api.storage.local.get(['settings', 'dnrStatus', 'dnrError']);
  if (stored.settings && LEGACY_SETTINGS.some((k) => Object.prototype.hasOwnProperty.call(stored.settings, k))) {
    await XITStore.mutate({ type: 'rewrite' });
  }
  if (stored.dnrStatus || stored.dnrError) await api.storage.local.remove(['dnrStatus', 'dnrError']);
}

/* -------------------------------------------------------------------- *
 * Keyboard command
 * -------------------------------------------------------------------- */

async function handleCommand(command, tab) {
  if (command !== 'copy-current-tweet') return;
  const settings = await XITStore.load();
  const active = tab || (await api.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active) return;

  // Let the content script pick the tweet under the cursor / in view.
  try {
    const res = await api.tabs.sendMessage(active.id, { type: 'xit:copy-current' });
    if (res && res.ok) return;
  } catch (_) { /* not on X, or not injected */ }

  const out = XIT.convert(active.url, XITStore.defaultRedirector(settings), {
    stripTracking: settings.stripTracking,
    extraHosts: XITStore.extraHosts(settings),
  });
  if (out.ok) await copyInTab(active.id, out.url, settings.toast);
}

/* -------------------------------------------------------------------- *
 * Messages from popup / options / content
 * -------------------------------------------------------------------- */

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'xit:open-original' || msg.type === 'xit:diagnostics') {
    if (sender.id !== api.runtime.id) return;
    const action = msg.type === 'xit:diagnostics' ? diagnostics() : openOriginal(msg.url, sender.tab);
    action.then((report) => sendResponse({ ok: true, report }),
      () => sendResponse({ ok: false, error: msg.type === 'xit:diagnostics' ? 'Could not collect diagnostics. Try again.' : 'Could not open that X link.' }));
    return true;
  }

  if (msg.type === 'xit:mutate-settings') {
    if (sender.id !== api.runtime.id) return;
    XITStore.mutate(msg.operation).then(
      (settings) => sendResponse({ ok: true, settings }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }

  // storage.onChanged is the normal trigger for a refresh and fires in the
  // background for writes from any extension context, so nothing needs to send
  // this. It stays for an explicit refresh, and for content scripts left over
  // from a previous version that still send it.
  if (msg.type === 'xit:settings-changed') {
    (async () => {
      try {
        await init('settings');
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
    })();
    return true;
  }

  if (msg.type === 'xit:open-options') {
    if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
    else api.tabs.create({ url: api.runtime.getURL('options/options.html') });
    return;
  }

  if (msg.type === 'xit:open') {
    (async () => {
      const tab = sender.tab;
      await api.tabs.create({ url: msg.url, index: tab ? tab.index + 1 : undefined, active: msg.active !== false });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'xit:copy-via-background') {
    (async () => {
      const settings = await XITStore.load();
      const tabId = (sender.tab && sender.tab.id) || msg.tabId;
      const ok = tabId != null ? await copyInTab(tabId, msg.text, settings.toast) : false;
      sendResponse({ ok });
    })();
    return true;
  }
});

/* -------------------------------------------------------------------- *
 * Wiring
 * -------------------------------------------------------------------- */

let initChain = Promise.resolve();

/** All startup and settings events share one queue, including storage notifications. */
function init(reason) {
  const pending = initChain.then(() => doInit(reason));
  // Recover the queue without hiding failures from callers.
  initChain = pending.catch((e) => console.warn('[xit] init failed', e));
  return pending;
}

async function doInit(reason) {
  if (reason === 'install') {
    // Persist defaults so the options page has something concrete to show.
    await XITStore.save({});
  }
  const settings = await XITStore.load();
  // Menu failures must never prevent the redirect cleanup.
  const results = await Promise.allSettled([
    (async () => {
      try {
        await buildMenus(settings);
        await api.storage.local.remove('menuError');
      } catch (error) {
        await api.storage.local.set({ menuError: String(error.message || error) });
        throw error;
      }
    })(),
    clearLegacyRedirects(),
    api.storage.local.remove('lastCopyFailure'),
  ]);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
}

api.runtime.onInstalled.addListener((details) => {
  init(details && details.reason).catch((e) => console.warn('[xit] init failed', e));
});
if (api.runtime.onStartup) {
  api.runtime.onStartup.addListener(() => init('startup').catch(() => {}));
}
api.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch((e) => console.warn('[xit] menu click failed', e));
});
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch((e) => console.warn('[xit] command failed', e));
  });
}
XITStore.onChanged(() => {
  init('settings').catch(() => {});
});

// Service workers restart; make sure menus exist after a cold spin-up.
init('wake').catch(() => {});
