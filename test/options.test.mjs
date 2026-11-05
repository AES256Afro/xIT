import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/options/options.js', import.meta.url), 'utf8');

/**
 * The source of one top-level function in options.js, by brace matching.
 * The options page is a DOM file with no harness here, so these are static
 * checks on its text: they hold an invariant that is about the order of
 * statements rather than about a value, which is the kind of thing a
 * behavioural test in the Playwright suite confirms but cannot be run in this
 * environment.
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
