import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './helpers/page.mjs';

const SRC = readFileSync(new URL('../src/options/options.js', import.meta.url), 'utf8');

/**
 * The source of one top-level function in options.js, by brace matching.
 *
 * The two tests below are static checks on the file's text, and the only ones
 * here that are: what they hold is the order of statements around the
 * permission prompt, and the prompt is browser chrome, so no harness can put
 * it up and click twice while it is there. Everything else about this page is
 * tested by running it, through test/helpers/page.mjs.
 */
function body(name) {
  const start = SRC.indexOf('async function ' + name + '(');
  assert.notEqual(start, -1, 'no function named ' + name);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/**
 * The span of the `try` block that `catch (error)` belongs to, searching from
 * `from`. A function may well hold more than one `try`, so this picks the one
 * by its catch rather than by position.
 */
function owningTry(src, from) {
  for (let i = src.indexOf('try {', from); i !== -1; i = src.indexOf('try {', i + 1)) {
    const open = src.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) {
        if (/^\s*\} catch \(error\)/.test(src.slice(j))) return { open, close: j };
        break;
      }
    }
  }
  throw new Error('no try block with a catch (error)');
}

test('runCheck claims the flag before it waits for anything', () => {
  /*
   * B11. `runCheck` opens with `if (checking || !ids.length) return;`, which
   * guards nothing unless the flag is set before the function first yields.
   * It used to be set after `permissions.request`, whose wait is the browser's
   * own prompt in front of the page, so a second click while the prompt was
   * up passed the guard and started a second check.
   *
   * Moving the assignment back below the request makes this fail.
   */
  const src = body('runCheck');
  const flag = src.indexOf('checking = true');
  const wait = src.indexOf('await ');
  assert.notEqual(flag, -1, 'runCheck should still set the flag');
  assert.notEqual(wait, -1, 'runCheck should still await something');
  assert.ok(flag < wait,
    'checking = true must come before the first await, or the guard above it does nothing');
});

test('runCheck clears the flag on every path out of it', () => {
  /*
   * The other half of B11: the fix only holds if claiming the flag earlier
   * does not leave it stuck. Everything after the assignment is inside one
   * try with a finally that clears it, the refusal included, since a return
   * from inside a try still runs the finally.
   *
   * Taking the finally away, or moving the refusal's return out in front of
   * the try, makes this fail.
   */
  const src = body('runCheck');
  const flag = src.indexOf('checking = true');
  assert.match(src.slice(flag), /finally \{[^}]*checking = false/,
    'the flag should be cleared in a finally');

  // The block that owns that finally, not merely the first `try` in sight:
  // there is an inline `try` around the permission request itself, and
  // anchoring on that one let a reversion through when this test was written.
  const span = owningTry(src, flag);
  const refusal = src.indexOf('checkNoAccess');
  assert.ok(refusal > span.open && refusal < span.close,
    'the refusal returns early, so it must sit inside the try that has the finally');
});

/* ---- O5: the list filter ---- */

/** The rows of the settings list, which is not the only `.ritem` on the page. */
function listRows(page) {
  return page.$('redirector-list').querySelectorAll('.ritem');
}

function visible(page) {
  return listRows(page).filter((row) => !row.hidden).map((row) => row.dataset.id);
}

test('filtering the list builds nothing', async () => {
  /*
   * O5. `renderList` used to decide what to build from the filter, so every
   * keystroke cleared the list and recreated each row, its checkbox, its five
   * buttons, their listeners and its reachability badge. The filter chooses
   * which rows are shown and says nothing about what a row contains, so it is
   * applied to rows that already exist.
   *
   * Putting the `continue` back in renderList and calling it from the
   * keystroke again makes this fail: the count is then one element per row
   * per keystroke.
   */
  const page = await loadPage('options/options.js');
  const before = listRows(page).length;
  assert.ok(before >= 3, 'the default list should have rows to filter');

  page.dom.reset();
  page.type('list-filter', 'thread');

  assert.equal(page.dom.created(), 0, 'a keystroke in the filter should create no elements');
  assert.equal(listRows(page).length, before, 'the rows should still be there, merely hidden');
  assert.deepEqual(visible(page), ['threadreader']);
});

