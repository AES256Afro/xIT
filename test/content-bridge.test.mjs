import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const script = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

async function bridge({ mainFirst = true } = {}) {
  const listeners = [];
  const pending = [];
  const copied = [];
  let changeSettings;
  const window = {
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(data) { pending.push(data); },
  };
  const settings = {
    copyButton: true, hijackNativeCopy: true, stripTracking: true,
    toast: false, defaultRedirector: 'fxtwitter',
  };
  const clipboard = { async writeText(text) { copied.push(text); } };
  const fallbackCopied = [];
  const docListeners = [];
  const shared = { console, URL, URLSearchParams, window, location: new URL('https://x.com/jack/status/20') };
  const main = vm.createContext({ ...shared, navigator: { clipboard } });
  const isolated = vm.createContext({
    ...shared,
    navigator: { clipboard: { async writeText(text) { fallbackCopied.push(text); } } },
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      body: {}, documentElement: { setAttribute() {} },
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
    vm.runInContext(script('lib/redirectors.js'), isolated);
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
  return { clipboard, copied, fallbackCopied, drain, clickNativeCopy,
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
