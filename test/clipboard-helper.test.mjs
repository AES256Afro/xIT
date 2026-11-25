/*
 * C15: one way to write to the clipboard.
 *
 * There were four, with different fallbacks: the content script's, the
 * popup's (whose textarea was neither read-only nor positioned, so it could
 * scroll the popup and raise a phone's keyboard), Settings calling the API
 * bare, and the background's. lib/clipboard.js is the one the pages share.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeDom } from './helpers/dom.mjs';

const SRC = path.resolve(import.meta.dirname, '../src');

function load({ writeText, execCommand = () => true } = {}) {
  const dom = makeDom();
  const document = dom.document;
  document.execCommand = (name) => { document.lastCommand = name; return execCommand(); };
  const navigator = writeText ? { clipboard: { writeText } } : {};
  const ctx = vm.createContext({ document, navigator });
  ctx.globalThis = ctx;
  vm.runInContext(readFileSync(path.join(SRC, 'lib/clipboard.js'), 'utf8'), ctx);
  return { write: ctx.XITClipboard.write, document, dom };
}

test('the clipboard API is used when it answers', async () => {
  const written = [];
  const h = load({ writeText: async (text) => { written.push(text); } });
  assert.equal(await h.write('https://fxtwitter.com/jack/status/20'), true);
  assert.deepEqual(written, ['https://fxtwitter.com/jack/status/20']);
  assert.equal(h.document.lastCommand, undefined, 'and the fallback is not touched');
});

test('a refused API falls back to a read-only, fixed, invisible textarea', async () => {
  const h = load({ writeText: async () => { throw new Error('denied'); } });
  const appended = [];
  const append = h.document.body.appendChild.bind(h.document.body);
  h.document.body.appendChild = (node) => { appended.push(node); return append(node); };
  assert.equal(await h.write('hello'), true);
  assert.equal(h.document.lastCommand, 'copy');
  const ta = appended[0];
  assert.equal(ta.value, 'hello');
  assert.equal(ta.getAttribute('readonly'), '', 'read-only, so no keyboard comes up');
  assert.match(ta.style.cssText, /position:fixed/, 'fixed, so nothing scrolls');
  assert.match(ta.style.cssText, /opacity:0/, 'and invisible');
  assert.equal(h.document.body.querySelectorAll('textarea').length, 0, 'and removed afterwards');
});

test('a write that cannot happen says so', async () => {
  const h = load({ writeText: async () => { throw new Error('denied'); }, execCommand: () => false });
  assert.equal(await h.write('hello'), false);
});

test('pages write through the shared helper, not the API directly', () => {
  // Three places may touch navigator.clipboard: the helper itself, the
  // background's payload (serialised into a page with no libraries) and the
  // main world, whose whole job is wrapping it.
  const allowed = new Set(['lib/clipboard.js', 'background.js', 'content/main-world.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const rel = path.relative(SRC, full).split(path.sep).join('/');
      if (!allowed.has(rel) && /navigator\.clipboard/.test(readFileSync(full, 'utf8'))) offenders.push(rel);
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
