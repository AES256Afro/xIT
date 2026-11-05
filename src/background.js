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

const LINK_PATTERNS = XIT.HOST_PATTERNS;

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

  // The default and the pinned entries, unless the user asked for the lot.
  // Listing everything enabled came to roughly 25 items in one menu (U3).
  const list = XITStore.menuRedirectors(settings);
  const grouped = !!settings.contextMenuAll;
  const link = { contexts: ['link'], targetUrlPatterns: LINK_PATTERNS };
  const page = { contexts: ['page', 'frame'], documentUrlPatterns: LINK_PATTERNS };

  // On a tweet link anywhere on the web.
  await createMenu({ id: MENU_ROOT_LINK, title: 'xIT', ...link });
  await createMenu({ id: 'xit-link-copy-default', parentId: MENU_ROOT_LINK, ...link,
    title: 'Copy as ' + XITStore.defaultRedirector(settings).name });
  if (list.length) {
    await createMenu({ id: 'xit-link-sep1', parentId: MENU_ROOT_LINK, ...link, type: 'separator' });
  }

  async function linkPair(parentId, r) {
    await createMenu({ id: 'xit-link-copy:' + r.id, parentId, ...link, title: 'Copy as ' + r.name });
    await createMenu({ id: 'xit-link-open:' + r.id, parentId, ...link, title: 'Open with ' + r.name });
  }

  if (grouped) {
    for (const g of XIT.GROUPS) {
      const inGroup = list.filter((r) => r.group === g.id);
      if (!inGroup.length) continue;
      const groupId = 'xit-link-g-' + g.id;
      await createMenu({ id: groupId, parentId: MENU_ROOT_LINK, ...link, title: g.label });
      for (const r of inGroup) await linkPair(groupId, r);
    }
  } else {
    // Few enough to sit at the top level, where they take one fewer hover.
    for (const r of list) await linkPair(MENU_ROOT_LINK, r);
  }

  await createMenu({ id: 'xit-link-sep2', parentId: MENU_ROOT_LINK, ...link, type: 'separator' });
  await createMenu({ id: 'xit-link-copy-original', parentId: MENU_ROOT_LINK, ...link, title: 'Copy clean x.com link' });
  await createMenu({ id: 'xit-link-open-original', parentId: MENU_ROOT_LINK, ...link, title: 'Open on X' });

  // On the page itself while browsing X.
  await createMenu({ id: MENU_ROOT_PAGE, title: 'xIT', ...page });
  await createMenu({ id: 'xit-page-copy-default', parentId: MENU_ROOT_PAGE, ...page,
    title: 'Copy this page as ' + XITStore.defaultRedirector(settings).name });
  await createMenu({ id: 'xit-page-open-original', parentId: MENU_ROOT_PAGE, ...page, title: 'Open on X' });
  for (const r of list) {
    await createMenu({ id: 'xit-page-open:' + r.id, parentId: MENU_ROOT_PAGE, ...page,
      title: 'Open this page with ' + r.name });
  }
}

/* -------------------------------------------------------------------- *
 * Reachability check (P4, Q5)
 *
 * A dead redirector and a live one looked identical in the list: unrollnow
 * was caught by a user, not by the UI. This answers the question honestly,
 * which means reading the status code, which means a host permission. Those
 * are optional and requested by the Settings page at the moment the user
 * presses Check. Nothing here runs on a timer, on startup, or on a settings
 * change: every request below is one the user asked for.
 * -------------------------------------------------------------------- */

const CHECK_TIMEOUT_MS = 8000;

/**
 * One HEAD request to a redirector's own origin.
 * Returns { state, status } where state is one of:
 *   ok        answered, and not with a server error
 *   failing   answered with 5xx, which is what a retired service looks like
 *   refused   answered 4xx other than 405, so the host is up but unhappy
 *   silent    no answer at all: DNS gone, connection refused, or timed out
 *   denied    the user has not granted access to that origin
 *   unknown   not a host xIT ships, so there is no origin to ask for
 */
