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
  const shared = { console, URL, URLSearchParams, window, location: new URL('https://x.com/home') };
  const main = vm.createContext({ ...shared, navigator: { clipboard } });
  const isolated = vm.createContext({
    ...shared,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      body: {}, documentElement: { setAttribute() {} },
      addEventListener() {}, querySelectorAll() { return []; },
    },
    getComputedStyle() { return { backgroundColor: 'rgb(0, 0, 0)' }; },
    MutationObserver: class { observe() {} },
    requestAnimationFrame() {},
    XITStore: {
      async load() { return settings; },
      extraHosts() { return new Set(); },
      defaultRedirector(s) {
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
  return { clipboard, copied, drain, update(patch) { changeSettings({ ...settings, ...patch }); drain(); } };
}

for (const mainFirst of [true, false]) {
  test(`content bridge settles and copies links with mainFirst=${mainFirst}`, async () => {
    const b = await bridge({ mainFirst });
    await b.clipboard.writeText('https://x.com/jack/status/20?s=20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://fxtwitter.com/jack/status/20');
    b.update({ defaultRedirector: 'xcancel' });
    await b.clipboard.writeText('https://x.com/jack/status/20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://xcancel.com/jack/status/20');
    b.update({ hijackNativeCopy: false });
    await b.clipboard.writeText('https://x.com/jack/status/20?s=20');
    b.drain();
    assert.equal(b.copied.at(-1), 'https://x.com/jack/status/20?s=20');
  });
}
