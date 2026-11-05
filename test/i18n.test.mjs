import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/*
 * C10, P3: the catalogue and the places that reference it have to stay in
 * step. A __MSG_ placeholder with no key makes the browser refuse to install
 * the extension, and a data-i18n with no key blanks whatever it marks, so
 * both failures are worse than the untranslated string they replaced.
 * tools/build.mjs throws on the manifest side; this covers the rest.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const MESSAGES = JSON.parse(read('src/_locales/en/messages.json'));
const PAGES = ['src/options/options.html', 'src/popup/popup.html'];

test('every message has text and a description for whoever translates it', () => {
  assert.ok(Object.keys(MESSAGES).length, 'the catalogue is not empty');
  for (const [key, entry] of Object.entries(MESSAGES)) {
    assert.match(key, /^[A-Za-z][A-Za-z0-9_]*$/, `${key} is a usable message name`);
    assert.equal(typeof entry.message, 'string');
    assert.ok(entry.message.trim(), `${key} has text`);
    assert.ok(entry.description && entry.description.trim(),
      `${key} has a description, which is the only context a translator gets`);
  }
});

test('every marked string in the pages has a message, and every message is used', () => {
  const html = PAGES.map(read).join('\n');
  const marked = new Set();
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) marked.add(m[1]);
  assert.ok(marked.size, 'the pages mark something');
  for (const key of marked) {
    assert.ok(Object.prototype.hasOwnProperty.call(MESSAGES, key),
      `${key} is marked in a page but missing from the catalogue, which would blank it`);
  }
  // The manifest's own keys are referenced from the build script.
  const build = read('tools/build.mjs');
  for (const key of Object.keys(MESSAGES)) {
    const used = marked.has(key) || build.includes(`msg('${key}')`);
    assert.ok(used, `${key} is in the catalogue but nothing uses it`);
  }
});

test('a string with no catalogue behind it stays English rather than going blank', () => {
  // No chrome and no browser global: the state a plain file:// open is in, and
  // the state any context is in if the catalogue fails to load.
  const warned = [];
  const ctx = vm.createContext({ console: { warn: (...a) => warned.push(a) } });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  const { t, apply } = ctx.XITI18N;
  assert.equal(t('anything', undefined, 'English text'), 'English text');
  assert.equal(t('anything'), '', 'with no fallback offered there is nothing to return');

  // A present-but-empty catalogue is the other way this goes wrong.
  const ctx2 = vm.createContext({ chrome: { i18n: { getMessage: () => '' } },
    console: { warn: (...a) => warned.push(a) } });
  vm.runInContext(read('src/lib/i18n.js'), ctx2);
  assert.equal(ctx2.XITI18N.t('missingKey', undefined, 'Fallback'), 'Fallback');
  assert.ok(warned.some((a) => a.join(' ').includes('no message for missingKey')), 'and it is reported');

  // apply() must leave the markup's own text in place in that case.
  const node = { dataset: { i18n: 'missingKey' }, textContent: 'Original' };
  const fake = { querySelectorAll: (sel) => (sel === '[data-i18n]' ? [node] : [node]) };
  apply(fake);
  assert.equal(node.textContent, 'Original', 'the English in the markup survives');
});

test('the catalogue is translator-ready JSON, not just valid JSON', () => {
  const raw = read('src/_locales/en/messages.json');
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2) + '\n',
    'kept in a stable shape so a translation diff is readable');
  // Chrome substitutes $1 style placeholders; a stray $ is a silent mangle.
  for (const [key, entry] of Object.entries(MESSAGES)) {
    const dollars = entry.message.match(/\$/g) || [];
    if (!dollars.length) continue;
    assert.ok(entry.placeholders || /\$\d/.test(entry.message),
      `${key} has a $ but no placeholders, which the browser will eat`);
  }
});
