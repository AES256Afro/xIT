import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { check, derive, codeKeys, manifestKeys, load, CATALOGUE } from '../tools/i18n-sync.mjs';

/*
 * C10, C11, P3: the catalogue and the places that reference it have to stay in
 * step. A __MSG_ placeholder with no key makes the browser refuse to install
 * the extension; a data-i18n with no key blanks whatever it marks; a $name$
 * with no declared placeholder is dropped silently, leaving a hole in a
 * sentence. All three are worse than the untranslated string they replaced.
 *
 * tools/i18n-sync.mjs holds the comparison, because the same code has to back
 * both `--write` and this check or they can disagree.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('the catalogue matches the markup, the code and the manifest', () => {
  const problems = check();
  assert.deepEqual(problems, [], 'tools/i18n-sync.mjs reports:\n' + problems.join('\n'));
});

test('the English is derived from the markup, not retyped beside it', () => {
  // The point of deriving: what a reader sees and what a translator is given
  // cannot drift apart. Spot-check that a sentence with markup inside it keeps
  // its wording and turns its children into ordered placeholders.
  const current = load();
  const wanted = derive();
  assert.ok(wanted.size > 80, 'most of the interface is marked, not a token few');
  assert.equal(current.switchStripHint.message, 'Drops {1} and similar share telemetry.');
  assert.equal(wanted.get('switchStripHint').message, current.switchStripHint.message);
  // Placeholders are numbered in document order, so a translator can reorder.
  assert.equal(current.pickerTokensHint.message,
    'Optional. Tokens: {1} {2} {3} {4}. A plain mirror is usually {5}. Pin it from the list afterwards.');
});

test('every message has text, a description and a usable name', () => {
  const current = load();
  assert.ok(Object.keys(current).length > 150);
  for (const [key, entry] of Object.entries(current)) {
    assert.match(key, /^[A-Za-z][A-Za-z0-9_]*$/, `${key} is a usable message name`);
    assert.ok(String(entry.message).trim(), `${key} has text`);
    assert.ok(String(entry.description || '').trim(), `${key} has a description`);
  }
});

test('the catalogue is a stable, translator-ready file', () => {
  const raw = read('src/_locales/en/messages.json');
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2) + '\n',
    'kept in a stable shape so a translation diff is readable');
  assert.ok(CATALOGUE.endsWith(path.join('src', '_locales', 'en', 'messages.json')));
});

test('no interface string is left outside the catalogue', () => {
  // The guard against half-finished work: a quoted sentence in a UI file that
  // is not going through XITI18N is a string a translator will never see.
  // Capitalised, several words, no template tokens or code-ish punctuation.
  const SENTENCE = /'([A-Z][a-z]+(?: [a-z][a-zA-Z.,'’]*){2,}[.!?]?)'/g;
  const offenders = [];
  for (const file of ['src/options/options.js', 'src/popup/popup.js', 'src/content/inject.js',
    'src/background.js', 'src/lib/storage.js']) {
    const code = read(file);
    for (const m of code.matchAll(SENTENCE)) {
      const line = code.slice(0, m.index).split('\n').length;
      const context = code.split('\n')[line - 1];
      // A line that is a comment, or that already calls through, is fine.
      if (/^\s*(\/\/|\*)/.test(context)) continue;
      if (context.includes('XITI18N.t(')) continue;
      offenders.push(`${file}:${line} "${m[1]}"`);
    }
  }
  assert.deepEqual(offenders, [], 'these read like interface text but bypass the catalogue:\n' + offenders.join('\n'));
});

test('a string with no catalogue behind it stays English rather than going blank', () => {
  // No chrome and no browser global: what a plain file:// open gets, and what
  // the unit tests run in.
  const warned = [];
  const ctx = vm.createContext({ console: { warn: (...a) => warned.push(a) } });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  assert.equal(ctx.XITI18N.t('anything', undefined, 'English text'), 'English text');
  assert.equal(ctx.XITI18N.t('anything'), '', 'with no fallback offered there is nothing to return');

  // Present but empty is the other way this goes wrong.
  const ctx2 = vm.createContext({ chrome: { i18n: { getMessage: () => '' } },
    console: { warn: (...a) => warned.push(a) } });
  vm.runInContext(read('src/lib/i18n.js'), ctx2);
  assert.equal(ctx2.XITI18N.t('missingKey', undefined, 'Fallback'), 'Fallback');
  assert.ok(warned.some((a) => a.join(' ').includes('no message for missingKey')), 'and it is reported');
});

/** The smallest DOM the apply() paths actually touch. */
function fakeNode(tag, text) {
  return {
    tagName: tag, dataset: {}, children: [], own: text,
    get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this.own = v; this.children = []; },
    appendChild(n) { this.children.push(n); return n; },
    attributes: {},
    getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    ownerDocument: { createTextNode: (t) => fakeNode('#text', t) },
  };
}

