import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
// Await the predicate before testing it; some Playwright builds treat a
// returned Promise as a truthy polling result without waiting for its value.
async function waitFor(page, predicate, argument, options = {}) {
  const deadline = Date.now() + (options.timeout || 10000);
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for ' + String(predicate));
}
const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'dist/chrome');
const results = { checks: [] };
const check = name => { results.checks.push(name); console.log('PASS ' + name); };
const context = await chromium.launchPersistentContext('', {
  headless: true, channel: 'chromium',
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  results.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  results.browser = context.browser().version();
  const settle = () => worker.evaluate(() => initChain);
  const save = async patch => { await worker.evaluate(patch => XITStore.save(patch), patch); await settle(); };
  const options = await context.newPage();
  const popup = await context.newPage();
  const errors = [];
  const nativeDialogs = [];
  for (const page of [options, popup]) {
    page.on('pageerror', error => errors.push(error.message));
    // U5: alert() and confirm() are gone. Playwright dismisses a dialog it has
    // no handler for, which would hide a regression, so record each one and
    // assert at the end that nothing arrived.
    page.on('dialog', async d => { nativeDialogs.push(d.type() + ': ' + d.message()); await d.dismiss(); });
  }
  await options.goto(`chrome-extension://${id}/options/options.html`);
  await options.waitForSelector('#en-fxtwitter');
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForSelector('#list .item');
  await popup.evaluate(() => { window.close = () => {}; window.copies = []; Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => copies.push(text), configurable: true }); });
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'manual');
  await popup.locator('#manual').fill('https://x.com/jack/status/20?s=20');
  await popup.locator('#manual').press('Enter');
  assert.equal(await popup.evaluate(() => copies.at(-1)), 'https://fxtwitter.com/jack/status/20');
  check('The paste field focuses on unrelated tabs and Enter copies the previewed link');

  await options.locator('[data-id="threadreader"] [data-action="pin"]').click();
  await popup.waitForFunction(() => document.querySelector('#list .item')?.dataset.id === 'threadreader');
  await popup.locator('[data-id="vxtwitter"] [data-action="pin"]').click();
  await options.waitForSelector('[data-id="vxtwitter"] [data-action="up"]');
  await options.locator('[data-id="vxtwitter"] [data-action="up"]').click();
  await popup.waitForFunction(() => document.querySelector('#list .item')?.dataset.id === 'vxtwitter');
  await popup.reload(); await popup.waitForSelector('#list .item');
  await popup.evaluate(() => { window.close = () => {}; });
  assert.equal(await popup.locator('#list .item').first().getAttribute('data-id'), 'vxtwitter');
  assert.equal((await worker.evaluate(() => XITStore.load())).defaultRedirector, 'fxtwitter');
  check('Pinning and reordering update both interfaces and survive reload without changing the default');

  await options.locator('#c-name').fill('My instance');
  await options.locator('#c-template').fill('https://one.example/{path}');
  await options.locator('#custom-submit').click();
  await options.waitForSelector('[data-id="c-my-instance"]');
  await save({ defaultRedirector: 'c-my-instance' });
  await options.locator('[data-id="c-my-instance"] [data-action="pin"]').click();
  await options.locator('[data-id="c-my-instance"] [data-action="edit"]').click();
  await options.locator('#c-name').fill('Renamed instance');
  await options.locator('#c-template').fill('https://two.example:8443/{path}');
  await options.locator('#custom-submit').click();
  await waitFor(options, async () => (await XITStore.load()).custom[0].name === 'Renamed instance');
  let settings = await worker.evaluate(() => XITStore.load());
  assert.equal(settings.defaultRedirector, 'c-my-instance');
  assert.ok(settings.pinnedIds.includes('c-my-instance'));
  await options.locator('[data-id="c-my-instance"] [data-action="duplicate"]').click();
  await waitFor(options, async () => (await XITStore.load()).custom.length === 2);
  await options.locator('[data-id="c-my-instance"] [data-action="remove"]').click();
  await options.waitForSelector('#undo-custom:not([hidden])');
  await options.reload(); await options.waitForSelector('#undo-custom:not([hidden])');
  await options.locator('#undo-remove').click();
  await waitFor(options, async () => (await XITStore.load()).defaultRedirector === 'c-my-instance');
  assert.equal((await worker.evaluate(() => XITStore.load())).custom.length, 2);
  check('Custom edit, duplicate, remove, and Undo preserve selections; Undo survives a Settings reload');

  const mock = (await readFile(path.join(root, 'tools/store-assets/mock-x.html'), 'utf8')).replace(/<script[\s\S]*$/, '</body></html>');
  const opened = [];
  await context.route('https://x.com/**', route => { opened.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: mock }); });
  // Chrome API-created tabs can start loading before Playwright attaches its
  // routes. Capture the exact requested URL, create the real tab blank, then
  // navigate it after attachment so this check never depends on live X.
  await worker.evaluate(() => {
    globalThis.testOpenRequests = [];
    const original = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async options => {
      testOpenRequests.push(options.url);
      return original({ ...options, url: 'about:blank' });
    };
  });
  const openOnX = async action => {
    const pending = context.waitForEvent('page');
    await action();
    const page = await pending;
    const requested = await worker.evaluate(() => testOpenRequests.shift());
    assert.equal(requested, 'https://x.com/jack/status/20');
    await page.goto(requested);
    await page.waitForSelector('.xit-btn-caret');
    return page;
  };
  await popup.locator('#manual').fill('https://fxtwitter.com/jack/status/20?s=20');
  const tweet = await openOnX(() => popup.locator('#open-original').click());
  assert.ok(opened.includes('https://x.com/jack/status/20'));
  assert.ok(!tweet.url().includes('xit_bypass'), 'no bypass parameter is added any more');
  await tweet.locator('.xit-btn-caret').first().click();
  assert.deepEqual(await tweet.locator('.xit-row').evaluateAll(rows => rows.slice(0, 2).map(r => r.dataset.id)), ['vxtwitter', 'threadreader']);
  // U4: no role="menuitem" may contain an interactive descendant, or a screen
  // reader cannot reliably reach the pin, open and default buttons.
  assert.deepEqual(await tweet.evaluate(() => Array.from(document.querySelectorAll('.xit-menu [role="menuitem"]'))
    .filter((item) => item.querySelector('button, a, input, [role="menuitem"]'))
    .map((item) => item.className)), []);
  assert.deepEqual(await tweet.evaluate(() => Array.from(document.querySelectorAll('.xit-menu .xit-row'))
    .filter((row) => row.getAttribute('role') !== 'group').map((row) => row.dataset.id)), []);
  assert.ok(await tweet.evaluate(() => {
    const row = document.querySelector('.xit-menu .xit-row');
    return row.querySelectorAll('[role="menuitem"]').length === 4
      && row.querySelector('.xit-row-main').getAttribute('role') === 'menuitem';
  }), 'each row offers copy, pin, open and default as menu items');
  // Down then Right lands on the second row's pin, which is the point of
  // splitting the row into separate menu items.
  await tweet.keyboard.press('ArrowDown');
  await tweet.keyboard.press('ArrowRight');
  assert.equal(await tweet.evaluate(() => document.activeElement.dataset.act), 'pin');
  await tweet.keyboard.press('ArrowLeft');
  assert.equal(await tweet.evaluate(() => document.activeElement.dataset.act), 'copy');
  check('The tweet menu exposes each action as its own menu item and arrow keys reach them');

  await openOnX(() => tweet.locator('[data-foot="open-original"]').click());
  await openOnX(() => worker.evaluate(() => handleMenuClick({ menuItemId: 'xit-link-open-original', linkUrl: 'https://x.com/jack/status/20?s=20' })));
  check('Open on X works from popup, tweet menu and context-menu handling; pinned order also reaches the tweet menu');

  await options.evaluate(() => { window.copiedReport = ''; Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => { copiedReport = text; }, configurable: true }); });
  await worker.evaluate(() => { globalThis.originalCreate = chrome.contextMenus.create; chrome.contextMenus.create = () => { throw new Error('PRIVATE https://private.example/secret'); }; });
  await options.locator('#copy-diagnostics').click();
  await options.waitForFunction(() => !!window.copiedReport);
  const reportText = await options.evaluate(() => copiedReport);
  const report = JSON.parse(reportText);
  assert.equal(report.version, results.version);
  assert.equal(report.contextMenus, 'error');
  assert.equal(report.contentScript, 'responding');
  assert.ok(!/https:|jack|private|one\.example|two\.example|Renamed|My instance/i.test(reportText));
  assert.deepEqual(Object.keys(report).sort(), ['extension', 'version', 'browser', 'xAccess', 'legacyRedirectRules', 'contextMenus', 'copyButton', 'nativeCopy', 'contentScript'].sort());
  assert.equal(report.legacyRedirectRules, 0);
  await worker.evaluate(async () => { chrome.contextMenus.create = originalCreate; await init('recover'); });
  check('Diagnostics remain useful during menu failures and contain only the approved status fields');

  await mkdir(path.join(root, '.harness'), { recursive: true });
  await popup.setViewportSize({ width: 400, height: 850 });
  await popup.screenshot({ path: path.join(root, '.harness/qol-popup.png'), fullPage: true });
  await options.locator('#redirector-list').screenshot({ path: path.join(root, '.harness/qol-redirectors.png') });
  // U7: the filter narrows the list and is view state, not a setting.
  const rows = () => options.evaluate(() => document.querySelectorAll('#redirector-list .ritem').length);
  const before = await rows();
  assert.ok(before > 1, 'there is a list to filter');
  await options.locator('#list-filter').fill('thread');
  await waitFor(options, (n) => document.querySelectorAll('#redirector-list .ritem').length < n, before);
  assert.ok(await options.evaluate(() => {
    const names = Array.from(document.querySelectorAll('#redirector-list .ritem b')).map((b) => b.textContent);
    return names.length > 0 && names.every((n) => /thread/i.test(n));
  }), 'only matching rows remain');
  // A group left with no rows must not leave its heading standing.
  assert.equal(await options.evaluate(() =>
    Array.from(document.querySelectorAll('#redirector-list .rgroup'))
      .filter((g) => !g.querySelector('.ritem')).length), 0, 'no empty group headings');
  await options.locator('#list-filter').fill('zzzznothing');
  await options.waitForSelector('#list-empty:not([hidden])');
  await options.locator('#list-filter').fill('');
  await waitFor(options, (n) => document.querySelectorAll('#redirector-list .ritem').length === n, before);
  await options.reload();
  await options.waitForSelector('#en-fxtwitter');
  assert.equal(await options.locator('#list-filter').inputValue(), '', 'the filter does not persist');
  assert.equal(await rows(), before, 'and the whole list is back');
  check('The redirector filter narrows the list, reports no matches and does not persist');

  // U5: a bad import reports in the page and leaves settings alone. The
  // default is read rather than named, so this does not depend on which
  // redirector the sections above left selected.
  const chosen = await worker.evaluate(async () => (await XITStore.load()).defaultRedirector);
  assert.notEqual(chosen, 'fxtwitter', 'the reset assertion below needs a default that is not the install default');
  await options.locator('#import-file').setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ not json'),
  });
  await options.waitForSelector('#backup-error:not([hidden])');
  assert.match(await options.locator('#backup-error').textContent(), /could not be read as settings/);
  assert.equal(await options.evaluate(() => document.querySelector('#backup-error').getAttribute('role')), 'alert');
  assert.equal(await worker.evaluate(async () => (await XITStore.load()).defaultRedirector), chosen);

  // U5: reset asks in a modal dialog. Escape is a refusal, and settings survive.
  await options.locator('#reset').click();
  await waitFor(options, () => document.querySelector('#confirm-reset').open);
  assert.ok(await options.evaluate(() => document.querySelector('#confirm-reset').matches(':modal')),
    'the reset question is a modal dialog, so it traps focus and takes Escape');
  assert.ok(await options.evaluate(() => document.querySelector('#backup-error').hidden),
    'opening the question clears the stale import error');
  await options.keyboard.press('Escape');
  await waitFor(options, () => !document.querySelector('#confirm-reset').open);
  assert.equal(await worker.evaluate(async () => (await XITStore.load()).defaultRedirector), chosen);

  // Only the reset button itself resets.
  await options.locator('#reset').click();
  await waitFor(options, () => document.querySelector('#confirm-reset').open);
  await options.locator('#reset-go').click();
  await waitFor(options, () => !document.querySelector('#confirm-reset').open);
  await waitFor(options, async () => (await XITStore.load()).defaultRedirector === 'fxtwitter');
  check('Import failure and reset are answered in the page, with no native dialogs anywhere in the run');

  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, '.harness/qol-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await context.close(); }
