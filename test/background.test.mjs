import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fakeI18n } from './helpers/i18n-stub.mjs';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import vmlib from 'node:vm';

// The menu-click tests need the real URL logic, not a stub, or they would
// agree with whatever the code happens to do.
const realCtx = vmlib.createContext({ console, URL, URLSearchParams, JSON });
vmlib.runInContext(readFileSync(new URL('../src/lib/redirectors.js', import.meta.url), 'utf8'), realCtx);
const REAL = realCtx.XIT;

function harness(firefox = false) {
  const menus = new Map();
  const errors = [];
  let created = 0;
  const events = {};
  let settings = { contextMenu: true, name: 'first' };
  let changed;
  let rules = [];
  let ruleUpdates = 0;
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
  let redirector = { name: 'Example', template: 'https://example.com/{path}' };
  let byId = {};
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  const runtime = { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') };
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
    } },
    action: { setBadgeText: async ({ text }) => { badge.text = text; } },
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
      executeScript: async ({ args }) => { injected.push(args); return [{ result: true }]; },
    },
    permissions: { contains: async ({ origins }) => origins.every((o) => grantedOrigins.has(o)) },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async ({removeRuleIds = [], addRules = []}) => {
        ruleUpdates += 1;
        rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules);
      },
    },
  };
  if (firefox) {
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
  vm.runInContext(readFileSync(new URL('../src/lib/i18n.js', import.meta.url),'utf8'),ctx);
  vm.runInContext(readFileSync(new URL('../src/background.js', import.meta.url),'utf8'),ctx);
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
    command: (name) => ctx.handleCommand(name),
    answerTab(reply) { tabReply = reply; },
    setActiveTab(tab) { activeTab = tab; },
    change(patch) { settings={...settings,...patch}; changed({...settings}); },
    failRemove() { failRemoval=true; }, failCreate() { failCreation=true; },
  };
}

// Shape of what 1.0.3 left behind for a user redirecting page loads to xcancel.
const LEFTOVER_RULES = [
  { id: 1000, priority: 3, action: { type: 'allow' }, condition: { regexFilter: '^https?://x\\.com/home', resourceTypes: ['main_frame'] } },
  { id: 1001, priority: 4, action: { type: 'redirect', redirect: { regexSubstitution: 'https://xcancel.com/\\1' } },
    condition: { regexFilter: '^https?://x\\.com/([^/?#]+/status/\\d+.*)$', resourceTypes: ['main_frame'] } },
];

test('redirect rules left by earlier versions are removed on start', async () => {
  const h=harness();
  h.setRules(LEFTOVER_RULES);
  h.local.dnrStatus={state:'active'}; h.local.dnrError='old';
  await h.settle();
  assert.deepEqual(h.rules(),[],'no rule may keep sending users to a withdrawn front-end');
  assert.equal(h.badge.text,'','the pause badge is cleared');
  assert.equal(h.local.dnrStatus,undefined);assert.equal(h.local.dnrError,undefined);
});

test('stored page-redirect settings are rewritten once, then left alone', async () => {
  const h=harness();
  h.local.settings={toast:false,browseRedirect:true,browseRedirectorId:'xcancel',browseScope:{status:true},browsePausedUntil:5};
  await h.settle();
  assert.deepEqual(h.rewrites,['rewrite']);
  assert.equal(JSON.stringify(h.local.settings).match(/browse|xcancel/),null);
  assert.equal(h.local.settings.toast,false,'unrelated settings survive');
  h.change({name:'later'}); await h.settle();
  assert.deepEqual(h.rewrites,['rewrite'],'clean settings are not rewritten again');
});

test('cleanup changes nothing when there is nothing to clean', async () => {
  const h=harness();
  h.local.settings={toast:true};
  await h.settle();
  assert.equal(h.ruleUpdates(),0,'no rule update without leftover rules');
  assert.deepEqual(h.rewrites,[]);
});

