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
  return new Promise((resolve) => {
    try {
      api.contextMenus.removeAll(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function buildMenus(settings) {
  await removeAllMenus();
  if (!settings.contextMenu) return;

  const list = XITStore.enabledRedirectors(settings);
  if (!list.length) return;

  const create = (opts) => {
    try {
      api.contextMenus.create(opts);
    } catch (e) {
      console.warn('[xit] menu create failed', opts.id, e);
    }
  };

  // On a tweet link anywhere on the web.
  create({ id: MENU_ROOT_LINK, title: 'xIT', contexts: ['link'], targetUrlPatterns: LINK_PATTERNS });
  create({ id: 'xit-link-copy-default', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS,
    title: 'Copy as ' + XITStore.defaultRedirector(settings).name });
  create({ id: 'xit-link-sep1', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, type: 'separator' });

  for (const g of XIT.GROUPS) {
    const inGroup = list.filter((r) => r.group === g.id);
    if (!inGroup.length) continue;
    const groupId = 'xit-link-g-' + g.id;
    create({ id: groupId, parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: g.label });
    for (const r of inGroup) {
      create({ id: 'xit-link-copy:' + r.id, parentId: groupId, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Copy as ' + r.name });
      create({ id: 'xit-link-open:' + r.id, parentId: groupId, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Open with ' + r.name });
    }
  }
  create({ id: 'xit-link-sep2', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, type: 'separator' });
  create({ id: 'xit-link-copy-original', parentId: MENU_ROOT_LINK, contexts: ['link'], targetUrlPatterns: LINK_PATTERNS, title: 'Copy clean x.com link' });

  // On the page itself while browsing X.
  create({ id: MENU_ROOT_PAGE, title: 'xIT', contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS });
  create({ id: 'xit-page-copy-default', parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS,
    title: 'Copy this page as ' + XITStore.defaultRedirector(settings).name });
  for (const r of list) {
    create({ id: 'xit-page-open:' + r.id, parentId: MENU_ROOT_PAGE, contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS,
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
    await notifyFailure(text);
    return false;
  }
}

async function notifyFailure(text) {
  // Last resort: park it where the user can still get at it.
  try {
    await api.storage.local.set({ lastCopyFailure: { text, at: Date.now() } });
  } catch (_) { /* ignore */ }
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
  if (!hasDnr()) return;
  const dnr = api.declarativeNetRequest;

  let existing = [];
  try {
    existing = await dnr.getDynamicRules();
  } catch (_) { /* treat as none */ }
  const removeRuleIds = existing.filter((r) => r.id >= DNR_RULE_BASE).map((r) => r.id);

  const addRules = [];
  if (settings.browseRedirect) {
    const redirector = XITStore.findRedirector(settings, settings.browseRedirectorId);
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
          action: { type: 'redirect', redirect: { regexSubstitution: c.regexSubstitution } },
          condition: { regexFilter: c.regexFilter, resourceTypes: ['main_frame'] },
        });
      }
    }
  }

  try {
    await dnr.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.warn('[xit] could not install redirect rules', e);
    await api.storage.local.set({ dnrError: String(e && e.message || e) });
    return;
  }
  try {
    await api.storage.local.remove('dnrError');
  } catch (_) { /* ignore */ }
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

  if (msg.type === 'xit:settings-changed') {
    (async () => {
      const settings = await XITStore.load();
      await Promise.all([buildMenus(settings), syncDnrRules(settings)]);
      sendResponse({ ok: true });
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

/** Serialised so a cold service-worker wake cannot race onInstalled. */
function init(reason) {
  initChain = initChain.then(() => doInit(reason)).catch((e) => console.warn('[xit] init failed', e));
  return initChain;
}

async function doInit(reason) {
  const settings = await XITStore.load();
  if (reason === 'install') {
    // Persist defaults so the options page has something concrete to show.
    await XITStore.save({});
  }
  await Promise.all([buildMenus(settings), syncDnrRules(settings)]);
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
XITStore.onChanged((settings) => {
  Promise.all([buildMenus(settings), syncDnrRules(settings)]).catch(() => {});
});
installFallbackRedirect();

// Service workers restart; make sure menus exist after a cold spin-up.
init('wake').catch(() => {});
