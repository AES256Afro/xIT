/*
 * Every copy route agrees about what can be converted.
 *
 * Most defects found in both audits were one rule enforced on some routes and
 * not others: B8, B9, S6 and Q6 in the first, and B13 in the second, where
 * findLink held out for a tweet or a profile while convert() rewrote any X
 * address, so X's own Copy link, the popup and the menus turned Home and
 * lists into broken links. This file asks the same question of each route,
 * for the same links, and fails when any route answers differently.
 *
 * A new copy route belongs in ROUTES. A new kind of link belongs in LINKS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { loadPage } from './helpers/page.mjs';
import { harness, REAL } from './helpers/background.mjs';

const read = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

/** Each link, and whether a redirector should take it. */
const LINKS = [
  ['https://x.com/jack/status/20', true],
  ['https://twitter.com/jack/status/20/photo/1', true],
  ['https://x.com/i/web/status/20', true],
  ['https://mobile.twitter.com/jack/status/20?s=20', true],
  ['https://x.com/jack', true],
  ['https://vxtwitter.com/jack/status/20', true],
  ['https://x.com/home', false],
  ['https://x.com/explore', false],
  ['https://x.com/i/lists/123', false],
  ['https://x.com/i/communities/9', false],
  ['https://x.com/search?q=a', false],
  ['https://x.com/messages/1-2', false],
  ['https://x.com/settings/account', false],
];

/** X's own Copy link, through the main world's clipboard wrapper. */
async function mainWorldConverts(url) {
  const written = [];
  const listeners = [];
  const window = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    postMessage() {},
  };
  const ctx = vm.createContext({ window, URL, URLSearchParams, location: { origin: 'https://x.com' },
    navigator: { clipboard: { writeText: async (text) => { written.push(text); } } } });
  vm.runInContext(read('lib/redirectors.js'), ctx);
  vm.runInContext(read('content/main-world.js'), ctx);
  for (const fn of listeners) {
    fn({ source: window, data: { __xit: 'config', payload: { enabled: true, template: 'https://fxtwitter.com/{path}{query}' } } });
  }
  await ctx.navigator.clipboard.writeText(url);
  return written[0] !== url;
}

/** The popup, opened on a tab showing the link. */
async function popupConverts(url) {
  const page = await loadPage('popup/popup.js', { tabUrl: url });
  return !page.$('copy-default').disabled;
}

/** The right-click menu's "Copy as" on the link. */
async function menuConverts(url) {
  const h = harness();
  await h.settle();
  h.events.clicked({ menuItemId: 'xit-link-copy:example', linkUrl: url }, { id: 7, index: 2 });
  await h.settle();
  const write = h.sent.find((m) => m.type === 'xit:copy-text');
  // A link the redirector cannot take falls back to the clean x.com link and
  // says so; one it can take is copied with no note.
  return !!write && !write.note && write.text.startsWith('https://example.com/');
}

const ROUTES = {
  'convert()': async (url) => REAL.convert(url, REAL.PRESETS[0]).ok,
  'findLink() on selected text': async (url) => REAL.findLink('see ' + url + ' here') === url,
  "X's own Copy link": mainWorldConverts,
  'the popup': popupConverts,
  'the right-click menu': menuConverts,
};

for (const [url, expected] of LINKS) {
  test(`every copy route ${expected ? 'converts' : 'leaves alone'} ${url}`, async () => {
    const answers = {};
    for (const [name, route] of Object.entries(ROUTES)) answers[name] = await route(url);
    await tick();
    for (const [name, got] of Object.entries(answers)) {
      assert.equal(got, expected, `${name} ${got ? 'converted' : 'did not convert'} ${url}`);
    }
  });
}