test('a sentence with markup inside it keeps its elements and takes their new order', () => {
  const ctx = vm.createContext({
    chrome: { i18n: { getMessage: (k) => (k === 'tokens' ? 'Use {2} before {1}.' : '') } },
    console: { warn() {} },
  });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  const node = fakeNode('p', 'Drops ');
  const first = fakeNode('code', '{path}');
  const second = fakeNode('code', '{query}');
  node.children.push(first, second);
  node.dataset.i18nParts = 'tokens';
  ctx.XITI18N.apply({ querySelectorAll: (sel) => (sel === '[data-i18n-parts]' ? [node] : []) });
  assert.equal(node.textContent, 'Use {query} before {path}.');
  // The elements themselves are reused, so a <code id="..."> that other code
  // writes into keeps working after translation.
  assert.ok(node.children.includes(first) && node.children.includes(second));

  // With no message the author's markup is left exactly as written.
  const untouched = fakeNode('p', 'Drops ');
  const kid = fakeNode('code', '{path}');
  untouched.children.push(kid);
  untouched.dataset.i18nParts = 'nosuchkey';
  ctx.XITI18N.apply({ querySelectorAll: (sel) => (sel === '[data-i18n-parts]' ? [untouched] : []) });
  assert.equal(untouched.textContent, 'Drops {path}');
});

test('marked attributes are set, and an unmarked one is left alone', () => {
  const ctx = vm.createContext({
    chrome: { i18n: { getMessage: (k) => ({ lbl: 'Etiqueta', ph: 'Escribe aqui' })[k] || '' } },
    console: { warn() {} },
  });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  const node = fakeNode('input', '');
  node.attributes = { 'aria-label': 'Label', placeholder: 'Type here', title: 'Keep me' };
  node.dataset.i18nAriaLabel = 'lbl';
  node.dataset.i18nPlaceholder = 'ph';
  ctx.XITI18N.apply({ querySelectorAll: (sel) => (sel === '*' ? [node] : []) });
  assert.equal(node.getAttribute('aria-label'), 'Etiqueta', 'camelCase dataset maps back to a hyphenated attribute');
  assert.equal(node.getAttribute('placeholder'), 'Escribe aqui');
  assert.equal(node.getAttribute('title'), 'Keep me', 'an attribute nobody marked is not touched');
});

test('the manifest and the code pull from the catalogue, not from each other', () => {
  const fromManifest = manifestKeys();
  const fromCode = codeKeys();
  assert.ok(fromManifest.has('extensionName') && fromManifest.has('extensionDescription'));
  assert.ok(fromCode.size > 50, 'the generated strings go through it too, not just the static markup');
  // A key chosen by a conditional counts as used; this is the case a plain
  // "t('literal')" scan would miss and then report as unused.
  assert.ok(fromCode.has('rowPin') && fromCode.has('rowUnpin'));
});

test('library prose is looked up by entry id, with the English as fallback', () => {
  const ctx = vm.createContext({
    chrome: { i18n: { getMessage: (k) => (k === 'note_fxtwitter' ? 'Translated note' : '') } },
    console: { warn() {} },
  });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  const { of } = ctx.XITI18N;
  assert.equal(of('note', 'fxtwitter', 'English note'), 'Translated note');
  // An entry with no message of its own keeps the library's English, which is
  // what a user's own redirector will always hit.
  assert.equal(of('note', 'c-my-instance', 'My own note'), 'My own note');
  // An id with a hyphen has to be folded, because a message name may hold only
  // letters, digits and underscores. Unfolded it would never match.
  const seen = [];
  const ctx2 = vm.createContext({
    chrome: { i18n: { getMessage: (k) => { seen.push(k); return ''; } } }, console: { warn() {} },
  });
  vm.runInContext(read('src/lib/i18n.js'), ctx2);
  ctx2.XITI18N.of('note', 'fxtwitter-direct', 'fallback');
  assert.deepEqual(seen, ['note_fxtwitter_direct']);
  // No id at all is the custom-entry case and must not ask for "note_".
  assert.equal(of('note', '', 'nothing'), 'nothing');
  assert.equal(of('note', undefined, 'nothing'), 'nothing');
});

