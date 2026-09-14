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
const DNR_RULE_BASE = 1000; // Our dynamic rule id range.

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

  // On the page itself while browsing X.
  await createMenu({ id: MENU_ROOT_PAGE, title: 'xIT', contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS });
  await createMenu({ id: 'xit-page-copy-default', parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS,
    title: 'Copy this page as ' + XITStore.defaultRedirector(settings).name });
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

/* -------------------------------------------------------------------- *
 * Browse redirect via declarativeNetRequest
 * -------------------------------------------------------------------- */

function hasDnr() {
  return !!(api.declarativeNetRequest && api.declarativeNetRequest.updateDynamicRules);
}

async function syncDnrRules(settings) {
  const key = XITStore.browseStatusKey(settings);
  const status = (state, extra = {}) => api.storage.local.set({ dnrStatus: { key, state, ...extra } });
  if (!hasDnr()) {
    await status(settings.browseRedirect ? 'error' : 'off', { message: 'This browser cannot install page redirects.' });
    return;
  }
  const dnr = api.declarativeNetRequest;
  await status('updating');
  try {
    const existing = await dnr.getDynamicRules();
    const removeRuleIds = existing.filter((r) => r.id >= DNR_RULE_BASE).map((r) => r.id);
    const addRules = [];
    if (settings.browseRedirect) {
      const redirector = XITStore.findRedirector(settings, settings.browseRedirectorId);
      if (!XIT.supportsBrowse(redirector)) throw new Error('Choose a redirector that supports page loads.');
      const compiled = redirector ? XIT.compileBrowseRules(redirector.template, settings.browseScope) : [];
      if (compiled.length) {
        let nextId = DNR_RULE_BASE;
        for (const g of XIT.guardRules()) {
          addRules.push({
            id: nextId++,
            priority: g.priority,
            action: { type: 'allow' },
            condition: { regexFilter: g.regexFilter, resourceTypes: ['main_frame'] },
          });
        }
        for (const c of compiled) {
          addRules.push({
            id: nextId++,
            priority: c.priority,
            action: { type: 'redirect', redirect: c.transform ? { transform: c.transform } : { regexSubstitution: c.regexSubstitution } },
            condition: { regexFilter: c.regexFilter, resourceTypes: ['main_frame'] },
          });
        }
      }
    }

    if (dnr.isRegexSupported) {
      for (const rule of addRules) {
        const result = await dnr.isRegexSupported({ regex: rule.condition.regexFilter, requireCapturing: !!(rule.action.redirect && rule.action.redirect.regexSubstitution) });
        if (!result.isSupported) throw new Error('The browser rejected a redirect pattern: ' + result.reason);
      }
    }
    await dnr.updateDynamicRules({ removeRuleIds, addRules });
    const installed = (await dnr.getDynamicRules()).filter((r) => r.id >= DNR_RULE_BASE);
    if (installed.length !== addRules.length) throw new Error('The browser did not install all page redirect rules.');
    await status(addRules.length ? 'active' : 'off', { ruleCount: installed.length });
    await api.storage.local.remove('dnrError');
  } catch (e) {
    console.warn('[xit] could not install redirect rules', e);
    let cleared = false;
    try {
      const ids = (await dnr.getDynamicRules()).filter((r) => r.id >= DNR_RULE_BASE).map((r) => r.id);
      await dnr.updateDynamicRules({ removeRuleIds: ids, addRules: [] });
      cleared = !(await dnr.getDynamicRules()).some((r) => r.id >= DNR_RULE_BASE);
    } catch (_) { /* retain an explicit warning if cleanup also fails */ }
    const message = 'Page redirect could not be updated. ' + String(e && e.message || e) +
      (cleared ? ' Redirecting is off.' : ' Previous redirects may still be active. Reload the extension and try again.');
    await api.storage.local.set({ dnrError: message });
    await status('error', { message });
    throw e;
  }
}

/**
 * Fallback for builds without dynamic DNR: redirect after the navigation
 * starts. Slower and it flashes x.com, so it only runs when DNR is absent.
 */
function installFallbackRedirect() {
  if (hasDnr() || !api.tabs || !api.tabs.onUpdated) return;
  api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    const url = changeInfo.url;
    if (!url) return;
    const settings = await XITStore.load();
    if (!settings.browseRedirect) return;
    if (url.includes(XIT.BYPASS_PARAM + '=1')) return;
    const parts = XIT.parse(url);
    if (!parts || !parts.isSource) return;
    if (!settings.browseScope[parts.kind]) return;
    if (XIT.RESERVED.has((parts.path.split('/')[0] || '').toLowerCase()) && parts.kind === 'other') return;
    const redirector = XITStore.findRedirector(settings, settings.browseRedirectorId);
    const out = XIT.convert(url, redirector, { stripTracking: settings.stripTracking });
    if (out.ok) api.tabs.update(tabId, { url: out.url });
  });
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
  // Menu failures must never prevent redirect removal or migration cleanup.
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
    syncDnrRules(settings),
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
installFallbackRedirect();

// Service workers restart; make sure menus exist after a cold spin-up.
init('wake').catch(() => {});
