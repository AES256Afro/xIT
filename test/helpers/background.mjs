/**
 * The background script, loaded against a fake extension API, with the real
 * URL library behind it and a stand-in settings store a test can steer.
 *
 * Shared by test/background.test.mjs and test/paths.test.mjs. It lived inside
 * the first until the cross-path test needed to click the same menus.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeI18n } from './i18n-stub.mjs';

// The menu-click tests need the real URL logic, not a stub, or they would
// agree with whatever the code happens to do.
const realCtx = vm.createContext({ console, URL, URLSearchParams, JSON });
vm.runInContext(readFileSync(new URL('../../src/lib/redirectors.js', import.meta.url), 'utf8'), realCtx);
export const REAL = realCtx.XIT;

// `session` stands in for storage.session, which outlives a service worker
// restart but not a browser restart. Pass the same object to two harnesses to
// play the second as the same browser waking the worker again.
export function harness(firefox = false, { session = {} } = {}) {
  const menus = new Map();
  const errors = [];
  let created = 0;
  const events = {};
  let settings = { contextMenu: true, name: 'first' };
  let changed;
  let rules = [];
  let ruleUpdates = 0;
  // How often the redirect-rule cleanup looked, so a test can tell whether it ran.
  let dnrReads = 0;
  let removeAllCalls = 0;
  const local = {};
  // How many times anything was written to storage.local, so a test can say
  // that a settings change caused no write of its own.
  let localSets = 0;
  const rewrites = [];
  const badge = { text: 'PAUSE' };
  const sent = [];
  const opened = [];
  const injected = [];
  let noContentScript = false;
  let injectionFails = false;
  // Per-tab badge calls, in order, so a test can see a flash and its clearing.
  const badgeCalls = [];
  let redirector = { name: 'Example', template: 'https://example.com/{path}' };
  let byId = {};
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  const runtime = { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'),
    getManifest: () => ({ version: '0.0.0-test', action: { default_title: 'xIT' } }),
    getURL: (path) => 'chrome-extension://test/' + (path || '') };
  let failRemoval = false;
  const grantedOrigins = new Set();
  const fetched = [];
  // What each origin answers with: a number is an HTTP status, 'throw' is no
  // answer at all (DNS gone, refused, timed out).
  let answers = {};
  // Called inside the fake fetch, so a test can change the world while a
  // check is in flight.
  let fetchHook = null;
  let failCreation = false;
  function complete(cb, error) {
    runtime.lastError = error ? { message: error } : undefined;
    cb?.();
    runtime.lastError = undefined;
  }
  const api = {
    runtime,
    contextMenus: {
      onClicked: event('clicked'),
      removeAll(cb) {
        removeAllCalls += 1;
        setImmediate(() => {
          if (failRemoval) { failRemoval = false; complete(cb, 'remove failed'); return; }
          menus.clear(); complete(cb);
        });
      },
      create(opts, cb) {
        setImmediate(() => {
          const error = failCreation ? 'create failed' : menus.has(opts.id) ? 'duplicate ' + opts.id : null;
          failCreation = false;
          if (error) errors.push(error);
          else { menus.set(opts.id, opts); created += 1; }
          complete(cb, error);
        });
        return opts.id;
      },
    },
    storage: { local: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, JSON.parse(JSON.stringify(local[k]))])),
      remove: async (keys) => { for (const k of [].concat(keys)) delete local[k]; },
      set: async (value) => { localSets++; Object.assign(local, value); },
    }, session: {
      get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in session).map((k) => [k, JSON.parse(JSON.stringify(session[k]))])),
      remove: async (keys) => { for (const k of [].concat(keys)) delete session[k]; },
      set: async (value) => { Object.assign(session, JSON.parse(JSON.stringify(value))); },
    } },
    action: {
      setBadgeText: async ({ text, tabId }) => { if (tabId === undefined) badge.text = text; else badgeCalls.push({ tabId, text }); },
      setBadgeBackgroundColor: async ({ tabId, color }) => { badgeCalls.push({ tabId, color }); },
      setTitle: async ({ tabId, title }) => { badgeCalls.push({ tabId, title }); },
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        if (noContentScript) throw new Error('could not establish connection');
        sent.push({ tabId, ...message });
        return tabReply;
      },
      create: async (opts) => { opened.push(opts); return { id: 99 }; },
      // The keyboard commands ask for the active tab; the diagnostics sweep
      // asks by URL pattern and must keep seeing nothing here.
      query: async (q) => (q && q.active ? [activeTab] : []),
    },
    scripting: {
      executeScript: async ({ args }) => {
        injected.push(args);
        // A page the browser will not script, such as the Web Store or a
        // chrome:// page, rejects outright.
        if (injectionFails) throw new Error('Cannot access contents of the page');
        return [{ result: true }];
      },
    },
    permissions: { contains: async ({ origins }) => origins.every((o) => grantedOrigins.has(o)) },
    declarativeNetRequest: {
      getDynamicRules: async () => { dnrReads += 1; return rules; },
      updateDynamicRules: async ({removeRuleIds = [], addRules = []}) => {
        ruleUpdates += 1;
        rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules);
      },
    },
  };
  if (firefox) {
    // Firefox alone has this, and the background reads it to tell the two apart.
    runtime.getBrowserInfo = async () => ({ name: 'Firefox', version: '155.0' });
    api.contextMenus.removeAll = () => new Promise((resolve, reject) => {
      setImmediate(() => {
        if (failRemoval) { failRemoval = false; reject(new Error('remove failed')); return; }
        menus.clear(); resolve();
      });
    });
  }
  const LEGACY = ['browseRedirect', 'browseRedirectorId', 'browseScope', 'browsePausedUntil'];
  const store = {
    startWriter() {},
    // The real rewrite re-saves normalized settings, which drops legacy keys.
    mutate: async (op) => {
      rewrites.push(op.type);
      if (op.type === 'rewrite' && local.settings) {
        local.settings = Object.fromEntries(Object.entries(local.settings).filter(([k]) => !LEGACY.includes(k)));
      }
      return { ...settings };
    },
    load: async () => ({ ...settings }),
    // The real save merges a patch into stored settings, which install and
    // update both rely on.
    save: async (patch) => {
      local.settings = { ...(local.settings || {}), ...(patch || {}) };
      changed({ ...settings });
    },
    onChanged(fn) { changed = fn; },
    enabledRedirectors: (s) => [{id:'example',group:'test',name:s.name}],
    /*
     * Every redirector that exists, enabled or not, which is what C13's
     * prune judges a stored result against.
     *
     * A function of the settings handed to it, as the real one is: removedIds
     * stands in for a redirector no longer being in the stored list. That
     * matters because the answer has to differ between a stale settings
     * snapshot and a fresh read, which is the whole point of the mid-check
     * test below. Reading the harness's current map instead made the two
     * indistinguishable and let a reversion through.
     */
    allRedirectors: (s) => {
      const gone = new Set((s && s.removedIds) || []);
      const all = Object.keys(byId).length ? Object.values(byId) : store.enabledRedirectors(s);
      return all.filter((r) => !gone.has(r.id));
    },
    menuRedirectors: (s) => store.enabledRedirectors(s),
    // Stands in for the real fingerprint: enough that a change the menu does
    // depend on looks different and one it does not looks the same.
    menuSignature: (s) => JSON.stringify([!!s.contextMenu, !!s.contextMenuAll, s.name]),
    // Keeps .name driven by settings, as the menu tests expect, while
    // carrying the template the keyboard commands need to convert with.
    defaultRedirector: (s) => ({...redirector, name:s.name}),
    findRedirector: (s, id) => byId[id] || redirector,
    extraHosts: () => new Set(['example.com']),
  };
  let tabReply = { ok: true };
  let activeTab = { id: 1, url: 'https://x.com/jack/status/20?s=20', index: 3 };

  async function fakeFetch(url, options) {
    fetched.push({ url, method: options && options.method });
    if (fetchHook) fetchHook(url);
    const answer = answers[url];
    if (answer === undefined || answer === 'throw') throw new Error('network');
    // 'elsewhere' is a host whose front page redirects to an origin the
    // extension has no permission for, as vxtwitter.com does to github.com.
    // Followed, that is a cross-origin response the browser refuses, which
    // surfaces as a TypeError just like no answer at all. Not followed, the
    // browser hands back an opaque redirect: status 0, but proof of an answer.
    if (answer === 'elsewhere') {
      if (!options || options.redirect !== 'manual') throw new TypeError('Failed to fetch');
      return { type: 'opaqueredirect', status: 0, ok: false };
    }
    return { status: answer, ok: answer < 400 };
  }
  // The real library, with only the group list swapped for a test one. It
  // used to be a hand-listed subset, which meant every new export broke this
  // harness with a TypeError about something the test was not about: the same
  // drift between two copies of one list that B8, B9 and S6 all turned out to
  // be. What background.js is allowed to reach for is held by the load-list
  // test instead, which compares the manifests against the globals the file
  // actually references.
  const ctx = vm.createContext({ ...(firefox ? { browser: api } : { chrome: api }), console: { warn() {} }, XIT: {
    ...REAL,
    GROUPS: [{id:'test',label:'Test'}],
  }, XITStore: store, URL, Set, fetch: fakeFetch,
  AbortController, setTimeout, clearTimeout, Date });
  // The manifest loads lib/i18n.js before background.js in both browsers, and
  // the catalogue behind it is the real one, so a menu title asserted below is
  // the title the shipped extension builds.
  ctx.chrome ? (ctx.chrome.i18n = fakeI18n()) : (ctx.browser.i18n = fakeI18n());
  vm.runInContext(readFileSync(new URL('../../src/lib/i18n.js', import.meta.url),'utf8'),ctx);
  vm.runInContext(readFileSync(new URL('../../src/background.js', import.meta.url),'utf8'),ctx);
  async function settle() { for (let i=0;i<150;i++) await tick(); }
  return { menus, errors, events, settle, local, rules:()=>rules, setRules:(r)=>{rules=r;}, ruleUpdates:()=>ruleUpdates,
    rewrites, badge, createCount: () => created,
    sent, opened, injected,
    setCount() { return localSets; },
    onFetch(fn) { fetchHook = fn; },
    setSettings(patch) { settings = { ...settings, ...patch }; },
    setRedirector(value) { redirector = value; },
    setRedirectors(map) { byId = map; },
    grant(...origins) { for (const o of origins) grantedOrigins.add(o); },
    answer(map) { answers = { ...answers, ...map }; },
    fetched,
    dropContentScript() { noContentScript = true; },
    failInjection() { injectionFails = true; },
    dnrReads: () => dnrReads,
    removeAllCalls: () => removeAllCalls,
    badgeCalls,
    command: (name) => ctx.handleCommand(name),
    answerTab(reply) { tabReply = reply; },
    setActiveTab(tab) { activeTab = tab; },
    change(patch) { settings={...settings,...patch}; changed({...settings}); },
    failRemove() { failRemoval=true; }, failCreate() { failCreation=true; },
  };
}
