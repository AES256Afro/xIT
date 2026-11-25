import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, REAL } from './helpers/background.mjs';

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
  // The rules 1.0.3 left are met when the update installs, which is the event
  // that runs the cleanup. A plain settings write no longer does (O6).
  h.failCreate();h.setSettings({name:'after-update'});h.events.installed({reason:'update'});await h.settle();
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
  // Three trees: one on links, one on selected text (P5), one on the page.
  // The link and selection trees come to eight items each with one
  // redirector configured, because the capped menu puts its entries at the
  // top level rather than inside a group submenu (U3); the page tree is four.
  assert.equal(h.menus.size,20);
  assert.ok(h.menus.has('xit-link-open-original'));
  assert.ok(h.menus.has('xit-sel-open-original'));
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

/* ---- P5: the selection menu ---- */

test('a tweet link buried in selected text is found and converted', async () => {
  /*
   * P5. The menus could only act on something the browser had already called
   * a link, a page or a frame, so a tweet URL sitting in prose had no route
   * but the popup's paste field. The selection carries text, not a URL.
   *
   * Taking XIT.findLink out of the target line makes this fail: the handler
   * then falls back to the tab, which is not X at all here.
   */
  const h = harness();
  await h.settle();

  h.events.clicked({
    menuItemId: 'xit-sel-copy-default',
    selectionText: 'worth reading: https://x.com/jack/status/20?s=20 (via a mailing list)',
  }, { id: 7, index: 2, url: 'https://lists.example.org/thread/4812' });
  await h.settle();

  assert.equal(h.sent.length, 1, 'exactly one clipboard write');
  assert.equal(h.sent[0].text, 'https://example.com/jack/status/20');
});

test('a selection with no tweet link copies nothing and says so', async () => {
  /*
   * B10's lesson applied to a new route: the worst outcome here is leaving
   * the clipboard holding whatever it held and letting the user paste that.
   * Nothing is copied, and the tab is told why.
   *
   * Dropping the early return makes this fail on the clipboard write, since
   * the handler would go on to convert an empty target.
   */
  const h = harness();
  await h.settle();

  h.events.clicked({ menuItemId: 'xit-sel-copy-default', selectionText: 'no link here, just x.com in passing' },
    { id: 7, index: 2, url: 'https://x.com/home' });
  await h.settle();

  const writes = h.sent.filter((m) => m.type === 'xit:copy-text');
  assert.deepEqual(writes, [], 'nothing should reach the clipboard');
  const said = h.sent.filter((m) => m.type === 'xit:toast');
  assert.equal(said.length, 1);
  assert.match(said[0].text, /No tweet link/);
  assert.deepEqual(h.errors, []);
});

test('off an X page a selection with no tweet link fails quietly rather than throwing', async () => {
  // There is no content script off X, so there is no toast either. That is a
  // limitation of having no UI on pages xIT does not script, and the point of
  // this test is that it stays a limitation rather than becoming an error.
  const h = harness();
  await h.settle();
  h.dropContentScript();

  h.events.clicked({ menuItemId: 'xit-sel-copy-default', selectionText: 'nothing to find' },
    { id: 7, index: 2, url: 'https://lists.example.org/thread/4812' });
  await h.settle();

  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.injected, [], 'nothing was copied, so nothing was injected');
  assert.deepEqual(h.errors, []);
});

test('the selection menu is not restricted to any host', async () => {
  /*
   * The whole point is text on a page xIT knows nothing about, and the
   * browser cannot say what a selection holds before the menu opens, so
   * there is nothing to match on. Adding either pattern list to the
   * selection context would make the feature useless off X and this fail.
   */
  const h = harness();
  await h.settle();
  const root = h.menus.get('xit-sel-root');
  // Array.from first: the array was made inside the vm realm, so its
  // prototype is not this realm's and a strict deepEqual compares those too.
  assert.deepEqual(Array.from(root.contexts), ['selection']);
  assert.equal(root.targetUrlPatterns, undefined);
  assert.equal(root.documentUrlPatterns, undefined);

  const link = h.menus.get('xit-link-root');
  assert.ok(link.targetUrlPatterns.length, 'the link menu still only offers itself on tweet links');
});

