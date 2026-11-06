import test from 'node:test';
import assert from 'node:assert/strict';
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
