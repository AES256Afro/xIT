#!/usr/bin/env node
/*
 * A syntax check of every script in the repo, with nothing to install.
 *
 * xIT has no npm dependencies and keeps it that way, so this is not a style
 * linter. It catches what reaches a user as a blank popup or a dead content
 * script: a file that does not parse. Node does the parsing: the extension's
 * classic scripts through vm.Script, the tools and tests through --check as
 * the modules they are.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(?:js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const targets = ['src', 'tools', 'test'].flatMap((dir) => files(path.join(ROOT, dir)));
const failed = [];
for (const file of targets) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('src' + path.sep) && file.endsWith('.js')) {
    // The extension's own files are classic scripts in every context that
    // loads them, and package.json's "type": "module" would make node --check
    // parse them as modules. Compiled here as what they are.
    try { new vm.Script(readFileSync(file, 'utf8'), { filename: rel }); }
    catch (error) { failed.push(rel + '\n' + error.message); }
    continue;
  }
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failed.push(rel + '\n' + result.stderr.trim());
}

if (failed.length) {
  console.error(failed.join('\n\n'));
  process.exit(1);
}
console.log(`${targets.length} scripts parse`);
