/**
 * Load one of the extension's page scripts into a context with the test DOM
 * and the real libraries behind it, so a test can click, type and then read
 * what the page says.
 *
 * The libraries are the shipped ones rather than stubs. A stub of the store
 * would have to repeat what counts as a redirector group, and this audit has
 * found that shape wrong often enough to stop writing it: when settings and
 * the catalogue decide what a render does, the render should be tested against
 * the code that reads them.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { fakeI18n } from './i18n-stub.mjs';
import { makeDom } from './dom.mjs';

const read = (name) => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');

/**
 * @param page one of 'popup/popup.js' or 'options/options.js'
 * @param options.tabUrl what the active tab is showing
 * @param options.settings a patch applied over the stored defaults
 */
export async function loadPage(page, options = {}) {
  const dom = makeDom();
  const local = { ...(options.local || {}) };
  const session = {};
  const sent = [];
  /*
   * Both browsers offer these two ways round, and the extension uses both: the
   * store promisifies the callback form, while the options page awaits the
   * promise form directly. A stub that took only one would have let a call in
   * the other style pass silently, so each method answers whichever was asked.
   */
  const dual = (work) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const done = (value) => new Promise((resolve) => setImmediate(() => resolve(value)));
    const result = work(...args);
    if (!cb) return done(result);
    done(result).then((value) => cb(value));
    return undefined;
  };

  const area = (store) => ({
    get: dual((keys) => {
      const names = keys === null || keys === undefined ? Object.keys(store) : [].concat(keys);
      const out = {};
      for (const key of names) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
      return out;
    }),
    set: dual((value) => {
      Object.assign(store, JSON.parse(JSON.stringify(value)));
      if (store === local) fireChange(value);
    }),
    remove: dual((key) => { for (const k of [].concat(key)) delete store[k]; }),
  });

  const listeners = [];
  // The page scripts listen for their own writes. Nothing here replays a
  // write the page made itself, because both pages already hold the settings
  // their own save returned; the listener is for the other page's writes, and
  // a test that wants one calls `changeSettings`.
  let replay = false;
  function fireChange(value) {
    if (!replay || !('settings' in value)) return;
    for (const fn of listeners) fn({ settings: { newValue: value.settings } }, 'local');
  }

  const api = {
    i18n: fakeI18n(),
    storage: {
      local: area(local),
      session: area(session),
      onChanged: { addListener(fn) { listeners.push(fn); } },
    },
    tabs: {
      query: async () => [{ id: 1, index: 0, url: options.tabUrl || 'https://x.com/jack/status/20' }],
      create: () => {},
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
    runtime: {
      getURL: (path) => 'chrome-extension://test/' + path,
      sendMessage: async (message) => { sent.push(message); return { ok: true, results: {}, report: {} }; },
      onMessage: { addListener() {} },
    },
  };

  const context = vm.createContext({
    console, URL, URLSearchParams, JSON, Set, Map, Date, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    chrome: api,
    document: dom.document,
    window: dom.window,
    CSS: dom.CSS,
    navigator: { userAgent: options.userAgent || 'Chrome/130', clipboard: { writeText: async () => {} } },
  });
  context.globalThis = context;

  if (options.settings) local.settings = options.settings;

  vm.runInContext(read('lib/i18n.js'), context);
  vm.runInContext(read('lib/redirectors.js'), context);
  vm.runInContext(read('lib/storage.js'), context);
  vm.runInContext(read(page), context);

  // init() is async: let every await in it settle before a test looks.
  for (let i = 0; i < 12; i++) await tick();
  replay = true;

  return {
    dom,
    document: dom.document,
    context,
    sent,
    local,
    $: (id) => dom.document.getElementById(id),
    /** Type into a field and fire the input event, as a keystroke does. */
    type(id, value) {
      const el = dom.document.getElementById(id);
      el.value = value;
      return el.dispatch('input');
    },
    /** A settings write from somewhere else, as the other page would make. */
    async changeSettings(patch) {
      const next = { ...(local.settings || {}), ...patch };
      local.settings = next;
      for (const fn of listeners) fn({ settings: { newValue: next } }, 'local');
      for (let i = 0; i < 6; i++) await tick();
    },
    settle: async (rounds = 6) => { for (let i = 0; i < rounds; i++) await tick(); },
  };
}
