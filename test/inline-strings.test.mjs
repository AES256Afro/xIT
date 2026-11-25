/*
 * C16: no English typed straight into anything a person reads.
 *
 * Every user-facing string is meant to come from src/_locales, and README and
 * HANDOFF said that was true apart from C12. An audit found a dozen more,
 * because the catalogue check reads the markup and nothing read the scripts.
 * This reads the scripts.
 *
 * It flags a string literal holding words when it is:
 *   - assigned to textContent, title or placeholder,
 *   - passed to createTextNode or to setAttribute for aria-label, title or
 *     placeholder, or
 *   - a fragment meant for joining onto other text: one that starts or ends
 *     with a space or with sentence punctuation.
 * Arguments to XITI18N.t() and XITI18N.of() are message keys or the English
 * fallback the catalogue overrides, and are left alone.
 *
 * A string that genuinely is not prose for a person goes in ALLOWED, with the
 * reason it is there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../src');

// lib/redirectors.js is C12: its convert() and validateTemplate() messages
// need a library contract change to move, and its data (names, notes, group
// labels) is looked up through XITI18N.of() where it is shown. lib/i18n.js is
// the lookup itself.
const SKIP = new Set(['lib/redirectors.js', 'lib/i18n.js']);

/** Literals that are not prose, by file, with why. */
const ALLOWED = {
  'options/options.js': {
    'Alt+Shift+C': 'a key combination, the same in every language',
    'about:addons': 'an address the user copies',
  },
  'background.js': {
    'Chromium ': 'a browser name in the diagnostics report, which is kept in English for whoever reads the bug report',
  },
};

function scripts(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) scripts(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** The source with every XITI18N.t(...) and XITI18N.of(...) call blanked out. */
function withoutLookups(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const m = /^XITI18N\.(?:t|of)\(/.exec(src.slice(i, i + 16));
    if (!m) { out += src[i++]; continue; }
    let depth = 0;
    let j = i + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out += ' '.repeat(j + 1 - i);
    i = j + 1;
  }
  return out;
}

const WORDS = /[A-Za-z]{2,}/;
const LOOKUP = /(?:\$|getElementById|querySelector(?:All)?|closest|matches|getAttribute|hasAttribute|removeAttribute|setAttribute|createElement|createElementNS|addEventListener|contains|add|remove|toggle)\(\s*$/;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;

function findings(file) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const allowed = ALLOWED[rel] || {};
  const src = withoutLookups(readFileSync(file, 'utf8'))
    // Comments are not shown to anybody.
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (c, lead) => lead + ' '.repeat(c.length - lead.length));
  const found = [];
  const lines = src.split('\n');
  lines.forEach((line, index) => {
    if (/console\.(?:warn|log|error)\(/.test(line)) return;
    const shown = /\.(?:textContent|title|placeholder)\s*=|createTextNode\(|setAttribute\(\s*'(?:aria-label|title|placeholder)'/.test(line);
    for (const match of line.matchAll(LITERAL)) {
      const text = match[1] ?? match[2];
      if (!WORDS.test(text) || Object.hasOwn(allowed, text)) continue;
      // The thing being looked up, not the thing being shown: an element id,
      // a selector, an attribute or event name, a tag.
      if (LOOKUP.test(line.slice(0, match.index))) continue;
      if (/^[.#[][\w-]/.test(text)) continue;
      const fragment = /^\s|\s$|^[.,;:!?]\s/.test(text);
      // On a line that shows text, a lone identifier is still a key or an id;
      // anything with a capital or a space in it is words.
      const words = /\s/.test(text) || /^[A-Z]/.test(text) || !/^[\w:-]+$/.test(text) || /^[a-z]+$/.test(text);
      if (fragment || (shown && words)) found.push(`${rel}:${index + 1}  '${text}'`);
    }
  });
  return found;
}

test('no English is typed into a script where a person will read it', () => {
  const found = scripts(SRC)
    .filter((file) => !SKIP.has(path.relative(SRC, file).split(path.sep).join('/')))
    .flatMap(findings);
  assert.deepEqual(found, [], 'move these into src/_locales/en/messages.json:\n  ' + found.join('\n  '));
});