test('a group whose rows are all filtered out is hidden, and comes back', async () => {
  const page = await loadPage('options/options.js');
  const groups = () => page.$('redirector-list').querySelectorAll('.rgroup');
  const shownGroups = () => groups().filter((g) => !g.hidden).length;
  const all = shownGroups();
  assert.ok(all >= 2, 'the default list should span more than one group');

  page.type('list-filter', 'thread');
  assert.equal(shownGroups(), 1, 'a heading should not stand over nothing');

  page.type('list-filter', '');
  assert.equal(shownGroups(), all, 'clearing the filter should bring every group back');
  assert.deepEqual(visible(page).length, listRows(page).length);
});

test('a filter that matches nothing says so, in the words that were typed', async () => {
  const page = await loadPage('options/options.js');
  page.type('list-filter', 'nothing here by that name');
  assert.equal(visible(page).length, 0);
  assert.equal(page.$('list-empty').hidden, false);
  assert.match(page.$('list-empty').textContent, /nothing here by that name/);

  page.type('list-filter', 'thread');
  assert.equal(page.$('list-empty').hidden, true);
  assert.equal(page.$('list-empty').textContent, '');
});

test('a filter survives a render it did not ask for', async () => {
  /*
   * The filter is view state and a render rebuilds every row, so the rows a
   * render makes have to be put through the filter before the user sees them.
   * Any settings change renders: without that, turning a switch on in another
   * tab would quietly empty the filter field's effect while the field still
   * showed what was typed.
   *
   * Taking the applyFilter call off the end of renderList makes this fail.
   */
  const page = await loadPage('options/options.js');
  page.type('list-filter', 'thread');
  assert.deepEqual(visible(page), ['threadreader']);

  await page.changeSettings({ toast: false });

  assert.deepEqual(visible(page), ['threadreader'],
    'the filter should still be in force over the rows the render just made');
  assert.equal(page.$('list-filter').value, 'thread');
});

/* ---- B12: the picker and the user's own redirectors ---- */

test('saving the picker keeps the redirectors it does not list', async () => {
  /*
   * B12. The picker lists only what xIT bundles or catalogues, and its Save
   * built the enabled list from those ids alone. Every redirector the user
   * had added themselves was switched off, and a custom default was moved to
   * a bundled one, by a dialog that never showed either of them.
   *
   * Building enabledIds from the picker's own entries again makes this fail.
   */
  const page = await loadPage('options/options.js', { settings: {
    custom: [{ id: 'c-mine', name: 'Mine', template: 'https://mine.example/{path}' }],
    enabledIds: ['fxtwitter', 'c-mine'], defaultRedirector: 'c-mine', pinnedIds: ['c-mine'], pickerDone: false,
  } });
  page.$('picker-save').dispatch('click');
  await page.settle(10);

  const patch = page.sent.find((m) => m.type === 'xit:mutate-settings'
    && m.operation.type === 'patch' && m.operation.patch.enabledIds).operation.patch;
  assert.ok(patch.enabledIds.includes('c-mine'), 'the custom redirector should stay enabled');
  assert.ok(patch.enabledIds.includes('fxtwitter'), 'the ticked bundled one should stay too');
  assert.equal(patch.defaultRedirector, 'c-mine', 'a custom default should survive the picker');
  assert.deepEqual([...patch.pinnedIds], ['c-mine'], 'and so should its pin');

  // C19: what the user is left with, not only what the page asked for.
  const stored = page.local.settings;
  assert.ok(stored.enabledIds.includes('c-mine'), 'the saved settings keep the custom redirector on');
  assert.equal(stored.defaultRedirector, 'c-mine', 'and keep it as the default');
  assert.equal(stored.pickerDone, true, 'and record that the picker was used');
  assert.equal(page.$('default-select').value, 'c-mine', 'and the page shows it');
});

