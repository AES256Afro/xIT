import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeI18n } from './helpers/i18n-stub.mjs';
import { setImmediate } from 'node:timers/promises';
import { makeDom } from './helpers/dom.mjs';

const script = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

async function bridge({ mainFirst = true, toast = false } = {}) {
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
      async load() { return settings; },
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
  /** Deliver a runtime message to the content script, as the background does. */
  async function send(message) {
    const replies = [];
    for (const listener of onMessage) listener(message, {}, (value) => replies.push(value));
    await setImmediate();
    return replies;
  }
  return { clipboard, copied, fallbackCopied, drain, clickNativeCopy, send,
    toasts: () => dom.document.body.querySelectorAll('.xit-toast').map((el) => el.textContent),
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
  await b.clickNativeCopy();
  assert.equal(b.fallbackCopied.at(-1), 'https://mine.example/jack/status/20');
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
  await b.clickNativeCopy();
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

test('a toast is suppressed when the user turned confirmations off', async () => {
  // toast() opens with that check, and the background passes this message
  // whatever the setting says, so the setting is honoured here or nowhere.
  const b = await bridge({ toast: false });
  await b.send({ type: 'xit:toast', text: 'nothing to see' });
  assert.deepEqual(b.toasts(), []);
});