test('the library families cover every entry the library ships', async () => {
  const { libraryMessages } = await import('../tools/i18n-sync.mjs');
  const current = load();
  const families = libraryMessages();
  assert.ok(families.size > 10, 'groups, notes and copy formats are all covered');
  for (const [key, entry] of families) {
    assert.ok(current[key], `${key} is derived from src/lib/redirectors.js but missing from the catalogue`);
    assert.equal(current[key].message, entry.message, `${key} drifted from the library`);
  }
  // Every copy format has a name in the catalogue, since that select is built
  // from the library and an untranslated option would read as a blank row.
  for (const id of ['url', 'markdown', 'author']) {
    assert.ok(current['copyFormat_' + id], 'copyFormat_' + id);
  }
});

/**
 * The two libraries loaded as the extension loads them, for the sake of
 * reading DEFAULTS. storage.js reaches for the extension API at load time, so
 * it gets the shape of one: nothing here calls a method on it.
 */
function libraries() {
  const api = { storage: { local: {}, session: {}, onChanged: { addListener() {} } }, runtime: {} };
  const ctx = vm.createContext({ console, chrome: api });
  vm.runInContext(read('src/lib/i18n.js'), ctx);
  vm.runInContext(read('src/lib/redirectors.js'), ctx);
  vm.runInContext(read('src/lib/storage.js'), ctx);
  return ctx;
}

test('the reset dialog reads its defaults from the defaults', async () => {
  /*
   * U11. The dialog said "three redirectors enabled, FxTwitter as the
   * default", which is DEFAULTS written a second time in a sentence: true
   * today, wrong the moment the bundled set changes, and nothing would have
   * noticed. The clause is now a substitution message filled from DEFAULTS.
   *
   * This builds the clause the way options.js does, from the real catalogue
   * and the real DEFAULTS, so a change to either side fails here.
   */
  const { fakeI18n } = await import('./helpers/i18n-stub.mjs');
  const ctx = libraries();
  const { DEFAULTS } = ctx.XITStore;
  const { PRESETS } = ctx.XIT;
  const def = PRESETS.find((p) => p.id === DEFAULTS.defaultRedirector);
  assert.ok(def, 'the default redirector should be one xIT bundles');

  const clause = fakeI18n().getMessage('resetDefaults',
    [String(DEFAULTS.enabledIds.length), def.name]);
  assert.equal(clause, '3 redirectors enabled, FxTwitter as the default');

  // And the sentence around it no longer states either fact itself. This is
  // the regression guard: writing the numbers back into the prose fails here.
  const hint = load().resetHint.message;
  assert.ok(hint.includes('{1}'), 'the clause is a part of the sentence');
  assert.doesNotMatch(hint, /three|FxTwitter/i,
    'the sentence should not name the defaults it is given');
});

test('the message format has no plural rules, so the bundled count may not be one', () => {
  /*
   * U11, the limit this leaves behind, recorded rather than hidden.
   * WebExtension messages have no plural selection: "$count$ redirectors
   * enabled" is correct for every count except 1. xIT bundles three and that
   * is unlikely to drop, but nothing in the format would catch it, so this is
   * what catches it.
   */
  assert.ok(libraries().XITStore.DEFAULTS.enabledIds.length > 1,
    'a single bundled redirector would read "1 redirectors"; resetDefaults needs rewording first');
});

test('the derived clause has somewhere to go and something to fill it', () => {
  // The span and the code that writes it are two halves of one change: either
  // alone leaves the dialog saying nothing where the defaults should be.
  const html = read('src/options/options.html');
  const js = read('src/options/options.js');
  assert.match(html, /<span id="reset-defaults">/);
  assert.match(html, /data-i18n-parts="resetHint"/);
  assert.match(js, /\$\('reset-defaults'\)\.textContent = resetDefaults\(\)/);
  // And it fills it from DEFAULTS rather than from a number typed again: a
  // literal count here is the whole of U11, one layer down.
  assert.match(js, /XITStore\.DEFAULTS\.enabledIds\.length/);
  assert.match(js, /XITStore\.DEFAULTS\.defaultRedirector/);
});
