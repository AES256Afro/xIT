import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
      set: async (value) => { Object.assign(local, value); },
    } },
    action: { setBadgeText: async ({ text }) => { badge.text = text; } },
    tabs: {
      sendMessage: async (tabId, message) => {
        if (noContentScript) throw new Error('could not establish connection');
        sent.push({ tabId, ...message });
        return { ok: true };
      },
      create: async (opts) => { opened.push(opts); return { id: 99 }; },
      query: async () => [],
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
    menuRedirectors: (s) => store.enabledRedirectors(s),
    // Stands in for the real fingerprint: enough that a change the menu does
    // depend on looks different and one it does not looks the same.
    menuSignature: (s) => JSON.stringify([!!s.contextMenu, !!s.contextMenuAll, s.name]),
    defaultRedirector: (s) => ({name:s.name}),
    findRedirector: (s, id) => byId[id] || redirector,
    extraHosts: () => new Set(['example.com']),
  };
  async function fakeFetch(url, options) {
    fetched.push({ url, method: options && options.method });
    const answer = answers[url];
    if (answer === undefined || answer === 'throw') throw new Error('network');
    return { status: answer, ok: answer < 400 };
  }
  const ctx = vm.createContext({ ...(firefox ? { browser: api } : { chrome: api }), console: { warn() {} }, XIT: {
    GROUPS: [{id:'test',label:'Test'}],
    HOST_PATTERNS: REAL.HOST_PATTERNS,
    convert: REAL.convert, canonical: REAL.canonical,
    isSourceHost: REAL.isSourceHost, bareHost: REAL.bareHost,
    checkOrigin: REAL.checkOrigin,
  }, XITStore: store, URL, Set, fetch: fakeFetch,
  AbortController, setTimeout, clearTimeout, Date });
  vm.runInContext(readFileSync(new URL('../src/background.js', import.meta.url),'utf8'),ctx);
  async function settle() { for (let i=0;i<150;i++) await tick(); }
  return { menus, errors, events, settle, local, rules:()=>rules, setRules:(r)=>{rules=r;}, ruleUpdates:()=>ruleUpdates,
    rewrites, badge, createCount: () => created,
    sent, opened, injected,
    setRedirector(value) { redirector = value; },
    setRedirectors(map) { byId = map; },
    grant(...origins) { for (const o of origins) grantedOrigins.add(o); },
    answer(map) { answers = { ...answers, ...map }; },
    fetched,
    dropContentScript() { noContentScript = true; },
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