test('the selection menu offers exactly what the link menu offers', async () => {
  /*
   * Somebody who right-clicked a selection wants what somebody who
   * right-clicked a link wants, and the two trees are built by one function
   * so they cannot drift. Writing the selection tree out a second time, by
   * hand, is what this is here to stop: it would pass today and rot later.
   */
  const h = harness();
  await h.settle();
  const suffixes = (prefix) => [...h.menus.keys()]
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length))
    .sort();

  assert.deepEqual(suffixes('xit-sel-'), suffixes('xit-link-'));
  assert.ok(suffixes('xit-sel-').includes('copy-original'));
});

test('every selection item works, not only the default one', async () => {
  // The id is read as a scope and then an action, so one branch serves all
  // three scopes. These are the paths that branch has to carry.
  const h = harness();
  await h.settle();
  const text = 'see https://x.com/jack/status/20 for the rest';

  h.events.clicked({ menuItemId: 'xit-sel-copy:example', selectionText: text }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.sent[0].text, 'https://example.com/jack/status/20');

  h.events.clicked({ menuItemId: 'xit-sel-copy-original', selectionText: text }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.sent[1].text, 'https://x.com/jack/status/20');

  h.events.clicked({ menuItemId: 'xit-sel-open:example', selectionText: text }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.opened[0].url, 'https://example.com/jack/status/20');

  h.events.clicked({ menuItemId: 'xit-sel-open-original', selectionText: text }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.opened[1].url, 'https://x.com/jack/status/20');
  assert.deepEqual(h.errors, []);
});

