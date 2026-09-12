#!/usr/bin/env node
/*
 * Renders store screenshots and promo tiles into store/assets/.
 *
 * Screenshots are taken of the REAL popup, options page and content script -
 * the templates in tools/store-assets/ only supply the surrounding frame and
 * stub the extension APIs, so the images cannot drift from the shipped UI.
 *
 * Each asset is authored at its final CSS size, rendered at 2x, then
 * downsampled back - supersampling, so text stays sharp at the exact pixel
 * dimensions the stores require.
 *
 * Needs Google Chrome and macOS `sips` (or ImageMagick `magick`/`convert`).
 * Pass a filter to re-render a subset:  node tools/make-store-assets.mjs hero
 */
import { cp, mkdir, rm, writeFile, readFile, readdir, mkdtemp, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const TPL = path.join(ROOT, 'tools', 'store-assets');
const OUT = path.join(ROOT, 'store', 'assets');
const SCALE = 2;

const filter = process.argv[2] || '';

const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  process.env.CHROME_PATH,
].filter(Boolean).find((p) => existsSync(p));

if (!chrome) {
  console.error('Google Chrome not found. Set CHROME_PATH to its binary and re-run.');
  process.exit(1);
}

/** [template, final width, final height, output name] */
const ASSETS = [
  ['shot-hero',     1280, 800, 'screenshot-1-copy-any-tweet'],
  ['shot-popup',    1280, 800, 'screenshot-2-popup'],
  ['shot-options',  1280, 800, 'screenshot-3-both-routes'],
  ['shot-redirect', 1280, 800, 'screenshot-4-browse-redirect'],
  ['shot-custom',   1280, 800, 'screenshot-5-custom-instance'],
  ['tile-small',     440, 280, 'promo-tile-small-440x280'],
  ['tile-marquee',  1400, 560, 'promo-tile-marquee-1400x560'],
];

/* ---- staging ---- */

const stage = await mkdtemp(path.join(os.tmpdir(), 'xit-assets-'));
await cp(SRC, stage, { recursive: true });
await cp(TPL, stage, { recursive: true });

/**
 * Copy a real extension page to the staging root, pointed at its own assets
 * one directory down and with the API stubs loaded first.
 */
async function stubPage(dir, file, extraScript) {
  let html = await readFile(path.join(SRC, dir, file), 'utf8');
  const base = path.basename(file, '.html');
  html = html.replace(/src="\.\.\/lib\//g, 'src="lib/');
  html = html.replace(`href="${base}.css"`, `href="${dir}/${base}.css"`);
  html = html.replace(`src="${base}.js"`, `src="${dir}/${base}.js"`);
  html = html.replace('<script src="lib/redirectors.js">', '<script src="stub.js"></script>\n<script src="lib/redirectors.js">');
  html = html.replace('</body>', `<script>${extraScript || ''}</script>\n</body>`);
  await writeFile(path.join(stage, `${base}-stub.html`), html);
}

const SCROLL_TO_PANEL = `
  // Bring the requested panel to the top of the framed viewport.
  const want = new URLSearchParams(location.search).get('panel');
  if (want) {
    setTimeout(() => {
      const panel = [...document.querySelectorAll('.panel')]
        .find((p) => (p.querySelector('h2') || {}).textContent === want);
      if (panel) {
        document.querySelector('.wrap').style.paddingTop = '0px';
        scrollTo(0, panel.getBoundingClientRect().top + scrollY - 16);
      }
    }, 200);
  }
`;

await stubPage('popup', 'popup.html');
await stubPage('options', 'options.html', SCROLL_TO_PANEL);

/* ---- static server ---- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(stage, rel);
  if (!file.startsWith(stage) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
// Port 0: let the OS pick a free one, so a stale run cannot collide.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/* ---- downscale ---- */

async function downscale(file, w, h) {
  try {
    await run('sips', ['-z', String(h), String(w), file, '--out', file]);
    return;
  } catch (_) { /* not macOS */ }
  for (const bin of ['magick', 'convert']) {
    try {
      await run(bin, [file, '-resize', `${w}x${h}`, file]);
      return;
    } catch (_) { /* keep looking */ }
  }
  console.warn(`  ! could not downscale ${path.basename(file)} - it is ${SCALE}x oversized`);
}


/**
 * Take one screenshot.
 *
 * Headless Chrome reliably *writes* the PNG but does not always exit when the
 * page contains subframes, so waiting on the process is not dependable. Wait
 * for the file to appear and stop growing instead, then stop the browser.
 */
async function shoot(url, out, w, h) {
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${w},${h}`,
    '--virtual-time-budget=5000',
    `--screenshot=${out}`,
    url,
  ], { stdio: 'ignore', detached: false });

  const deadline = Date.now() + 60000;
  let lastSize = -1;
  let stableFor = 0;
  let exited = false;
  child.on('exit', () => { exited = true; });

  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      let size = -1;
      try { size = (await stat(out)).size; } catch (_) { /* not written yet */ }
      if (size > 0 && size === lastSize) {
        stableFor += 250;
        if (stableFor >= 750) return;   // written and settled
      } else {
        stableFor = 0;
      }
      lastSize = size;
      if (exited && size > 0) return;
      if (exited && Date.now() > deadline - 55000 && size <= 0) break;
    }
    throw new Error(`timed out waiting for ${path.basename(out)}`);
  } finally {
    if (!exited) { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }
  }
}

/* ---- render ---- */

await mkdir(OUT, { recursive: true });
const profile = path.join(stage, 'chrome-profile');
let made = 0;

for (const [tpl, w, h, outName] of ASSETS) {
  if (filter && !tpl.includes(filter) && !outName.includes(filter)) continue;
  const out = path.join(OUT, `${outName}.png`);
  await rm(out, { force: true });
  await shoot(`http://127.0.0.1:${PORT}/${tpl}.html`, out, w, h);
  await downscale(out, w, h);
  console.log(`rendered store/assets/${outName}.png  ${w}x${h}`);
  made++;
}

server.close();
await rm(stage, { recursive: true, force: true });

const written = (await readdir(OUT)).filter((f) => f.endsWith('.png'));
console.log(`\n${made} rendered, ${written.length} assets in store/assets/`);
