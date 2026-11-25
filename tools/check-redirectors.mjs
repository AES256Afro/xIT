#!/usr/bin/env node
/*
 * Do the redirectors xIT ships still answer?
 *
 * The same question Settings' Check asks, asked from a repository job rather
 * than a user's browser: one HEAD request to each bundled and catalogue
 * host's front page, redirects counted as answers and not followed. A host
 * answering with a server error, or not at all, fails the run, which is how
 * a maintainer hears that a service went away before users do.
 *
 * An answer is not proof a host still displays tweets, exactly as in
 * Settings. Run by .github/workflows/redirectors.yml every week, or by hand:
 *
 *   node tools/check-redirectors.mjs
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ctx = vm.createContext({ URL, URLSearchParams, JSON });
vm.runInContext(readFileSync(path.join(ROOT, 'src/lib/redirectors.js'), 'utf8'), ctx);
const XIT = ctx.XIT;

const TIMEOUT_MS = 10000;

async function check(origin) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(origin, { method: 'HEAD', redirect: 'manual', signal: control.signal });
    const status = res.status;
    if (status >= 300 && status < 400) return { ok: true, status, note: 'redirects to ' + (res.headers.get('location') || '?') };
    if (status === 405 || status < 400) return { ok: true, status };
    if (status >= 500) return { ok: false, status, note: 'server error' };
    return { ok: true, status, note: 'answers, but refuses HEAD' };
  } catch (error) {
    return { ok: false, status: null, note: 'no answer: ' + (error.cause?.code || error.name) };
  } finally {
    clearTimeout(timer);
  }
}

const rows = [];
for (const origin of XIT.CHECK_ORIGINS) rows.push({ origin, ...(await check(origin)) });

const failed = rows.filter((r) => !r.ok);
for (const r of rows) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.origin}  ${r.status ?? '-'}${r.note ? '  ' + r.note : ''}`);
}
if (failed.length) {
  console.log(`\n${failed.length} of ${rows.length} redirector hosts did not answer properly.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} redirector hosts answered.`);
