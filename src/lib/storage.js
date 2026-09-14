/*
 * xIT - settings.
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
    const s = clone(DEFAULTS);
    for (const key of Object.keys(DEFAULTS)) {
      if (raw && Object.prototype.hasOwnProperty.call(raw, key)) s[key] = raw[key];
    }
    s.schemaVersion = SCHEMA_VERSION;
    s.browseScope = Object.assign(clone(DEFAULTS.browseScope), (raw && raw.browseScope) || {});
    s.browseScope = Object.fromEntries(Object.keys(DEFAULTS.browseScope).map((key) => [key, !!s.browseScope[key]]));

    // Drop custom entries that no longer validate, and de-duplicate ids.
    const seen = new Set(XIT.PRESETS.map((p) => p.id));
    s.custom = (Array.isArray(s.custom) ? s.custom : []).filter((c) => {
      if (!c || typeof c.template !== 'string') return false;
      if (!XIT.validateTemplate(c.template).ok) return false;
      const id = String(c.id || '');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id)) return false;
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
    s.enabledIds = [...new Set((Array.isArray(s.enabledIds) ? s.enabledIds : []).filter((id) => known.has(id)))];

    if (!known.has(s.defaultRedirector) || !s.enabledIds.includes(s.defaultRedirector)) {
      s.defaultRedirector = s.enabledIds.includes('fxtwitter') ? 'fxtwitter' : (s.enabledIds[0] || DEFAULTS.defaultRedirector);
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

  let writer = false;
  let writeChain = Promise.resolve();

  // Only the background enables the writer. Every other context sends a
  // mutation there, so each operation reads after the previous write finishes.
  function startWriter() { writer = true; }

  async function applyMutation(operation) {
    const current = await load();
    let raw = current;
    if (!operation || typeof operation !== 'object') throw new Error('Invalid settings operation.');
    if (operation.type === 'patch') {
      const patch = operation.patch || {};
      raw = { ...current, ...patch, browseScope: { ...current.browseScope, ...patch.browseScope } };
    } else if (operation.type === 'replace') {
      if (!operation.settings || typeof operation.settings !== 'object' || Array.isArray(operation.settings)) throw new Error('Settings must be a JSON object.');
      raw = operation.settings;
    } else if (operation.type === 'reset') {
      raw = DEFAULTS;
      await promisify((cb) => api.storage.local.remove('lastCopyFailure', cb));
    } else if (operation.type === 'enabled') {
      const ids = new Set(current.enabledIds);
      if (operation.enabled) ids.add(operation.id); else ids.delete(operation.id);
      raw = { ...current, enabledIds: [...ids] };
    } else if (operation.type === 'remove-custom') {
      raw = { ...current, custom: current.custom.filter((c) => c.id !== operation.id) };
    } else if (operation.type === 'add-custom') {
      const entry = operation.entry || {};
      const name = String(entry.name || '').trim();
      const validation = XIT.validateTemplate(entry.template);
      if (!name || !validation.ok) throw new Error(validation.error || 'Give the redirector a name.');
      const base = 'c-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
      const taken = new Set(allRedirectors(current).map((r) => r.id));
      let id = base;
      for (let n = 2; taken.has(id); n++) id = base + '-' + n;
      raw = { ...current, custom: [...current.custom, { id, name, template: entry.template }], enabledIds: [...current.enabledIds, id] };
    } else {
      throw new Error('Unknown settings operation.');
    }
    const next = normalize(raw);
    if (JSON.stringify(next) !== JSON.stringify(current) || operation.type === 'reset') {
      await promisify((cb) => api.storage.local.set({ settings: next }, cb));
    }
    return next;
  }

  function mutate(operation) {
    if (!writer) {
      return promisify((cb) => api.runtime.sendMessage({ type: 'xit:mutate-settings', operation }, cb)).then((result) => {
        if (!result || !result.ok) throw new Error((result && result.error) || 'Could not save settings.');
        return normalize(result.settings);
      });
    }
    const pending = writeChain.then(() => applyMutation(operation));
    writeChain = pending.catch(() => {});
    return pending;
  }

  const save = (patch) => mutate({ type: 'patch', patch });
  const replace = (settings) => mutate({ type: 'replace', settings });
  const reset = () => mutate({ type: 'reset' });
  const setEnabled = (id, enabled) => mutate({ type: 'enabled', id, enabled });
  const addCustom = (entry) => mutate({ type: 'add-custom', entry });
  const removeCustom = (id) => mutate({ type: 'remove-custom', id });

  function browseStatusKey(settings) {
    const r = findRedirector(settings, settings.browseRedirectorId);
    return JSON.stringify([settings.browseRedirect, r && r.template, settings.browseScope]);
  }

  function browseStatusMessage(settings, status) {
    if (!status || status.key !== browseStatusKey(settings)) return 'Applying page redirect settings…';
    if (status.state === 'error') return status.message;
    if (status.state === 'updating') return 'Applying page redirect settings…';
    if (status.state === 'active') return 'Page redirect is active.';
    return settings.browseRedirect ? 'No page types are selected.' : '';
  }

  function watchStatus(cb) {
    let changed = false;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.dnrStatus) {
        changed = true;
        cb(changes.dnrStatus.newValue);
      }
    });
    promisify((done) => api.storage.local.get('dnrStatus', done))
      .then((value) => { if (!changed) cb(value && value.dnrStatus); })
      .catch(() => { if (!changed) cb(null); });
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
    load, save, replace, reset, setEnabled, addCustom, removeCustom, normalize, onChanged,
    startWriter, mutate, browseStatusKey, browseStatusMessage, watchStatus,
    allRedirectors, enabledRedirectors, findRedirector, defaultRedirector, extraHosts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
