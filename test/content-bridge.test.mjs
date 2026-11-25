import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeI18n } from './helpers/i18n-stub.mjs';
import { setImmediate } from 'node:timers/promises';
import { makeDom } from './helpers/dom.mjs';

const script = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

async function bridge({ mainFirst = true, toast = false, holdLoad = false } = {}) {
  // holdLoad keeps the content script's first settings read waiting until a
  // test calls release(), which is how a message can arrive before it is ready.
  let release = () => {};
  const loadGate = holdLoad ? new Promise((resolve) => { release = resolve; }) : null;
  const listeners = [];
  // The content script's own runtime messages. Nothing captured these before,
  // so removing one of its handlers broke no test: a gap found by reverting
  // the P5 handler and seeing the suite stay green.
  const onMessage = [];
  const dom = makeDom();
  const pending = [];
  const copied = [];
  let changeSettings;
  const window = {
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(data) { pending.push(data); },
  };
  const settings = {
    copyButton: true, hijackNativeCopy: true, stripTracking: true,
    toast, defaultRedirector: 'fxtwitter',
  };
  const clipboard = { async writeText(text) { copied.push(text); } };
  const fallbackCopied = [];
  const docListeners = [];
  const shared = { console, URL, URLSearchParams, window, setTimeout, clearTimeout,
    location: new URL('https://x.com/jack/status/20') };
  const main = vm.createContext({ ...shared, navigator: { clipboard } });
  const isolated = vm.createContext({
    ...shared,
    navigator: { clipboard: { async writeText(text) { fallbackCopied.push(text); } } },
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
    chrome: { runtime: { onMessage: { addListener(fn) { onMessage.push(fn); } } } },
    document: {
      body: dom.document.body,
      createElement: (tag) => dom.document.createElement(tag),
      documentElement: { setAttribute() {} },
      addEventListener(type, listener) { docListeners.push({ type, listener }); },
      dispatchEvent() { return true; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    getComputedStyle() { return { backgroundColor: 'rgb(0, 0, 0)' }; },
    MutationObserver: class { observe() {} },
    requestAnimationFrame() {},
    XITStore: {
      async load() { if (loadGate) await loadGate; return settings; },
      extraHosts() { return new Set(); },
      defaultRedirector(s) {
        if (s.customTemplate) return { name: 'Mine', template: s.customTemplate, custom: true };
        return { name: s.defaultRedirector, template: `https://${s.defaultRedirector}.com/{path}{query}` };
      },
      onChanged(cb) { changeSettings = cb; },
    },
  });
  function startMain() {
    vm.runInContext(script('lib/redirectors.js'), main);
    vm.runInContext(script('content/main-world.js'), main);
  }
  async function startIsolated() {
    isolated.chrome = { ...(isolated.chrome || {}), i18n: fakeI18n() };
    vm.runInContext(script('lib/i18n.js'), isolated);
    vm.runInContext(script('lib/redirectors.js'), isolated);
    // The manifest lists lib/i18n.js before content/inject.js, so this is the
    // order the browser uses. With no chrome.i18n here every string falls back
    // to the English the code passes, which is also what the assertions read.
    vm.runInContext(script('lib/clipboard.js'), isolated);
    vm.runInContext(script('content/inject.js'), isolated);
    await setImmediate();
  }
  function drain() {
    let count = 0;
    while (pending.length) {
      assert.ok(++count <= 20, 'Content bridge must settle instead of endlessly exchanging messages');
      const data = pending.shift();
      for (const listener of [...listeners]) listener({ source: window, data });
    }
  }
  if (mainFirst) {
    startMain();
    drain(); // document_start hello arrives before the isolated listener exists.
    await startIsolated();
  } else {
    await startIsolated();
    drain();
    startMain();
  }
  drain();
  // Fire X's own "Copy link" menu item, which is what the isolated world's
  // DOM-level fallback listens for.
  async function clickNativeCopy() {
    const item = { textContent: 'Copy link', closest: () => item };
    const ev = { target: { closest: (sel) => (/menuitem|copy-link/.test(sel) ? item : null) },
      preventDefault() {}, stopPropagation() {} };
    for (const { type, listener } of docListeners) if (type === 'click') listener(ev);
    await setImmediate();
  }
  /**
   * X's own "Copy link", as a user does it: a genuine click on the menu item,
   * whose label is in whatever language X is in, then X's clipboard call,
   * which goes through the main world's wrapper.
   */
  async function nativeCopy(url, { label = 'Copy link', trusted = true } = {}) {
    const item = { textContent: label, closest: () => item };
    const ev = { isTrusted: trusted, target: { closest: (sel) => (/menuitem|copy-link/.test(sel) ? item : null) },
      preventDefault() {}, stopPropagation() {} };
    for (const { type, listener } of docListeners) if (type === 'click') listener(ev);
    await clipboard.writeText(url);
    drain();
    await setImmediate();
  }
  /** Deliver a message without waiting, and report whether a listener threw. */
  function sendNow(message, reply) {
    const out = { threw: null };
    for (const listener of onMessage) {
      try { listener(message, {}, reply); } catch (error) { out.threw = error; }
    }
    return out;
  }
  /** Deliver a runtime message to the content script, as the background does. */
  async function send(message) {
    const replies = [];
    for (const listener of onMessage) listener(message, {}, (value) => replies.push(value));
    await setImmediate();
    return replies;
  }
  return { release, sendNow, dom, clipboard, copied, fallbackCopied, drain, clickNativeCopy, nativeCopy, send,
    // The live region exists, empty, from startup (U13); only text is a toast.
    toasts: () => dom.document.body.querySelectorAll('.xit-toast').map((el) => el.textContent).filter(Boolean),
    push(data) { pending.push(data); drain(); },
    update(patch) { changeSettings({ ...settings, ...patch }); drain(); } };
}

for (const mainFirst of [true, false]) {
  test(`content bridge settles and copies links with mainFirst=${mainFirst}`, async () => {
    const b = await bridge({ mainFirst });
    await b.clipboard.writeText('https://x.com/jack/status/20?s=20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://fxtwitter.com/jack/status/20');
    b.update({ defaultRedirector: 'vxtwitter' });
    await b.clipboard.writeText('https://x.com/jack/status/20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://vxtwitter.com/jack/status/20');
    b.update({ hijackNativeCopy: false });
    await b.clipboard.writeText('https://x.com/jack/status/20?s=20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://x.com/jack/status/20?s=20');
  });
}

test('the main world refuses a template that is not a bundled preset', async () => {
  const b = await bridge();
  b.update({ customTemplate: 'https://evil.example/{path}' });
  await b.clipboard.writeText('https://x.com/jack/status/20?s=20');
  b.drain();
  // The page's own clipboard call is left alone rather than being pointed at
  // a host the main world cannot vouch for.
  assert.equal(b.copied.at(-1), 'https://x.com/jack/status/20?s=20');
});

test('a declined template falls back to the isolated world, so a custom default still works', async () => {
  const b = await bridge();
  b.update({ customTemplate: 'https://mine.example/{path}' });
  await b.nativeCopy('https://x.com/jack/status/20?s=20');
  assert.equal(b.copied.at(-1), 'https://x.com/jack/status/20?s=20', 'the main world leaves X\'s copy alone');
  assert.equal(b.fallbackCopied.at(-1), 'https://mine.example/jack/status/20', 'and the isolated world finishes it');
});

test('a custom default works on X in any language', async () => {
  /*
   * B17. The fallback found X's menu item by the English words "copy link",
   * so on X in Spanish, Japanese or anything else a custom default silently
   * left the plain x.com link on the clipboard. The main world now reports
   * the declined copy itself, and no label is read.
   *
   * Restoring the text match as the only route makes this fail.
   */
  for (const label of ['Copiar enlace', 'リンクをコピー', 'Link kopieren']) {
    const b = await bridge();
    b.update({ customTemplate: 'https://mine.example/{path}' });
    await b.nativeCopy('https://x.com/jack/status/20', { label });
    assert.equal(b.fallbackCopied.at(-1), 'https://mine.example/jack/status/20', label);
  }
});

test('a page script cannot make the isolated world copy without a real click', async () => {
  // The report travels over postMessage, which any page script can send. With
  // no genuine gesture just before it, it is ignored.
  const b = await bridge();
  b.update({ customTemplate: 'https://mine.example/{path}' });
  b.push({ __xit: 'declined-copy', text: 'https://x.com/jack/status/20' });
  await setImmediate();
  assert.deepEqual(b.fallbackCopied, [], 'a forged report alone copies nothing');
  await b.nativeCopy('https://x.com/jack/status/20', { trusted: false });
  assert.deepEqual(b.fallbackCopied, [], 'nor does one after a scripted click');
});

test('a declined copy of a page that is not a tweet is left as X wrote it', async () => {
  const b = await bridge({ toast: true });
  b.update({ customTemplate: 'https://mine.example/{path}' });
  await b.nativeCopy('https://x.com/i/lists/123');
  assert.deepEqual(b.fallbackCopied, []);
  assert.deepEqual(b.toasts(), [], 'and no error is shown for it');
});

test('a preset default is handled in the main world, not twice', async () => {
  const b = await bridge();
  await b.clickNativeCopy();
  assert.deepEqual(b.fallbackCopied, []);
  await b.clipboard.writeText('https://x.com/jack/status/20');
  b.drain();
  assert.equal(b.copied.at(-1), 'https://fxtwitter.com/jack/status/20');
});

test('a page script cannot aim the native copy at a host of its own', async () => {
  const b = await bridge();
  b.push({ __xit: 'config', payload: { enabled: true, template: 'https://evil.example/{path}', name: 'Evil', stripTracking: true } });
  await b.clipboard.writeText('https://x.com/jack/status/20');
  b.drain();
  assert.equal(b.copied.at(-1), 'https://x.com/jack/status/20');
});

test('a page script cannot disarm the fallback by claiming the main world accepted', async () => {
  const b = await bridge();
  b.update({ customTemplate: 'https://mine.example/{path}' });
  b.push({ __xit: 'ready', declined: false });
  await b.nativeCopy('https://x.com/jack/status/20');
  assert.equal(b.fallbackCopied.at(-1), 'https://mine.example/jack/status/20');
});

test('the content script shows a toast the background asks for, and nothing else', async () => {
  /*
   * P5: a selection holding no tweet link leaves nothing to copy, and the
   * background has to say so rather than let the user paste whatever was on
   * the clipboard before. There was no toast-only message, so one was added.
   *
   * This exists because reverting that handler broke no test: nothing here
   * had ever delivered a runtime message to the content script at all.
   * Deleting the handler now fails this.
   */
  const b = await bridge({ toast: true });

  const replies = await b.send({ type: 'xit:toast', text: 'No tweet link in what you selected.' });
  // The reply was made inside the vm realm, so its prototype is not this
  // realm's and a strict deepEqual would compare those too.
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.deepEqual(b.toasts(), ['No tweet link in what you selected.']);
  assert.deepEqual(b.copied, [], 'a toast is not a copy');

  // An unknown type is left alone, so another extension's message or a later
  // version's cannot make this one answer for it.
  const ignored = await b.send({ type: 'xit:not-a-thing', text: 'should not show' });
  assert.deepEqual(ignored, []);
  assert.deepEqual(b.toasts(), ['No tweet link in what you selected.']);
});

test('turning confirmations off hides confirmations, not problems', async () => {
  /*
   * B16. The switch reads "Confirm copies with a toast", and toast() used to
   * return early for every kind when it was off. That also hid the clipboard
   * failure, the "copied the clean link instead" warning and the background's
   * "no tweet link in what you selected", which are exactly the notices B1,
   * B10 and P5 were fixed to show.
   *
   * Putting the early return back for every kind makes this fail.
   */
  const b = await bridge({ toast: false });
  await b.send({ type: 'xit:copy-text', text: 'https://fxtwitter.com/jack/status/20' });
  assert.deepEqual(b.toasts(), [], 'a plain confirmation stays hidden');

  await b.send({ type: 'xit:toast', text: 'No tweet link in what you selected.' });
  assert.deepEqual(b.toasts(), ['No tweet link in what you selected.'], 'a warning still shows');

  await b.send({ type: 'xit:copy-text', text: 'https://x.com/jack', note: 'Copied the clean x.com link instead.' });
  assert.deepEqual(b.toasts(), ['Copied the clean x.com link instead.'], 'so does a substitution');
});

test('the toast\'s live region is on the page before its first message', async () => {
  /*
   * U13. The toast element was created in the same moment its first text
   * was set, and screen readers announce changes to a live region that
   * already exists, not one that arrives with its content. It is now made,
   * empty, when the content script starts.
   *
   * Creating it lazily inside toast() again makes this fail.
   */
  const b = await bridge({ toast: true });
  const region = b.dom.document.body.querySelectorAll('.xit-toast');
  assert.equal(region.length, 1, 'one live region, before anything is announced');
  assert.equal(region[0].getAttribute('role'), 'status');
  assert.equal(region[0].getAttribute('aria-live'), 'polite');
  assert.equal(region[0].textContent, '', 'and empty');
  await b.send({ type: 'xit:toast', text: 'Something to say' });
  assert.equal(b.dom.document.body.querySelectorAll('.xit-toast').length, 1, 'the same region is reused');
});

test('a keyboard command that arrives before settings load waits for them', async () => {
  /*
   * B19. The background can deliver the shortcut to a tab whose content
   * script has not finished reading settings yet, just after a page load.
   * The handler read settings.stripTracking on null, threw, and never
   * replied, so the shortcut did nothing. It now waits for startup.
   *
   * Running the handler straight away again makes this fail.
   */
  const b = await bridge({ holdLoad: true });
  const replies = [];
  const sent = b.sendNow({ type: 'xit:copy-current' }, (value) => replies.push(value));
  await setImmediate();
  assert.equal(sent.threw, null, 'the handler does not throw while settings are loading');
  assert.deepEqual(replies, [], 'and has not answered yet');
  b.release();
  for (let i = 0; i < 6; i++) await setImmediate();
  assert.equal(replies.length, 1, 'it answers once settings are in');
  assert.equal(replies[0].handled, true);
  assert.equal(b.fallbackCopied.at(-1), 'https://fxtwitter.com/jack/status/20');
});