test('a switch in Settings is saved, not only requested', async () => {
  /*
   * C19. The page helper answered every settings write with success and
   * changed nothing, so no test here could see a write land. This one fails
   * if that stub comes back.
   */
  const page = await loadPage('options/options.js', { settings: { pickerDone: true } });
  const box = page.$('t-toast');
  box.checked = false;
  box.dispatch('change');
  await page.settle(10);
  assert.equal(page.local.settings.toast, false);
  assert.equal(page.$('t-toast').checked, false, 'the page renders what was saved');
});

test('the preview sentence puts the converted link in bold, wherever the message places it', async () => {
  // C16: the sentence used to be English glued to a <b>. It is one catalogue
  // message now, with {1} marking where the bold link goes.
  const page = await loadPage('options/options.js', { settings: { pickerDone: true } });
  const preview = page.$('default-preview');
  assert.equal(preview.textContent, 'x.com/jack/status/20 becomes https://fxtwitter.com/jack/status/20');
  assert.equal(preview.querySelector('b').textContent, 'https://fxtwitter.com/jack/status/20');
});

test('the shortcuts panel shows what the browser actually has bound', async () => {
  /*
   * Q7. The panel said Alt+Shift+C whatever the browser had done, although a
   * suggested key that clashes is dropped at install without a word, and it
   * said the open command was not bound even after somebody bound it. Both
   * are read from the browser's own list now.
   *
   * Writing either binding into the markup again makes this fail.
   */
  const page = await loadPage('options/options.js', { settings: { pickerDone: true }, commands: [
    { name: 'copy-current-tweet', shortcut: '' },
    { name: 'open-current-tweet', shortcut: 'Ctrl+Shift+O' },
  ] });
  assert.equal(page.$('kbd').textContent, 'not set', 'a dropped suggestion says so');
  assert.equal(page.$('kbd-open').textContent, 'Ctrl+Shift+O', 'and a binding the user made is shown');
});

test('Copy address finishes after the clipboard answers', async () => {
  /*
   * B18. The handler blurred ev.currentTarget after awaiting the clipboard,
   * and a browser sets currentTarget to null once dispatch is over, so every
   * click ended in a TypeError and the button kept its focus ring. The event
   * here behaves the same way.
   *
   * Reading ev.currentTarget after the await again makes this fail.
   */
  const page = await loadPage('options/options.js', { settings: { pickerDone: true } });
  const button = page.$('copy-shortcut-url');
  button.focus();
  let dispatching = true;
  const ev = { get currentTarget() { return dispatching ? button : null; } };
  const errors = [];
  const onError = (error) => errors.push(error);
  process.on('unhandledRejection', onError);
  button.dispatch('click', ev);
  dispatching = false;
  await page.settle(10);
  process.off('unhandledRejection', onError);
  assert.deepEqual(errors, [], 'the handler finishes without throwing');
  assert.notEqual(page.document.activeElement, button, 'and lets go of focus');
});

test('a failed write in Settings says so instead of failing silently', async () => {
  // B20: Reset had no error handling, so a failed write left the dialog's
  // promise rejected and the page saying nothing.
  const page = await loadPage('options/options.js', { settings: { pickerDone: true }, failWrites: true });
  const errors = [];
  const onError = (error) => errors.push(error);
  process.on('unhandledRejection', onError);
  page.$('reset-go').dispatch('click');
  await page.settle(10);
  process.off('unhandledRejection', onError);
  assert.deepEqual(errors, [], 'nothing is left unhandled');
  assert.match(page.$('saved').textContent, /disk unavailable/, 'and the page says what went wrong');
});
