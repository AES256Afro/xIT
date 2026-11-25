/*
 * xIT - Settings: shared state, saving and the preview sentence.
 *
 * One of the classic scripts options.html loads in order. They share the
 * page's top-level names, as the sections of one file would: page.js holds
 * the state and helpers the others use, and options.js starts the page.
 */
'use strict';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
const $ = (id) => document.getElementById(id);

const SAMPLE = 'https://x.com/jack/status/20?s=20&t=xyz';
let settings = null;
let savedTimer = 0;
let editingId = null;

function saved(text) {
  $('saved').textContent = text || XITI18N.t('saved');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1800);
}

async function commit(patch) {
  try {
    settings = await (patch && typeof patch.then === 'function' ? patch : XITStore.save(patch));
    saved();
    render();
    return true;
  } catch (e) { $('saved').textContent = XITI18N.t('errSave', [e.message]); return false; }
}

/**
 * "x.com/jack/status/20 becomes <b>result</b>". The sentence is one
 * message with {1} where the bold result goes, as data-i18n-parts does in
 * markup, so a translator can put it wherever the language needs it.
 */
function sampleSentence(node, result) {
  node.textContent = '';
  const b = document.createElement('b');
  b.textContent = result;
  XITI18N.t('sampleBecomes', undefined, '{1}').split('{1}').forEach((piece, index) => {
    if (index) node.append(b);
    if (piece) node.append(document.createTextNode(piece));
  });
}

function sampleFor(redirector) {
  const out = XIT.convert(SAMPLE, redirector, { stripTracking: settings.stripTracking });
  return out.ok ? out.url : out.reason;
}
