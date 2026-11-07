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
 * Chrome is driven over its DevTools protocol, from one headless instance,
 * and each page is captured once it has loaded and settled. The --screenshot
 * flag used to do this and stopped being trustworthy in Chrome 156: with a
 * virtual-time budget it captured the content script's open menu as nothing
 * at all, while the DOM said the menu was open, laid out and visible. A
 * capture taken from a live page at a moment of our choosing has no such
 * gap between what the page holds and what the file shows.
 *
 * Needs Google Chrome, Node 22 or later for its WebSocket, and macOS `sips`
 * (or ImageMagick `magick`/`convert`).
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
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
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
  ['shot-custom',   1280, 800, 'screenshot-4-custom-instance'],
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
  // The stub goes in front of the first library script. lib/i18n.js looks for
  // chrome.i18n once, as it loads, so a stub that arrived later would leave
  // every message at its English fallback and some at nothing.
  const first = html.includes('<script src="lib/i18n.js">') ? '<script src="lib/i18n.js">' : '<script src="lib/redirectors.js">';
  html = html.replace(first, '<script src="stub.js"></script>\n' + first);
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


/* ---- browser ---- */

// How long a page gets after its load event for its own scripts to settle:
// the hero opens the menu at 300 ms, the custom-template page fills its form
// at 260 ms, and the options page scrolls to its panel at 200 ms.
const SETTLE_MS = 1500;

/**
 * One headless Chrome for the whole run, spoken to over the DevTools
 * protocol. Port 0 lets Chrome pick a free port and write it to the profile,
 * for the same reason the static server picks its own.
 */
async function startChrome(profile) {
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  const portFile = path.join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { port = Number((await readFile(portFile, 'utf8')).split('\n')[0]); } catch (_) { /* not yet */ }
  }
  if (!port) { child.kill('SIGKILL'); throw new Error('Chrome did not open a DevTools port'); }

  let targets = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (_) { /* not yet */ }
    if (!targets.some((t) => t.type === 'page')) await new Promise((r) => setTimeout(r, 100));
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) { child.kill('SIGKILL'); throw new Error('Chrome opened no page'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => {
    const fn = (params) => { listeners.get(method).delete(fn); resolve(params); };
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
  });
  await send('Page.enable');

  return {
    send,
    once,
    close() { try { ws.close(); } catch (_) { /* gone */ } try { child.kill('SIGKILL'); } catch (_) { /* gone */ } },
  };
}

/**
 * Take one screenshot: size the viewport, load the page, let it settle, and
 * capture at SCALE for the downscale to sharpen.
 */
async function shoot(browser, url, out, w, h) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SCALE, mobile: false });
  const loaded = browser.once('Page.loadEventFired');
  await browser.send('Page.navigate', { url });
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
}

/* ---- render ---- */

await mkdir(OUT, { recursive: true });
const profile = path.join(stage, 'chrome-profile');
await mkdir(profile, { recursive: true });
const browser = await startChrome(profile);
let made = 0;

try {
  for (const [tpl, w, h, outName] of ASSETS) {
    if (filter && !tpl.includes(filter) && !outName.includes(filter)) continue;
    const out = path.join(OUT, `${outName}.png`);
    await rm(out, { force: true });
    await shoot(browser, `http://127.0.0.1:${PORT}/${tpl}.html`, out, w, h);
    await downscale(out, w, h);
    console.log(`rendered store/assets/${outName}.png  ${w}x${h}`);
    made++;
  }
} finally {
  browser.close();
}

server.close();
await rm(stage, { recursive: true, force: true });

const written = (await readdir(OUT)).filter((f) => f.endsWith('.png'));
console.log(`\n${made} rendered, ${written.length} assets in store/assets/`);
