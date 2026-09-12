/*
 * Xit - settings.
 * Classic script. Depends on lib/redirectors.js. Exposes globalThis.XITStore.
 */
(function (root) {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = root.XIT;

  const SCHEMA_VERSION = 1;

  // Everything on by default except browse redirect, which changes where you
  // land and so should be an explicit opt-in.
  const DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    defaultRedirector: 'fxtwitter',
    enabledIds: XIT.PRESETS.map((p) => p.id),
    custom: [],

    copyButton: true,
    hijackNativeCopy: true,
    toast: true,
    stripTracking: true,
    contextMenu: true,

    browseRedirect: false,
    browseRedirectorId: 'xcancel',
    browseScope: { status: true, profile: true, other: false },
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function promisify(fn) {
    return new Promise((resolve, reject) => {
      try {
        const maybe = fn((res) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res);
        });
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function normalize(raw) {
    const s = Object.assign(clone(DEFAULTS), raw || {});
    s.schemaVersion = SCHEMA_VERSION;
    s.browseScope = Object.assign(clone(DEFAULTS.browseScope), (raw && raw.browseScope) || {});

    // Drop custom entries that no longer validate, and de-duplicate ids.
    const seen = new Set();
    s.custom = (Array.isArray(s.custom) ? s.custom : []).filter((c) => {
      if (!c || typeof c.template !== 'string') return false;
      if (!XIT.validateTemplate(c.template).ok) return false;
      const id = String(c.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((c) => ({
      id: String(c.id),
      name: String(c.name || c.id),
      group: 'custom',
      template: String(c.template).trim(),
      requires: /\{id\}/.test(c.template) && !/\{path\}/.test(c.template) ? ['id'] : [],
      note: c.note ? String(c.note) : '',
      custom: true,
    }));

    const known = new Set(XIT.PRESETS.map((p) => p.id).concat(s.custom.map((c) => c.id)));
    s.enabledIds = (Array.isArray(s.enabledIds) ? s.enabledIds : []).filter((id) => known.has(id));
    // A freshly added custom entry is enabled unless explicitly turned off.
    for (const c of s.custom) if (!s.enabledIds.includes(c.id)) s.enabledIds.push(c.id);
    if (!s.enabledIds.length) s.enabledIds = XIT.PRESETS.map((p) => p.id);

    if (!known.has(s.defaultRedirector) || !s.enabledIds.includes(s.defaultRedirector)) {
      s.defaultRedirector = s.enabledIds.includes('fxtwitter') ? 'fxtwitter' : s.enabledIds[0];
    }
    if (!known.has(s.browseRedirectorId)) s.browseRedirectorId = DEFAULTS.browseRedirectorId;

    for (const k of ['copyButton', 'hijackNativeCopy', 'toast', 'stripTracking', 'contextMenu', 'browseRedirect']) {
      s[k] = !!s[k];
    }
    return s;
  }

  async function load() {
    const got = await promisify((cb) => api.storage.local.get('settings', cb));
    return normalize(got && got.settings);
  }

  async function save(patch) {
    const current = await load();
    const next = normalize(Object.assign({}, current, patch || {}));
    await promisify((cb) => api.storage.local.set({ settings: next }, cb));
    return next;
  }

  /** Every redirector definition, presets first, regardless of enabled state. */
  function allRedirectors(settings) {
    return XIT.PRESETS.concat((settings && settings.custom) || []);
  }

  /** Only the ones the user kept, in preset order then custom order. */
  function enabledRedirectors(settings) {
    const on = new Set((settings && settings.enabledIds) || []);
    return allRedirectors(settings).filter((r) => on.has(r.id));
  }

  function findRedirector(settings, id) {
    return allRedirectors(settings).find((r) => r.id === id) || null;
  }

  function defaultRedirector(settings) {
    return findRedirector(settings, settings.defaultRedirector) || XIT.PRESETS[0];
  }

  /** Hosts of everything the user has configured, so mirrors can be retargeted. */
  function extraHosts(settings) {
    const set = new Set();
    for (const r of allRedirectors(settings)) {
      const h = XIT.templateHost(r.template);
      if (h) set.add(h);
    }
    return set;
  }

  function onChanged(cb) {
    api.storage.onChanged.addListener((changes, area) => {
      if ((area === 'local' || area === undefined) && changes.settings) {
        cb(normalize(changes.settings.newValue));
      }
    });
  }

  root.XITStore = {
    api, DEFAULTS, SCHEMA_VERSION,
    load, save, normalize, onChanged,
    allRedirectors, enabledRedirectors, findRedirector, defaultRedirector, extraHosts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