test('menu failures cannot prevent the redirect cleanup or clearing old copy data', async () => {
  const h=harness(); await h.settle();
  h.setRules(LEFTOVER_RULES);
  h.local.lastCopyFailure={text:'synthetic',at:0};
  h.failCreate();h.change({name:'after-update'});await h.settle();
  assert.deepEqual(h.rules(),[]);
  assert.match(h.local.menuError,/create failed/);
  assert.equal(h.local.lastCopyFailure,undefined);
});

for (const firefox of [false, true]) {
test(`Firefox=${firefox}: install, startup, storage events and popup messages cannot overlap menu rebuilds`, async () => {
  const h=harness(firefox);
  h.events.installed({reason:'install'});
  h.events.startup();
  h.change({name:'latest'});
  let response;
  h.events.message({type:'xit:settings-changed'}, {}, value=>{response=value;});
  await h.settle();
  assert.deepEqual(h.errors,[]);
  assert.equal(response?.ok,true);
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as latest');
  // 12, not 13: the capped menu puts its two entries at the top level rather
  // than inside a group submenu (U3).
  assert.equal(h.menus.size,12);
  assert.ok(h.menus.has('xit-link-open-original'));
  assert.ok(h.menus.has('xit-page-open-original'));
  h.change({contextMenu:false});
  await h.settle();
  assert.equal(h.menus.size,0);
  h.change({contextMenu:true,name:'reenabled'});
  await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as reenabled');
  assert.deepEqual(h.errors,[]);
});

test(`Firefox=${firefox}: failed removal stops creation and the next refresh can recover`, async () => {
  const h=harness(firefox); await h.settle();
  h.failRemove(); h.change({name:'failed'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as first');
  assert.deepEqual(h.errors,[]);
  h.change({name:'recovered'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as recovered');
});

test(`Firefox=${firefox}: asynchronous menu errors are reported to the caller and do not break later updates`, async () => {
  const h=harness(firefox); await h.settle(); h.failCreate();
  let response;
  h.events.message({type:'xit:settings-changed'}, {}, value=>{response=value;});
  await h.settle();
  assert.equal(response?.ok,false);
  assert.match(response.error,/create failed/);
  h.change({name:'recovered'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as recovered');
});

}

test('a settings write alone rebuilds the menus exactly once', async () => {
  // Nothing sends xit:settings-changed any more: storage.onChanged is the
  // single trigger. If a caller re-adds the message, this rebuilds twice.
  const h = harness(false);
  h.events.installed({ reason: 'startup' });
  await h.settle();

  const menuSize = h.menus.size;
  assert.ok(menuSize > 0, 'expected an initial menu');

  const before = h.createCount();
  h.change({ name: 'second' });
  await h.settle();

  assert.equal(h.createCount() - before, menuSize, 'a settings write should rebuild the menu once');
  assert.equal(h.errors.length, 0, 'rebuilding must not collide with itself');
  assert.equal([...h.menus.values()].some((m) => String(m.title).includes('second')), true,
    'the rebuilt menu should reflect the new settings');
});

/* -------------------------------------------------------------------- *
 * Milestone 1 regressions
 * -------------------------------------------------------------------- */

test('a redirector that does not apply copies the clean x.com link and says so', async () => {
  // B1. This used to put the raw target on the clipboard, tracking parameters
  // and all, with the toast suppressed and only a console warning. Deleting
  // the fallback below makes this fail on the URL, deleting the note makes it
  // fail on the explanation.
  const h = harness();
  await h.settle();
  h.setRedirector({ name: 'Thread Reader App', template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'] });

  h.events.clicked({ menuItemId: 'xit-link-copy:threadreader', linkUrl: 'https://x.com/jack?s=20&t=abc' }, { id: 7, index: 2 });
  await h.settle();

  assert.equal(h.sent.length, 1, 'exactly one clipboard write');
  assert.equal(h.sent[0].text, 'https://x.com/jack', 'the clean canonical link, not the raw target');
  assert.match(h.sent[0].note, /specific tweet/, 'the reason the redirector did not apply');
  assert.match(h.sent[0].note, /clean x\.com link instead/, 'and what was copied in its place');
  assert.deepEqual(h.opened, [], 'nothing is opened on a copy action');
});

test('a successful copy carries no note', async () => {
  const h = harness();
  await h.settle();
  h.events.clicked({ menuItemId: 'xit-link-copy:example', linkUrl: 'https://x.com/jack/status/20?s=20' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.sent[0].text, 'https://example.com/jack/status/20');
  assert.equal(h.sent[0].note, null, 'no explanation is needed when it worked');
});

test('a frame context menu converts the frame, not the top document', async () => {
  // B3. info.frameUrl is what the user right-clicked in.
  const h = harness();
  await h.settle();
  h.events.clicked({ menuItemId: 'xit-page-copy-default', frameUrl: 'https://x.com/jack/status/20' },
    { id: 7, index: 2, url: 'https://x.com/home' });
  await h.settle();
  assert.equal(h.sent[0].text, 'https://example.com/jack/status/20');
});

test('off an X page the copy falls back to executeScript with no toast argument', async () => {
  // C7. clipboardPayload used to take a showToast flag and dispatch an event
  // that nothing listened for. It now takes the text alone.
  const h = harness();
  await h.settle();
  h.dropContentScript();
  h.events.clicked({ menuItemId: 'xit-link-copy:example', linkUrl: 'https://x.com/jack/status/20' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.injected.length, 1, 'the script injection path ran');
  assert.deepEqual(Array.from(h.injected[0]), ['https://example.com/jack/status/20'],
    'one argument: the text to copy');
});

test('xit:open only opens a destination the settings account for', async () => {
  // S2. Nothing on the web can reach this listener, so this is defence in
  // depth. The check is what stops a single stray message opening any tab.
  const h = harness();
  await h.settle();

  const call = (url) => new Promise((resolve) => {
    h.events.message({ type: 'xit:open', url }, { id: undefined, tab: { id: 7, index: 2 } }, resolve);
  });

  assert.equal((await call('https://example.com/jack/status/20')).ok, true,
    'a configured redirector host is allowed');
  assert.equal(h.opened.length, 1);

  for (const url of ['https://evil.test/jack', 'http://example.com/jack', 'javascript:alert(1)', 'not a url', '']) {
    const result = await call(url);
    assert.equal(result.ok, false, url + ' must be refused');
  }
  assert.equal(h.opened.length, 1, 'nothing further was opened');

  assert.equal((await call('https://x.com/jack/status/20')).ok, true,
    'x.com itself stays reachable, for Open on X');
});

test('a message from another extension is ignored outright', async () => {
  // S2. Three handlers used to skip this check while three made it.
  const h = harness();
  await h.settle();
  const before = h.opened.length;
  let answered = false;
  const handled = h.events.message({ type: 'xit:open', url: 'https://example.com/jack' },
    { id: 'some-other-extension', tab: { id: 7, index: 2 } }, () => { answered = true; });
  await h.settle();
  assert.notEqual(handled, true, 'the listener must not claim the message');
  assert.equal(answered, false, 'and must not answer it');
  assert.equal(h.opened.length, before, 'and must not open anything');
});

/* -------------------------------------------------------------------- *
 * Milestone 2
 * -------------------------------------------------------------------- */

test('a settings write that cannot change the menu does not rebuild it', async () => {
  // O4. Toggling the toast used to cost one removeAll plus every create call.
  const h = harness();
  await h.settle();
  const before = h.createCount();
  h.change({ toast: false });
  await h.settle();
  assert.equal(h.createCount(), before, 'the toast setting is not in the menu');
  assert.ok(h.menus.size > 0, 'and the menu is still installed');

  h.change({ name: 'renamed' });
  await h.settle();
  assert.ok(h.createCount() > before, 'a change the menu does depend on still rebuilds');
});

test('showing every redirector groups the menu, capping it does not', async () => {
  const h = harness();
  await h.settle();
  const flat = h.menus.size;
  assert.equal(h.menus.has('xit-link-g-test'), false, 'capped entries sit at the top level');

  h.change({ contextMenuAll: true });
  await h.settle();
  assert.equal(h.menus.has('xit-link-g-test'), true, 'the full list is grouped');
  assert.equal(h.menus.size, flat + 1);
  assert.deepEqual(h.errors, []);
});

test('an explicit refresh rebuilds even when nothing moved', async () => {
  const h = harness();
  await h.settle();
  const before = h.createCount();
  let response;
  h.events.message({ type: 'xit:settings-changed' }, {}, (value) => { response = value; });
  await h.settle();
  assert.equal(response?.ok, true);
  assert.ok(h.createCount() > before, 'asking for a rebuild is the point of asking');
});

test('an upgrade does not open the first-run picker, a fresh install does', async () => {
  const h = harness();
  h.local.settings = { toast: false };
  h.events.installed({ reason: 'update' });
  await h.settle();
  assert.equal(h.local.settings.pickerDone, true, 'existing choices are left alone');

  const fresh = harness();
  fresh.events.installed({ reason: 'install' });
  await fresh.settle();
  assert.notEqual(fresh.local.settings?.pickerDone, true, 'a new install still gets asked');
});

/* -------------------------------------------------------------------- *
 * Reachability check (P4, Q5)
 * -------------------------------------------------------------------- */

function checkHarness() {
  const h = harness();
  h.setRedirectors({
    fxtwitter: { id: 'fxtwitter', name: 'FxTwitter', template: 'https://fxtwitter.com/{path}{query}' },
    vxtwitter: { id: 'vxtwitter', name: 'vxTwitter', template: 'https://vxtwitter.com/{path}{query}' },
    threadreader: { id: 'threadreader', name: 'Thread Reader App', template: 'https://threadreaderapp.com/thread/{id}.html' },
    mine: { id: 'mine', name: 'Mine', template: 'https://mine.example/{path}', custom: true },
  });
  const check = (ids) => new Promise((resolve) => {
    h.events.message({ type: 'xit:check-hosts', ids }, {}, resolve);
  });
  return { ...h, check };
}

test('a host answering 503 is reported as failing, not healthy', async () => {
  // Q5: unrollnow answered 503, which an opaque no-cors request cannot tell
  // from a 200. Reading the status is the whole reason this needs a permission.
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*');
  h.answer({ 'https://fxtwitter.com/': 503 });
  const res = await h.check(['fxtwitter']);
  assert.equal(res.ok, true);
  assert.equal(res.results.fxtwitter.state, 'failing');
  assert.equal(res.results.fxtwitter.status, 503);
  assert.ok(res.results.fxtwitter.at > 0, 'and says when it was checked');
  assert.deepEqual(h.fetched, [{ url: 'https://fxtwitter.com/', method: 'HEAD' }]);
  // Observations are kept out of settings, so they are not exported as choices.
  assert.equal(h.local.hostChecks.fxtwitter.state, 'failing');
  assert.equal(h.local.settings?.hostChecks, undefined);
});

test('the check distinguishes answering, refusing and silent hosts', async () => {
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*', 'https://vxtwitter.com/*', 'https://threadreaderapp.com/*');
  h.answer({
    'https://fxtwitter.com/': 200,
    // A host that is up and simply does not take HEAD still counts as up.
    'https://vxtwitter.com/': 405,
    'https://threadreaderapp.com/': 'throw',
  });
  const res = await h.check(['fxtwitter', 'vxtwitter', 'threadreader']);
  assert.equal(res.results.fxtwitter.state, 'ok');
  assert.equal(res.results.vxtwitter.state, 'ok');
  assert.equal(res.results.threadreader.state, 'silent');
  assert.equal(res.results.threadreader.status, undefined);
});

test('nothing is requested without the permission, or for a host we cannot ask about', async () => {
  const h = checkHarness();
  await h.settle();
  h.answer({ 'https://fxtwitter.com/': 200, 'https://mine.example/': 200 });
  const denied = await h.check(['fxtwitter']);
  assert.equal(denied.results.fxtwitter.state, 'denied');

  // A template the user typed is not in optional_host_permissions, so there is
  // no origin to ask for and no request to make.
  const custom = await h.check(['mine']);
  assert.equal(custom.results.mine.state, 'unknown');
  assert.deepEqual(h.fetched, [], 'no network request either way');
});

test('the check only runs when asked, never on install, startup or a settings write', async () => {
  const h = checkHarness();
  h.grant('https://fxtwitter.com/*');
  h.answer({ 'https://fxtwitter.com/': 200 });
  h.events.installed({ reason: 'install' });
  h.events.startup();
  h.change({ name: 'second' });
  await h.settle();
  assert.deepEqual(h.fetched, [], 'xIT makes no network request of its own');
});

// Q1: the open command walks the same path as copy and diverges at the end.
test('the open command opens a tab instead of copying',async()=>{
  const h=harness();
  await h.settle();
  h.setRedirector({ id:'fx', name:'FxTwitter', template:'https://fxtwitter.com/{path}{query}' });
  // On an X tab the content script takes it, so the background does nothing.
  h.answerTab({ ok:true });
  await h.command('open-current-tweet');
  assert.equal(h.opened.length,0,'the content script handled it');
  assert.equal(h.injected.length,0,'and nothing was copied');
  // With no content script the background converts the tab URL itself.
  h.answerTab(null);
  await h.command('open-current-tweet');
  assert.deepEqual(h.opened.map((o)=>o.url),['https://fxtwitter.com/jack/status/20']);
  assert.equal(h.injected.length,0,'opening never writes to the clipboard');
  // The copy command still copies rather than opening.
  await h.command('copy-current-tweet');
  assert.equal(h.opened.length,1,'no second tab');
  assert.equal(h.sent.filter((m)=>m.type==='xit:clipboard').length+h.injected.length>0,true,
    'the copy path still reaches the clipboard');
});

test('an unknown command does nothing at all',async()=>{
  const h=harness();
  await h.settle();
  h.setRedirector({ id:'fx', name:'FxTwitter', template:'https://fxtwitter.com/{path}{query}' });
  h.answerTab(null);
  await h.command('not-a-command');
  assert.equal(h.opened.length,0);
  assert.equal(h.injected.length,0);
});

// The Chrome service worker loads its libraries with importScripts, and the
// Firefox event page from background.scripts. The unit harness injects them
// directly, so neither list is exercised by the tests above: a library this
// file uses but never imports is a ReferenceError on the first menu build, in
// Chrome only, at install time. This compares the lists against what the code
// actually references.
test('every library the background uses is in both load lists',async()=>{
  const source=readFileSync(new URL('../src/background.js',import.meta.url),'utf8');
  const build=readFileSync(new URL('../tools/build.mjs',import.meta.url),'utf8');
  const imported=/importScripts\(([^)]*)\)/.exec(source);
  assert.ok(imported,'the service worker still imports its libraries');
  const importList=Array.from(imported[1].matchAll(/'([^']+)'/g),(m)=>m[1]);
  const libLine=/const LIB = \[([^\]]*)\]/.exec(build);
  assert.ok(libLine,'tools/build.mjs still declares LIB');
  const manifestList=Array.from(libLine[1].matchAll(/'([^']+)'/g),(m)=>m[1]);
  // What the file references, by the global each library defines.
  const globals={ 'lib/i18n.js':'XITI18N', 'lib/redirectors.js':'XIT', 'lib/storage.js':'XITStore' };
  for (const [file,name] of Object.entries(globals)) {
    const used=new RegExp('\\b'+name+'\\.').test(source);
    if (!used) continue;
    assert.ok(importList.includes(file),
      `background.js uses ${name} but importScripts does not load ${file}, so Chrome would throw`);
    assert.ok(manifestList.includes(file),
      `background.js uses ${name} but LIB does not list ${file}, so Firefox would throw`);
  }
  // XIT is checked for before importing, so the guard must not be the global
  // that the first import defines or a reload would skip the rest.
  assert.match(source,/!globalThis\.(XITI18N|XIT|XITStore)\b/,'the import is still guarded');
});

// B10: the background used to fall back whenever the reply was not {ok:true},
// so a content script that looked at the tweet, found the redirector did not
// apply and toasted the reason was treated exactly like a tab with no content
// script at all. The user read a refusal and then a different link landed on
// the clipboard, with a second toast contradicting the first.
test('a content script that declines is not second-guessed',async()=>{
  const h=harness();
  await h.settle();
  h.setRedirector({ id:'fx', name:'FxTwitter', template:'https://fxtwitter.com/{path}{query}' });

  // It handled the command and refused. Nothing else may happen.
  h.answerTab({ ok:false, handled:true });
  await h.command('copy-current-tweet');
  assert.equal(h.injected.length,0,'no clipboard write behind a refusal');
  assert.equal(h.sent.filter((m)=>m.type==='xit:copy-text').length,0);
  await h.command('open-current-tweet');
  assert.equal(h.opened.length,0,'and no tab opened behind one either');

  // It handled the command and succeeded. Also nothing more to do.
  h.answerTab({ ok:true, handled:true });
  await h.command('copy-current-tweet');
  assert.equal(h.sent.filter((m)=>m.type==='xit:copy-text').length,0);

  // Nobody answered at all: this is the case the fallback exists for.
  h.dropContentScript();
  await h.command('copy-current-tweet');
  assert.equal(h.sent.filter((m)=>m.type==='xit:copy-text').length
    +h.injected.length>0,true,'with no content script the background copies');
});

// A tab open across an update keeps the previous content script until it
// reloads, and that version replies with `ok` alone. Success must still be
// recognised, or the keyboard shortcut would copy twice in those tabs.
test('a reply from a pre-update content script is still understood',async()=>{
  const h=harness();
  await h.settle();
  h.setRedirector({ id:'fx', name:'FxTwitter', template:'https://fxtwitter.com/{path}{query}' });
  h.answerTab({ ok:true });
  await h.command('copy-current-tweet');
  assert.equal(h.sent.filter((m)=>m.type==='xit:copy-text').length,0,
    'no second copy on top of the one that tab already made');
  await h.command('open-current-tweet');
  assert.equal(h.opened.length,0);
});

/* -------------------------------------------------------------------- *
 * Sweep 2
 * -------------------------------------------------------------------- */

test('a clean x.com link is copied in the chosen format', async () => {
  // Q6. Both of these went on the clipboard as a bare URL while every
  // redirector copy honoured the format, so two items in one menu disagreed
  // about a choice the user had made. Reverting either cleanCopy call in
  // background.js fails the matching assertion below, and the guard after it.
  const h = harness();
  h.setSettings({ copyFormat: 'markdown' });
  await h.settle();

  h.events.clicked({ menuItemId: 'xit-link-copy-original', linkUrl: 'https://x.com/jack/status/20?s=20' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.sent[0].text, '[@jack](https://x.com/jack/status/20)',
    'Copy x.com link is a copy like any other');

  // The same clean link by the other route: a redirector that does not apply.
  h.setRedirector({ name: 'Thread Reader App', template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'] });
  h.events.clicked({ menuItemId: 'xit-link-copy:threadreader', linkUrl: 'https://x.com/jack?s=20' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.sent[1].text, '[@jack](https://x.com/jack)',
    'and so is the fallback, which is handed to the user the same way');
});

test('no copy path reaches for a bare canonical link', async () => {
  // Q6 again, as a guard rather than a case. canonical returns a string and
  // drops the parts it computed, so a copy built on it cannot see the format
  // and silently ignores it: that is how all four of these came to disagree.
  // Opening on X is the one use left, since nothing is copied there.
  const uses = [];
  for (const file of ['src/background.js', 'src/popup/popup.js', 'src/content/inject.js']) {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const line of src.split('\n')) {
      if (line.includes('XIT.canonical')) uses.push(file + ': ' + line.trim());
    }
  }
  assert.equal(uses.length, 1, 'one use left, in openOriginal: ' + JSON.stringify(uses));
  assert.match(uses[0], /^src\/background\.js: const url = XIT\.canonical\(input,/);
});

test('a result is dropped once its redirector is gone', async () => {
  /*
   * C13. Nothing ever removed an entry from hostChecks, so a redirector the
   * user deleted left its reachability result in storage for good: a badge
   * for something that no longer exists, and a key that only grew.
   *
   * The prune is judged against every redirector that exists rather than
   * against the enabled ones, because disabling is a choice the user can take
   * back and the result still describes the same host.
   */
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*', 'https://mine.example/*');
  h.answer({ 'https://fxtwitter.com/': 200, 'https://mine.example/': 200 });
  await h.check(['fxtwitter', 'mine']);
  assert.deepEqual(Object.keys(h.local.hostChecks).sort(), ['fxtwitter', 'mine']);

  // The custom one is removed. Any removal route ends in a settings write.
  h.setRedirectors({
    fxtwitter: { id: 'fxtwitter', name: 'FxTwitter', template: 'https://fxtwitter.com/{path}{query}' },
  });
  h.change({ name: 'after-removal' });
  await h.settle();
  assert.deepEqual(Object.keys(h.local.hostChecks), ['fxtwitter'],
    'the removed redirector takes its result with it');
});

test('a disabled redirector keeps its result', async () => {
  // The other side of the same predicate: only non-existence drops an entry.
  // enabledRedirectors would have dropped this one, which is why the prune
  // asks allRedirectors.
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*');
  h.answer({ 'https://fxtwitter.com/': 200 });
  await h.check(['fxtwitter']);
  h.change({ enabledIds: [] });
  await h.settle();
  assert.deepEqual(Object.keys(h.local.hostChecks), ['fxtwitter']);
});

test('a settled check writes nothing on an ordinary settings change', async () => {
  // The prune runs on every settings write, so it must not turn each one into
  // a storage write of its own: that is a write the options page reacts to.
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*');
  h.answer({ 'https://fxtwitter.com/': 200 });
  await h.check(['fxtwitter']);
  const before = JSON.stringify(h.local.hostChecks);
  const writes = h.setCount();
  h.change({ name: 'unrelated' });
  await h.settle();
  assert.equal(JSON.stringify(h.local.hostChecks), before, 'results untouched');
  assert.equal(h.setCount(), writes, 'and no write at all when nothing was stale');
});

test('a result that lands after its redirector was removed is not written', async () => {
  /*
   * The window C13's prune cannot see. The check is as slow as the network,
   * up to forty requests of it, so a redirector can be removed while it runs.
   * Its own result then arrives afterwards: filtering against the settings
   * the check began with would write that entry back in behind the prune, and
   * nothing would clear it until the next settings write.
   *
   * Reusing the settings from the top of checkHosts makes this fail.
   */
  const h = checkHarness();
  await h.settle();
  h.grant('https://fxtwitter.com/*');
  h.answer({ 'https://fxtwitter.com/': 200 });
  h.onFetch(() => { h.change({ removedIds: ['fxtwitter'] }); });
  const res = await h.check(['fxtwitter']);
  assert.equal(res.ok, true, 'the check itself still answers the page');
  assert.equal(res.results.fxtwitter.state, 'ok', 'and still reports what it found');
  assert.equal(h.local.hostChecks.fxtwitter, undefined,
    'but nothing is stored for a redirector that went away mid-check');
});
