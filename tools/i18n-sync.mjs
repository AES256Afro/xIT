#!/usr/bin/env node
/*
 * C11: keeps src/_locales/en/messages.json in step with the strings marked in
 * the pages.
 *
 * The English is derived from the markup rather than typed into the catalogue
 * by hand, which is the whole point: the markup is what a reader sees, and
 * retyping sixty strings into a second file is how wording quietly drifts
 * between the two. The same derivation backs `--check`, which test/i18n
 * runs, so a change to either side that is not mirrored fails.
 *
 *   node tools/i18n-sync.mjs           # report drift
 *   node tools/i18n-sync.mjs --write   # rewrite the catalogue from the markup
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const CATALOGUE = path.join(ROOT, 'src/_locales/en/messages.json');
export const PAGES = ['src/options/options.html', 'src/popup/popup.html'];

// Elements that never carry a closing tag, so the scanner must not look for one.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr', 'path']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
  if (body[0] === '#') return String.fromCodePoint(Number(body[1] === 'x' || body[1] === 'X' ? '0' + body.slice(1) : body.slice(1)));
  const key = body.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
});

/** Attributes of one start tag, as written. */
function attrsOf(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z0-9-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * Walk start tags, tracking the nearest enclosing <h2> text so a translator
 * is told which panel a string belongs to. Yields every element that carries
 * a data-i18n attribute, with its raw inner markup.
 */
function* marked(html) {
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g;
  let section = '';
  let m;
  while ((m = tagRe.exec(html))) {
    const [whole, name, rest] = m;
    const tag = name.toLowerCase();
    if (tag === 'h2') {
      const close = html.indexOf('</h2>', m.index);
      if (close !== -1) section = text(html.slice(m.index + whole.length, close));
    }
    const attrs = attrsOf(rest);
    const keys = Object.keys(attrs).filter((a) => a === 'data-i18n' || a.startsWith('data-i18n-'));
    if (!keys.length) continue;
    let inner = '';
    if (!VOID.has(tag) && !whole.endsWith('/>')) {
      // Find this element's own closing tag, allowing the same tag inside it.
      const open = new RegExp('<' + tag + '\\b', 'gi');
      const close = new RegExp('</' + tag + '\\s*>', 'gi');
      let depth = 1;
      let at = m.index + whole.length;
      const start = at;
      while (depth > 0) {
        open.lastIndex = close.lastIndex = at;
        const nextOpen = open.exec(html);
        const nextClose = close.exec(html);
        if (!nextClose) throw new Error(`<${tag}> at offset ${m.index} is never closed`);
        if (nextOpen && nextOpen.index < nextClose.index) { depth += 1; at = nextOpen.index + nextOpen[0].length; }
        else { depth -= 1; at = nextClose.index + nextClose[0].length; if (!depth) inner = html.slice(start, nextClose.index); }
      }
    }
    yield { tag, attrs, inner, section, keys };
  }
}

/** Collapse markup to the text a reader sees. */
function text(markup) {
  return decode(markup.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** The same, but each child element becomes {1}, {2}, ... in document order. */
function textWithParts(markup) {
  let n = 0;
  const replaced = markup.replace(/<([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>([\s\S]*?)<\/\1\s*>|<([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g,
    (whole, named) => (named || VOID.has((whole.match(/^<([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase())) ? '{' + (++n) + '}' : whole);
  return decode(replaced).replace(/\s+/g, ' ').trim();
}

// $name$ in a message body, the form the browser substitutes into.
const PLACEHOLDER_RE = /\$([A-Za-z_][A-Za-z0-9_]*)\$/g;

const ATTR_LABEL = { placeholder: 'placeholder text', 'aria-label': 'accessible name', title: 'tooltip' };

/** Every message the pages ask for, derived from the pages. */
export function derive() {
  const found = new Map();
  for (const file of PAGES) {
    const page = file.includes('popup') ? 'Popup' : 'Settings';
    const html = readFileSync(path.join(ROOT, file), 'utf8');
    for (const el of marked(html)) {
      for (const attr of el.keys) {
        const key = el.attrs[attr];
        let message;
        let what;
        if (attr === 'data-i18n') { message = text(el.inner); what = `text of the <${el.tag}>`; }
        else if (attr === 'data-i18n-parts') { message = textWithParts(el.inner); what = `<${el.tag}> whose {1}, {2}... are markup kept in place`; }
        else {
          const name = attr.slice('data-i18n-'.length);
          message = decode(el.attrs[name] || '').replace(/\s+/g, ' ').trim();
          what = `${ATTR_LABEL[name] || name} of the <${el.tag}>`;
        }
        const where = el.section ? `${page}, ${el.section}` : page;
        const entry = { message, description: `${where}: ${what}.` };
        const seen = found.get(key);
        if (seen && seen.message !== entry.message) {
          throw new Error(`"${key}" is used for two different strings: "${seen.message}" and "${entry.message}"`);
        }
        if (!seen) found.set(key, entry);
      }
    }
  }
  return found;
}

/** Keys the manifest asks for, which have no markup to derive from. */
export function manifestKeys() {
  const build = readFileSync(path.join(ROOT, 'tools/build.mjs'), 'utf8');
  return new Set(Array.from(build.matchAll(/msg\('([^']+)'\)/g), (m) => m[1]));
}

// Everything that can call XITI18N.t at runtime.
const CODE = ['src/options/options.js', 'src/popup/popup.js', 'src/content/inject.js',
  'src/content/main-world.js', 'src/background.js', 'src/lib/storage.js'];

/**
 * Keys asked for from JavaScript. Their text cannot be derived, because there
 * is no markup holding it and because a message with a substitution needs a
 * `placeholders` block that only a person can write. They are hand-written in
 * the catalogue and only checked for existence here.
 */
export function codeKeys() {
  const keys = new Set();
  for (const file of CODE) {
    const code = readFileSync(path.join(ROOT, file), 'utf8');
    let at = 0;
    for (;;) {
      const call = code.indexOf('XITI18N.t(', at);
      if (call === -1) break;
      // Take the whole argument list, so a key chosen by a conditional
      // (t(x ? 'a' : 'b')) counts as used. Matching to the first ')' would
      // stop inside a nested call such as t('k', [String(n)]).
      let depth = 0;
      let end = call + 'XITI18N.t('.length - 1;
      for (let i = end; i < code.length; i++) {
        const c = code[i];
        if (c === '(') depth += 1;
        else if (c === ')') { depth -= 1; if (!depth) { end = i; break; } }
      }
      // Only the first argument names a message. Scanning the whole call
      // would pick up a literal from a substitution, such as the 'i' in
      // t('key', [user === 'i' ? '...' : user]).
      const open = call + 'XITI18N.t('.length;
      let nest = 0;
      let firstArgEnd = end;
      for (let i = open; i < end; i++) {
        const c = code[i];
        if (c === '(' || c === '[' || c === '{') nest += 1;
        else if (c === ')' || c === ']' || c === '}') nest -= 1;
        else if (c === ',' && nest === 0) { firstArgEnd = i; break; }
      }
      const key = code.slice(open, firstArgEnd);
      for (const m of key.matchAll(/'([^'\\]+)'/g)) {
        // A conditional first argument offers two keys; both are in use.
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(m[1])) keys.add(m[1]);
      }
      at = end;
    }
  }
  return keys;
}

export function load() {
  return JSON.parse(readFileSync(CATALOGUE, 'utf8'));
}

/**
 * The library's own prose: group headings, redirector notes, copy-format
 * names.
 *
 * src/lib/redirectors.js holds this text and has to stay free of browser
 * APIs, because tools/build.mjs evaluates it in a bare context and the unit
 * tests load it on its own. So the display code looks these up by the entry's
 * id (XITI18N.of) and they are derived here from the library itself, the same
 * way the host lists are read for the manifest. Nothing is retyped.
 */
/** Fold an entry id into a legal message name; mirrors XITI18N.of. */
function familyKey(family, id) {
  return family + '_' + String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

export function libraryMessages() {
  const context = vm.createContext({ URL, URLSearchParams, JSON });
  vm.runInContext(readFileSync(path.join(ROOT, 'src/lib/redirectors.js'), 'utf8'), context);
  const XIT = context.XIT;
  const out = new Map();
  for (const g of XIT.GROUPS) {
    if (!g.label) continue;
    out.set(familyKey('group', g.id), { message: g.label, description: `Heading for the "${g.id}" group of redirectors, in the lists and the right-click menu.` });
  }
  for (const r of XIT.PRESETS.concat(XIT.CATALOGUE)) {
    if (!r.note) continue;
    out.set(familyKey('note', r.id), { message: r.note, description: `One-line description of the ${r.name} redirector. Its name is a product name and is not translated.` });
  }
  for (const f of XIT.COPY_FORMATS) {
    out.set(familyKey('copyFormat', f.id), { message: f.name, description: `Name of the "${f.id}" copy format, as offered in Settings. Its example is a URL and is not translated.` });
  }
  return out;
}

/** Differences between the catalogue and the markup, as readable lines. */
export function check() {
  const current = load();
  const wanted = derive();
  const fromManifest = manifestKeys();
  const fromCode = codeKeys();
  for (const [key, entry] of libraryMessages()) wanted.set(key, entry);
  const problems = [];
  for (const [key, entry] of wanted) {
    const have = current[key];
    if (!have) { problems.push(`missing: ${key} ("${entry.message}")`); continue; }
    if (have.message !== entry.message) {
      problems.push(`drifted: ${key}\n    catalogue: "${have.message}"\n    source:    "${entry.message}"`);
    }
  }
  for (const key of Object.keys(current)) {
    if (!wanted.has(key) && !fromManifest.has(key) && !fromCode.has(key)) problems.push(`unused: ${key}`);
  }
  for (const [label, keys] of [['manifest', fromManifest], ['code', fromCode]]) {
    for (const key of keys) if (!current[key]) problems.push(`missing (${label}): ${key}`);
  }
  // A substitution that is passed but never declared is dropped silently by
  // the browser, which turns a sentence into a sentence with a hole in it.
  for (const [key, entry] of Object.entries(current)) {
    const used = new Set(Array.from(String(entry.message).matchAll(PLACEHOLDER_RE), (m) => m[1].toLowerCase()));
    const declared = new Set(Object.keys(entry.placeholders || {}).map((n) => n.toLowerCase()));
    for (const name of used) if (!declared.has(name)) problems.push(`${key} uses $${name}$ with no placeholder declared`);
    for (const name of declared) if (!used.has(name)) problems.push(`${key} declares a placeholder "${name}" it never uses`);
  }
  const ALLOWED = new Set(['message', 'description', 'placeholders']);
  for (const [key, entry] of Object.entries(current)) {
    for (const field of Object.keys(entry)) {
      if (!ALLOWED.has(field)) problems.push(`${key} has a "${field}" field, which is not part of the message format`);
    }
    if (!entry.description || !String(entry.description).trim()) {
      problems.push(`${key} has no description, which is the only context a translator gets`);
    }
    for (const [name, spec] of Object.entries(entry.placeholders || {})) {
      if (!spec || typeof spec.content !== 'string') problems.push(`${key}: placeholder "${name}" has no content`);
    }
  }
  return problems;
}

/** Rewrite the catalogue from the markup. */
function write() {
  const current = load();
  const wanted = derive();
  const fromManifest = manifestKeys();
  const fromCode = codeKeys();
  for (const [key, entry] of libraryMessages()) wanted.set(key, entry);
  const next = {};
  for (const key of fromCode) {
    if (!current[key]) throw new Error(`JavaScript asks for "${key}" and only a person can write that one`);
    next[key] = current[key];
  }
  for (const key of fromManifest) {
    if (!current[key]) throw new Error(`the manifest asks for "${key}" and only a human can write that one`);
    next[key] = current[key];
  }
  for (const [key, entry] of wanted) {
    // A key the manifest also uses keeps its hand-written description, which
    // says where in the store it appears. That is better than anything
    // derivable from the markup.
    if (fromManifest.has(key) || fromCode.has(key)) continue;
    next[key] = { message: entry.message, description: entry.description };
  }
  writeFileSync(CATALOGUE, JSON.stringify(next, null, 2) + '\n');
  return Object.keys(next).length;
}

if (process.argv[1] && process.argv[1].endsWith('i18n-sync.mjs')) {
  if (process.argv.includes('--write')) {
    console.log(`wrote ${write()} messages to src/_locales/en/messages.json`);
  } else {
    const problems = check();
    if (!problems.length) console.log('catalogue matches the markup');
    else { console.error(problems.map((p) => '  ' + p).join('\n')); process.exitCode = 1; }
  }
}
