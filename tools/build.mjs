#!/usr/bin/env node
/*
 * Builds dist/chrome and dist/firefox from src/, then zips each.
 *
 * The two browsers differ in exactly three places, so the whole extension is
 * one source tree and the manifest is generated rather than duplicated:
 *   - Chrome runs the background as an MV3 service worker; Firefox as an
 *     event page with a scripts array.
 *   - Firefox needs browser_specific_settings.gecko.
 *   - Chrome wants minimum_chrome_version.
 */
import { cp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

const LIB = ['lib/redirectors.js', 'lib/storage.js'];

const HOSTS = [
  '*://x.com/*',
  '*://www.x.com/*',
  '*://twitter.com/*',
  '*://www.twitter.com/*',
  '*://mobile.twitter.com/*',
  '*://m.twitter.com/*',
];

function baseManifest() {
  return {
    manifest_version: 3,
    name: 'Xit',
    version: pkg.version,
    description: 'Copy X/Twitter links through fxtwitter, xcancel and friends. Pick a default, or choose per copy.',
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting', 'declarativeNetRequest', 'clipboardWrite'],
    host_permissions: HOSTS,
    // Redirecting page loads needs permission for the destination too, and the
    // destination is whatever the user picks. Asked for on demand.
    optional_host_permissions: ['*://*/*'],
    action: {
      default_title: 'Xit',
      default_popup: 'popup/popup.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    },
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    options_ui: { page: 'options/options.html', open_in_tab: true },
    content_scripts: [
      {
        matches: HOSTS,
        js: [...LIB, 'content/inject.js'],
        css: ['content/inject.css'],
        run_at: 'document_idle',
        all_frames: false,
      },
      {
        // Main world, purely to wrap navigator.clipboard so X's own
        // "Copy link" yields a redirected URL.
        matches: HOSTS,
        js: ['lib/redirectors.js', 'content/main-world.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: false,
      },
    ],
    commands: {
      'copy-current-tweet': {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Copy the tweet in view with the default redirector',
      },
    },
  };
}

function chromeManifest() {
  const m = baseManifest();
  m.background = { service_worker: 'background.js' };
  m.minimum_chrome_version = '111';
  return m;
}

function firefoxManifest() {
  const m = baseManifest();
  m.background = { scripts: [...LIB, 'background.js'] };
  m.browser_specific_settings = {
    gecko: {
      id: 'xit@aes256afro.github.io',
      strict_min_version: '128.0',
    },
  };
  return m;
}

async function buildTarget(name, manifest) {
  const out = path.join(DIST, name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(SRC, out, { recursive: true });
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return out;
}

async function zipTarget(name, dir) {
  const zipPath = path.join(DIST, `xit-${name}-${pkg.version}.zip`);
  await rm(zipPath, { force: true });

  // macOS and Linux.
  try {
    await run('zip', ['-qr', zipPath, '.'], { cwd: dir });
    return zipPath;
  } catch (_) { /* no `zip` on PATH - try Windows */ }

  // Windows. Single-quote the paths so spaces survive; double any quote.
  const ps = (v) => `'${v.replace(/'/g, "''")}'`;
  try {
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path ${ps(path.join(dir, '*'))} -DestinationPath ${ps(zipPath)} -Force`]);
    return zipPath;
  } catch (_) { /* fall through */ }

  console.warn(`  (no zip for ${name}: install \`zip\`, or use the dist/${name} folder directly)`);
  return null;
}

const wantZip = !process.argv.includes('--no-zip');

// Drop zips from previous builds so a renamed or old artefact cannot linger
// in dist/ and get uploaded to a store by mistake.
await mkdir(DIST, { recursive: true });
for (const f of await readdir(DIST)) {
  if (f.endsWith('.zip')) await rm(path.join(DIST, f), { force: true });
}

for (const [name, manifest] of [['chrome', chromeManifest()], ['firefox', firefoxManifest()]]) {
  const dir = await buildTarget(name, manifest);
  console.log(`built dist/${name}`);
  if (wantZip) {
    const z = await zipTarget(name, dir);
    if (z) console.log(`  ${path.relative(ROOT, z)}`);
  }
}

if (!existsSync(path.join(SRC, 'icons', 'icon-128.png'))) {
  console.warn('\nicons are missing - run: npm run icons');
}