test('a separator or a group heading is not a click', async () => {
  // Both carry ids under the same prefixes and neither is clickable. They
  // used to fall out of a regex that only matched copy: and open:; they now
  // fall out of one that matches anything, so this is worth holding.
  const h = harness();
  await h.settle();
  for (const id of ['xit-sel-sep1', 'xit-link-sep2', 'xit-sel-root', 'xit-link-g-test']) {
    h.events.clicked({ menuItemId: id, selectionText: 'https://x.com/jack/status/20' }, { id: 7, index: 2 });
  }
  await h.settle();
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.errors, []);
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
  assert.equal(h.menus.has('xit-sel-g-test'), true, 'and so is the selection menu');
  // Two group parents, not one: the link and selection trees both group.
  assert.equal(h.menus.size, flat + 2);
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

test('an Open that the redirector cannot take opens nothing and leaves the clipboard alone', async () => {
  /*
   * B14. The fallback for a redirector that declines a link copied the clean
   * x.com link whatever the action was, so "Open with Thread Reader App" on a
   * profile overwrote the clipboard and opened no tab. Somebody who asked to
   * open something did not ask to lose what they had copied. The tab is told
   * why instead.
   *
   * Letting open actions fall through to the copy fallback makes this fail.
   */
  const h = harness();
  await h.settle();
  h.setRedirector({ name: 'Thread Reader App', template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'] });

  h.events.clicked({ menuItemId: 'xit-link-open:threadreader', linkUrl: 'https://x.com/jack?s=20' }, { id: 7, index: 2 });
  await h.settle();

  assert.deepEqual(h.sent.filter((m) => m.type === 'xit:copy-text'), [], 'nothing should reach the clipboard');
  assert.deepEqual(h.opened, [], 'and nothing is opened');
  const said = h.sent.filter((m) => m.type === 'xit:toast');
  assert.equal(said.length, 1, 'the tab is told why');
  assert.match(said[0].text, /specific tweet/);
});

test('a host that redirects somewhere else is reported as answering', async () => {
  /*
   * B15 and S8. vxTwitter, enabled on install, answers its front page with a
   * redirect to github.com, and FixVX redirects to vxTwitter. The check
   * followed redirects, so it went on to a host nobody had granted, the
   * browser refused the cross-origin response, and a working redirector was
   * shown as "No answer". It also meant the request reached a host the
   * privacy policy says it never goes to. A redirect is an answer, so it is
   * now read as one and not followed.
   *
   * Going back to redirect: 'follow' makes this fail.
   */
  const h = checkHarness();
  await h.settle();
  h.grant('https://vxtwitter.com/*');
  h.answer({ 'https://vxtwitter.com/': 'elsewhere' });
  const res = await h.check(['vxtwitter']);
  assert.equal(res.ok, true);
  assert.equal(res.results.vxtwitter.state, 'ok', 'a redirect means the host answered');
  assert.deepEqual(h.fetched.map((f) => f.url), ['https://vxtwitter.com/'], 'and nothing else was asked');
});

test('a copy that fails off X marks the toolbar icon on that tab', async () => {
  /*
   * Q8. Off X there is no content script and so no toast, and when the
   * fallback write fails too, on a page the browser will not script, the
   * failure went nowhere: the user pasted whatever the clipboard held
   * before. The toolbar icon on that tab now says so for a few seconds,
   * which needs nothing injected into the page.
   *
   * Taking the flash out of copyInTab makes this fail.
   */
  const h = harness();
  await h.settle();
  h.dropContentScript();
  h.failInjection();
  h.events.clicked({ menuItemId: 'xit-link-copy:example', linkUrl: 'https://x.com/jack/status/20' }, { id: 7, index: 2 });
  await h.settle();
  const marks = h.badgeCalls.filter((c) => c.tabId === 7);
  assert.ok(marks.some((c) => c.text === '!'), 'the icon is marked');
  assert.ok(marks.some((c) => /copy/i.test(c.title || '')), 'and its tooltip says what failed');
});

test('a copy that works leaves the toolbar icon alone', async () => {
  const h = harness();
  await h.settle();
  h.dropContentScript();
  h.events.clicked({ menuItemId: 'xit-link-copy:example', linkUrl: 'https://x.com/jack/status/20' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.injected.length, 1, 'the fallback write ran');
  assert.deepEqual(h.badgeCalls, []);
});

test('a content script can pin and choose a default, and change nothing else', async () => {
  /*
   * S7. The settings writer took any operation from any of our senders,
   * content scripts included, and the content script only ever pins an entry
   * or picks the default from the tweet menu. A renderer for x.com that had
   * been compromised could have replaced the whole configuration, a custom
   * default aimed at its own host included. Extension pages keep every
   * operation; a content script gets the two it needs.
   *
   * Senders are told apart by URL. Settings opens in a tab of its own, so a
   * first version that tested for sender.tab locked Settings out of every
   * save; the Chrome and Firefox suites caught it, and the Settings sender
   * below, which has a tab, is here so this file catches it too.
   *
   * Dropping the sender check from the mutate handler makes this fail.
   */
  const h = harness();
  await h.settle();
  const send = async (operation, sender) => {
    let reply = null;
    h.events.message({ type: 'xit:mutate-settings', operation }, sender, (value) => { reply = value; });
    await h.settle();
    return reply;
  };
  const tab = { tab: { id: 7, index: 2 }, url: 'https://x.com/jack/status/20' };
  const settingsPage = { tab: { id: 8, index: 3 }, url: 'chrome-extension://test/options/options.html' };
  const popup = { url: 'chrome-extension://test/popup/popup.html' };
  const writes = () => h.rewrites.slice();

  const before = writes().length;
  assert.equal((await send({ type: 'replace', settings: {} }, tab)).ok, false, 'a tab cannot replace settings');
  assert.equal((await send({ type: 'add-custom', entry: { name: 'x', template: 'https://evil.example/{path}' } }, tab)).ok, false);
  assert.equal((await send({ type: 'patch', patch: { defaultRedirector: 'fxtwitter', custom: [] } }, tab)).ok, false,
    'nor slip another field in beside the default');
  assert.equal(writes().length, before, 'and none of those reached the writer');

  assert.equal((await send({ type: 'pin', id: 'fxtwitter', pinned: true }, tab)).ok, true, 'a tab can pin');
  assert.equal((await send({ type: 'patch', patch: { defaultRedirector: 'vxtwitter' } }, tab)).ok, true, 'and choose the default');
  assert.equal((await send({ type: 'replace', settings: {} }, settingsPage)).ok, true,
    'Settings, which has a tab of its own, can still do anything');
  assert.equal((await send({ type: 'reset' }, popup)).ok, true, 'and so can the popup');
  assert.equal((await send({ type: 'replace', settings: {} }, {})).ok, false,
    'a sender that cannot show it is ours is treated as a page');
});

test('Chrome waking the worker again does not rebuild menus or rerun cleanups', async () => {
  /*
   * C14 and O6. Every service worker start ran init('wake'), which removed
   * every context menu and created them again, 20 to 40 calls in a row, and
   * reran three cleanups that only ever have anything to do once. Chrome
   * keeps menus across worker restarts, and the worker restarts after
   * every idle half minute, so this was nearly all repeated work, with a
   * window in which a right-click found the menu half built.
   *
   * Going back to rebuilding on every wake makes this fail.
   */
  const session = {};
  const first = harness(false, { session });
  await first.settle();
  assert.ok(first.createCount() > 0, 'the first start builds the menu');
  assert.ok(first.dnrReads() > 0, 'and cleans up once');

  const again = harness(false, { session });
  await again.settle();
  assert.equal(again.removeAllCalls(), 0, 'a later wake removes nothing');
  assert.equal(again.createCount(), 0, 'and creates nothing');
  assert.equal(again.dnrReads(), 0, 'and does not rerun the cleanup');
});

test('a woken worker still rebuilds when the menu really changed', async () => {
  const session = {};
  const first = harness(false, { session });
  await first.settle();
  const again = harness(false, { session });
  await again.settle();
  again.change({ name: 'second' });
  await again.settle();
  assert.ok(again.createCount() > 0, 'a settings change the menu depends on rebuilds it');
});

test('browser startup still cleans up even after a woken worker skipped it', async () => {
  const session = {};
  const first = harness(false, { session });
  await first.settle();
  const again = harness(false, { session });
  await again.settle();
  again.events.startup();
  await again.settle();
  assert.ok(again.dnrReads() > 0, 'startup always runs the cleanup');
  assert.ok(again.createCount() > 0, 'and builds the menu');
});

test('Firefox rebuilds its menus on every start', async () => {
  // Chrome documents that menus outlive a worker restart; Firefox's event
  // pages are not relied on to do the same, so they keep rebuilding.
  const session = {};
  const first = harness(true, { session });
  await first.settle();
  const again = harness(true, { session });
  await again.settle();
  assert.ok(again.createCount() > 0);
});

test('the link and page menus also appear on links already on a redirector', async () => {
  /*
   * P6. The link menu matched x.com and twitter.com only, so a link already
   * on fxtwitter, a thread reader, or a withdrawn front-end, as found in a
   * chat app or an archive, got no xIT menu, although the parser can read it
   * back and Open on X exists for exactly that case. A custom redirector's
   * host is included when it can be written as a match pattern; one that
   * cannot, such as an address, is left out rather than risk the browser
   * refusing the whole menu.
   *
   * Going back to the X patterns alone makes this fail.
   */
  const h = harness();
  await h.settle();
  for (const id of ['xit-link-root', 'xit-page-root']) {
    const menu = h.menus.get(id);
    const patterns = Array.from(menu.targetUrlPatterns || menu.documentUrlPatterns);
    for (const want of ['*://x.com/*', '*://fxtwitter.com/*', '*://threadreaderapp.com/*',
      '*://twitter-thread.com/*', '*://xcancel.com/*', '*://example.com/*']) {
      assert.ok(patterns.includes(want), `${id} should match ${want}`);
    }
    assert.ok(patterns.every((p) => /^\*:\/\/[a-z0-9.-]+\/\*$/.test(p)), `${id} holds only plain host patterns`);
  }
});

test('Open on X works from a link on a thread reader', async () => {
  const h = harness();
  await h.settle();
  h.events.clicked({ menuItemId: 'xit-link-open-original', linkUrl: 'https://threadreaderapp.com/thread/20.html' }, { id: 7, index: 2 });
  await h.settle();
  assert.equal(h.opened.at(-1).url, 'https://x.com/i/web/status/20');
});