async function checkHost(template) {
  const origin = XIT.checkOrigin(template);
  if (!origin) return { state: 'unknown' };
  let granted = false;
  try { granted = await api.permissions.contains({ origins: [origin + '*'] }); } catch (_) { granted = false; }
  if (!granted) return { state: 'denied' };

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), CHECK_TIMEOUT_MS);
  try {
    // With the host permission granted the response is readable, so the
    // status is real. Without it this would be an opaque no-cors response,
    // where a 503 is indistinguishable from a 200: that version would have
    // called the host that retired unrollnow healthy.
    const res = await fetch(origin, { method: 'HEAD', redirect: 'follow', cache: 'no-store', signal: control.signal });
    const status = res.status;
    // 405 means the host is there and simply does not take HEAD.
    if (status === 405) return { state: 'ok', status };
    if (status >= 500) return { state: 'failing', status };
    if (status >= 400) return { state: 'refused', status };
    return { state: 'ok', status };
  } catch (_) {
    return { state: 'silent' };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHosts(ids) {
  const settings = await XITStore.load();
  const wanted = (Array.isArray(ids) ? ids : []).slice(0, 40);
  const results = {};
  // Serial, not parallel: a handful of requests the user asked for should not
  // arrive as a burst that looks like a scan.
  for (const id of wanted) {
    const redirector = XITStore.findRedirector(settings, String(id));
    if (!redirector) continue;
    const outcome = await checkHost(redirector.template);
    results[redirector.id] = { ...outcome, at: Date.now() };
  }
  const stored = await api.storage.local.get('hostChecks');
  // Kept out of settings on purpose: these are observations, not choices, so
  // they are not exported, do not rebuild the menus, and are not worth syncing.
  await api.storage.local.set({ hostChecks: { ...(stored && stored.hostChecks), ...results } });
  return results;
}

/* -------------------------------------------------------------------- *
 * Clipboard
 *
 * A service worker has no DOM, so the write happens in the page. A
 * context-menu click grants activeTab, which is what makes this allowed.
 * -------------------------------------------------------------------- */

// Runs in the target page through scripting.executeScript, which is only
// reached when there is no content script to take the copy. Nothing can show a
// toast from here: the page has no xIT UI in it. An earlier version dispatched
// an xit:toast CustomEvent that nothing ever listened for.
function clipboardPayload(text) {
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
  return write();
}

/**
 * Copy `text` in the given tab. `note` replaces the confirmation toast, for
 * the case where the copy succeeded but not with the redirector the user
 * asked for. Off an X tab there is no content script and so no toast at all.
 */
async function copyInTab(tabId, text, showToast, note) {
  // Prefer the content script: it owns the in-page toast.
  try {
    const res = await api.tabs.sendMessage(tabId, {
      type: 'xit:copy-text', text, note: note || null, silent: !showToast,
    });
    if (res && res.ok) return true;
  } catch (_) { /* not injected here */ }

  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: clipboardPayload,
      args: [text],
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
  const target = info.linkUrl || info.frameUrl || (tab && tab.url) || '';
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
    // The chosen redirector does not apply to this link. Fall back to the
    // canonical x.com URL, never the raw target, which still carries the
    // tracking parameters the user asked to have stripped. Say which it was:
    // a silent substitution is how somebody pastes the wrong thing.
    const clean = XIT.canonical(target, opts);
    console.warn('[xit]', out.reason);
    if (tab && clean) {
      await copyInTab(tab.id, clean, settings.toast,
        out.reason + ' Copied the clean x.com link instead.').catch(() => {});
    }
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

/**
 * Is this a URL one of the user's own redirectors would have produced?
 * Everything that reaches xit:open comes from our own content script, so this
 * is defence in depth rather than a gate against the web. It is cheap, and it
 * means a single stray message cannot turn the extension into a way to open
 * an arbitrary tab.
 */
async function isOwnDestination(url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (XIT.isSourceHost(host)) return true;
  const settings = await XITStore.load();
  return XITStore.extraHosts(settings).has(host) || XITStore.extraHosts(settings).has(XIT.bareHost(host));
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  // Every sender is one of our own pages or content scripts. There is no
  // externally_connectable, so nothing on the web can reach this listener,
  // but three of the handlers below used to skip this check while the other
  // three made it. One rule for all of them.
  if (sender.id !== api.runtime.id) return;

  if (msg.type === 'xit:open-original' || msg.type === 'xit:diagnostics') {
    const action = msg.type === 'xit:diagnostics' ? diagnostics() : openOriginal(msg.url, sender.tab);
    action.then((report) => sendResponse({ ok: true, report }),
      () => sendResponse({ ok: false, error: msg.type === 'xit:diagnostics' ? 'Could not collect diagnostics. Try again.' : 'Could not open that X link.' }));
    return true;
  }

  if (msg.type === 'xit:check-hosts') {
    checkHosts(msg.ids).then((results) => sendResponse({ ok: true, results }),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || 'Could not check those hosts.') }));
    return true;
  }

  if (msg.type === 'xit:mutate-settings') {
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
        // 'refresh', not 'settings': an explicit request rebuilds the menus
        // even when nothing the menus depend on has moved. That is the point
        // of asking.
        await init('refresh');
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
      if (!await isOwnDestination(msg.url)) {
        sendResponse({ ok: false, error: 'That is not one of your redirectors.' });
        return;
      }
      const tab = sender.tab;
      await api.tabs.create({ url: msg.url, index: tab ? tab.index + 1 : undefined, active: msg.active !== false });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

/* -------------------------------------------------------------------- *
 * Wiring
 * -------------------------------------------------------------------- */

let initChain = Promise.resolve();
// The signature of the menu currently installed, or null when we do not know.
// A service worker that was torn down starts over, which costs one rebuild.
let lastMenuSignature = null;

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
    // pickerDone stays false, so Settings opens the first-run picker once.
    await XITStore.save({});
  } else if (reason === 'update') {
    // Somebody upgrading has already made their choices, and normalize() keeps
    // the five redirectors that became catalogue entries in 1.1.0. Do not open
    // a first-run picker at them.
    const stored = await api.storage.local.get('settings');
    if (stored && stored.settings) await XITStore.save({ pickerDone: true });
  }
  const settings = await XITStore.load();
  // O4: a settings write used to rebuild all of it, one removeAll plus a
  // couple of dozen awaited create calls, even when the change was the toast
  // toggle. Rebuild only when something the menu is actually built from moved.
  // Startup and install always rebuild, since the worker starts with no idea
  // what is already installed.
  const signature = XITStore.menuSignature(settings);
  const menuIsCurrent = reason === 'settings' && signature === lastMenuSignature;
  // Menu failures must never prevent the redirect cleanup.
  const results = await Promise.allSettled([
    (async () => {
      if (menuIsCurrent) return;
      try {
        await buildMenus(settings);
        lastMenuSignature = signature;
        await api.storage.local.remove('menuError');
      } catch (error) {
        lastMenuSignature = null;
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
