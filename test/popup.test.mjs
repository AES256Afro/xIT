import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './helpers/page.mjs';

const TWEET = 'https://x.com/jack/status/20';

function rows(page) {
  return page.$('list').querySelectorAll('.item');
}

/** What each row says under the redirector's name. */
function subs(page) {
  return rows(page).map((row) => row.querySelector('span').textContent);
}

test('a keystroke in the paste field builds nothing', async () => {
  /*
   * O2. The popup's list is shaped by the settings and written by the source.
   * A keystroke changes the source, so rebuilding every row, its five buttons
   * and their listeners was work that could not have changed anything, and it
   * meant the conversions were run to fill rows that were then thrown away.
   *
   * Collapsing buildRows and updateRows back into one function called from
   * refreshPreview makes this fail.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  const before = rows(page).length;
  assert.ok(before >= 3, 'the default popup should list rows');

  page.dom.reset();
  page.type('manual', 'https://x.com/jack/status/99');

  assert.equal(page.dom.created(), 0, 'a keystroke should create no elements');
  assert.equal(rows(page).length, before);
  for (const sub of subs(page)) assert.match(sub, /99/, 'every row should follow the new source');
});

test('the hosts a conversion needs are gathered once, not once per row', async () => {
  /*
   * The other half of O2, and the part that actually grew with the catalogue:
   * `opts()` walked every configured redirector to collect its hosts, and it
   * was called afresh for each row, which made a keystroke quadratic in the
   * number of entries. The result is settled by the settings, so it is held
   * against the settings object and gathered again only when that object is
   * replaced.
   *
   * Taking the cache out of opts() makes this fail with one call per row plus
   * the three refreshPreview makes on its own.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  const store = page.context.XITStore;
  const real = store.extraHosts;
  let calls = 0;
  store.extraHosts = (settings) => { calls += 1; return real(settings); };

  page.type('manual', 'https://x.com/jack/status/99');
  assert.equal(calls, 0, 'the settings did not change, so the hosts cannot have');

  await page.changeSettings({ stripTracking: false });
  assert.equal(calls, 1, 'a settings change should gather them once, not once per row');
});

test('a settings change does rebuild the rows', async () => {
  /*
   * The cache is keyed on the settings object because a settings change always
   * brings a fresh one: load and normalize each build their own. If that ever
   * stopped holding, the popup would keep showing stale names, pins and stars,
   * so this is the test that the caching is not too eager.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  const label = (id) => rows(page).find((row) => row.dataset.id === id)
    .querySelector('[data-action="pin"]').textContent;
  assert.equal(label('vxtwitter'), 'Pin');

  page.dom.reset();
  await page.changeSettings({ pinnedIds: ['vxtwitter'] });

  assert.ok(page.dom.created() > 0, 'a settings change should rebuild the rows');
  assert.equal(label('vxtwitter'), 'Unpin', 'the rebuilt row should show the new state');
});

test('a source that is not a tweet leaves nothing clickable', async () => {
  // The disabled flags are written by the per-source half of the render, so
  // they are the other thing a keystroke has to get right.
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  for (const row of rows(page)) {
    assert.equal(row.querySelector('[data-action="copy"]').disabled, false);
  }

  page.type('manual', 'not a url at all');
  for (const row of rows(page)) {
    assert.equal(row.querySelector('[data-action="copy"]').disabled, true);
    assert.equal(row.querySelector('[data-action="open"]').disabled, true);
  }

  page.type('manual', TWEET);
  for (const row of rows(page)) {
    assert.equal(row.querySelector('[data-action="copy"]').disabled, false,
      'a usable source should bring the buttons back');
  }
});

/* ---- P5: the paste field reads a link out of prose too ---- */

test('the paste field finds a link inside text pasted around it', async () => {
  /*
   * P5 gave the library findLink for the selection menu. This field is the
   * other place somebody arrives with a URL buried in prose, and it used to
   * require the field to hold nothing else: pasting a line from a mail or a
   * chat produced "Not a tweet".
   *
   * Taking findLink back out of the input handler makes this fail.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: 'https://x.com/jack/status/20' });

  page.type('manual', 'worth reading: https://x.com/jack/status/99 (via a list)');
  assert.equal(page.$('preview').textContent, 'https://fxtwitter.com/jack/status/99');
  for (const sub of subs(page)) assert.match(sub, /99/);
});

test('the paste field is unchanged for a value that is already a link', async () => {
  // findLink returns the URL it was given, so nothing about the old
  // behaviour moves: a bare link, a scheme-less one, and prose with no link
  // in it all do what they did.
  const page = await loadPage('popup/popup.js', { tabUrl: 'https://x.com/jack/status/20' });

  page.type('manual', 'https://x.com/jack/status/99');
  assert.equal(page.$('preview').textContent, 'https://fxtwitter.com/jack/status/99');

  page.type('manual', 'not a link at all');
  assert.equal(page.$('copy-default').disabled, true);
  assert.match(page.$('current-kind').textContent, /Not an X\/Twitter link/);

  // Emptying it goes back to the tab, as it always did.
  page.type('manual', '');
  assert.equal(page.$('preview').textContent, 'https://fxtwitter.com/jack/status/20');
});

test('on an X page that is not a tweet, the popup offers nothing to copy and says so', async () => {
  /*
   * U12, the popup's side of B13. On Home the popup used to describe the
   * page in hard-coded English and still enable Copy, which produced
   * fxtwitter.com/home. The description now comes from the catalogue, and
   * the buttons that would convert are disabled.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: 'https://x.com/home' });
  assert.equal(page.$('copy-default').disabled, true, 'Copy should be disabled');
  assert.equal(page.$('open-default').disabled, true, 'Open should be disabled');
  assert.equal(page.$('current-kind').textContent, 'X page: /home', 'the page is still named');
  for (const row of rows(page)) {
    assert.equal(row.querySelector('[data-action="copy"]').disabled, true, 'no row should offer a copy');
  }
});

test('an error in the popup stays until something replaces it', async () => {
  /*
   * Q10. Every status line, errors included, cleared itself after 2.6
   * seconds, often before it had been read. A confirmation can still go;
   * a problem stays until the next message takes its place.
   *
   * Clearing errors on the timer again makes this fail.
   */
  const pending = [];
  const page = await loadPage('popup/popup.js', {
    tabUrl: 'https://example.com/',
    setTimeout: (fn) => { pending.push(fn); return pending.length; },
    clearTimeout: () => {},
  });
  page.type('manual', 'https://example.com/not-a-tweet');
  page.$('manual').dispatch('keydown', { key: 'Enter' });
  await page.settle();
  const said = page.$('status').textContent;
  assert.ok(said, 'the popup says why it could not copy');
  assert.equal(page.$('status').getAttribute('data-kind'), 'error');
  for (const fn of pending.splice(0)) fn();
  assert.equal(page.$('status').textContent, said, 'and the timer does not take it away');
});

test('a popup switch that fails to save goes back and says why', async () => {
  /*
   * B20. The popup's switches and its star awaited the save with nothing to
   * catch a failure, so a switch stayed flipped to a state that was never
   * saved and the popup said nothing.
   *
   * Taking the error handling back out of the switch makes this fail.
   */
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET, failWrites: true });
  const box = page.$('t-strip');
  const before = box.checked;
  box.checked = !before;
  box.dispatch('change');
  await page.settle(10);
  assert.equal(box.checked, before, 'the switch shows what is actually saved');
  assert.match(page.$('status').textContent, /disk unavailable/);
  assert.equal(page.$('status').getAttribute('data-kind'), 'error');
});

test('the popup\'s Make default star is the same drawn star as everywhere else', async () => {
  // V1: it was a text "★" in the system font among drawn icons.
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  for (const button of page.$('list').querySelectorAll('[data-action="default"]')) {
    assert.equal(button.textContent, '', 'no text glyph');
    assert.equal(button.querySelectorAll('svg').length, 1, 'one drawn icon');
    assert.ok(button.getAttribute('aria-label'), 'and still a name for a screen reader');
  }
});

test('the popup shows the diagnostics report it copied', async () => {
  // U16: Settings showed the report and the popup copied it blind, so the
  // promise that it holds no links could only be checked from Settings.
  // The test DOM does not parse markup, so the starting state is read there.
  const html = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
  assert.match(html, /<pre id="diagnostics-preview"[^>]*\shidden[\s>]/, 'hidden until there is a report');
  const page = await loadPage('popup/popup.js', { tabUrl: TWEET });
  page.$('copy-diagnostics').dispatch('click');
  await page.settle(10);
  assert.equal(page.$('diagnostics-preview').hidden, false, 'what was copied is on show');
  assert.equal(page.$('diagnostics-preview').textContent, JSON.stringify({}, null, 2));
});
