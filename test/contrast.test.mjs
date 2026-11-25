import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * U10: the status colours were chosen for brand fidelity and never measured.
 * Three of them failed WCAG AA as text. These assertions are the measurement,
 * so the next person to reach for a brand hex has to answer to a number.
 *
 * Levels: 4.5:1 for text below 18.66px bold, 3:1 for a border or outline that
 * carries state (WCAG 1.4.11). Every pair here is given a little headroom.
 */

const SRC = path.resolve(import.meta.dirname, '../src');
const css = (f) => readFileSync(path.join(SRC, f), 'utf8');

/** Pull `--name: value;` out of one block, the last definition winning. */
function tokens(text, block) {
  const at = text.indexOf(block);
  assert.notEqual(at, -1, 'missing block ' + block);
  const body = text.slice(at + block.length);
  const end = body.indexOf('}');
  const out = {};
  for (const m of body.slice(0, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function rgb(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
  }
  const fn = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/i.exec(value);
  assert.ok(fn, 'not a colour: ' + value);
  return [+fn[1], +fn[2], +fn[3], fn[4] === undefined ? 1 : +fn[4]];
}

const channel = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Lay a possibly translucent colour over an opaque one. */
function over(top, bottom) {
  const [r, g, b, a = 1] = rgb(top);
  const under = rgb(bottom);
  return [r, g, b].map((v, i) => v * a + under[i] * (1 - a));
}

function ratio(fg, bg) {
  const a = luminance(rgb(fg).slice(0, 3));
  const b = luminance(Array.isArray(bg) ? bg : rgb(bg).slice(0, 3));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function atLeast(fg, bg, floor, what) {
  const got = ratio(fg, bg);
  assert.ok(got >= floor, `${what}: ${got.toFixed(2)}:1, needs ${floor}:1`);
}

test('options page text colours clear WCAG AA in both themes', () => {
  const text = css('options/options.css');
  const light = tokens(text, ':root {');
  const dark = tokens(text, '@media (prefers-color-scheme: dark) {\n  :root {');
  for (const [name, t] of [['light', { ...light }], ['dark', { ...light, ...dark }]]) {
    for (const ground of ['card', 'bg']) {
      for (const key of ['accent-text', 'ok-text', 'danger-text', 'muted', 'fg']) {
        atLeast(t[key], t[ground], 4.5, `${name} --${key} on --${ground}`);
      }
    }
    // The badge sits on a 16% blue tint, which is the worst ground in the page.
    atLeast(t['accent-text'], over('rgba(29, 155, 240, .16)', t.card), 4.5,
      `${name} --accent-text on the badge tint`);
    // Filled buttons carry their own foreground, and their edge must be visible.
    atLeast(t['accent-fill-fg'], t['accent-fill'], 4.5, `${name} primary button text`);
    atLeast(t['danger-fill-fg'], t['danger-fill'], 4.5, `${name} danger button text`);
    atLeast(t['accent-fill'], t.card, 3, `${name} primary button edge`);
    atLeast(t['danger-fill'], t.card, 3, `${name} danger button edge`);
  }
});

test('popup text colours clear WCAG AA in both themes', () => {
  const text = css('popup/popup.css');
  const light = tokens(text, ':root {');
  const dark = tokens(text, '@media (prefers-color-scheme: dark) {\n  :root {');
  for (const [name, t] of [['light', { ...light }], ['dark', { ...light, ...dark }]]) {
    for (const ground of ['card', 'bg']) {
      for (const key of ['accent-text', 'muted', 'fg']) {
        atLeast(t[key], t[ground], 4.5, `${name} --${key} on --${ground}`);
      }
    }
    for (const tint of ['rgba(29, 155, 240, 0.12)', 'rgba(29,155,240,.15)', 'rgba(29, 155, 240, 0.14)']) {
      atLeast(t['accent-text'], over(tint, t.bg), 4.5, `${name} --accent-text on ${tint}`);
    }
    atLeast(t['warn-fg'], t.warn, 4.5, `${name} --warn-fg on --warn`);
    atLeast(t['accent-fill-fg'], t['accent-fill'], 4.5, `${name} primary button text`);
  }
});

test('the in-page menu text colours clear WCAG AA in both themes', () => {
  const text = css('content/inject.css');
  const darkDefault = tokens(text, ':root {');
  const lightOverride = tokens(text, 'html[data-xit-theme="light"] {');
  for (const [name, t] of [['dark', { ...darkDefault }], ['light', { ...darkDefault, ...lightOverride }]]) {
    atLeast(t['xit-accent-text'], over(t['xit-accent-soft'], t['xit-panel']), 4.5,
      `${name} --xit-accent-text on the soft tint`);
    atLeast(t['xit-accent-text'], t['xit-panel'], 4.5, `${name} --xit-accent-text on the panel`);
    atLeast(t['xit-muted'], t['xit-panel'], 4.5, `${name} --xit-muted on the panel`);
    atLeast(t['xit-fg-strong'], t['xit-panel'], 4.5, `${name} --xit-fg-strong on the panel`);
  }
});

test('the in-page toast is readable on every fill it uses', () => {
  /*
   * D1. The toast is how every copy, failure and substitution is reported,
   * and its fills were never measured: white 14px text sat on the accent
   * blue at 3.00:1 and on the error red at 4.11:1. The fills are tokens now,
   * and the toast rules have to use them, or a fix here would not reach the
   * banner a person actually reads.
   *
   * Putting the toast back on --xit-accent, or a literal red, makes this fail.
   */
  const text = css('content/inject.css');
  const t = tokens(text, ':root {');
  for (const kind of ['ok', 'error', 'warn']) {
    atLeast(t['xit-toast-fg'], t['xit-toast-' + kind], 4.5, `toast text on --xit-toast-${kind}`);
  }
  const rule = (selector) => {
    const at = text.indexOf(selector + ' {');
    assert.notEqual(at, -1, 'missing rule ' + selector);
    return text.slice(at, text.indexOf('}', at));
  };
  assert.match(rule('.xit-toast'), /background:\s*var\(--xit-toast-ok\)/);
  assert.match(rule('.xit-toast'), /color:\s*var\(--xit-toast-fg\)/);
  assert.match(rule('.xit-toast[data-kind="error"]'), /background:\s*var\(--xit-toast-error\)/);
  assert.match(rule('.xit-toast[data-kind="warn"]'), /background:\s*var\(--xit-toast-warn\)/);
});
