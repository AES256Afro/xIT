/*
 * What goes into the package a store receives.
 *
 * Built into a temporary folder through XIT_DIST, never into dist/, because
 * a build clears dist/ of zips and those may be waiting to be uploaded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function files(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

test('the package ships only icons the manifest uses', () => {
  /*
   * C18. src/icons/icon-512.png is source art for the icon set, and was
   * copied into every package although nothing refers to it.
   */
  const out = mkdtempSync(path.join(os.tmpdir(), 'xit-package-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-zip'],
      { env: { ...process.env, XIT_DIST: out }, stdio: 'pipe' });
    for (const target of ['chrome', 'firefox']) {
      const dir = path.join(out, target);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const used = new Set([...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]);
      const shipped = files(dir).filter((f) => f.startsWith('icons/'));
      assert.deepEqual(shipped.filter((f) => !used.has(f)), [], `${target} ships icons nothing uses`);
      for (const icon of used) assert.ok(shipped.includes(icon), `${target} is missing ${icon}`);
    }
    assert.deepEqual(readdirSync(out).filter((f) => f.endsWith('.zip')), [], '--no-zip makes no zips');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
