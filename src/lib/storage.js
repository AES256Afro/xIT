/*
 * xIT - settings.
 * Classic script. Depends on lib/redirectors.js. Exposes globalThis.XITStore.
 */
(function (root) {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = root.XIT;

  const SCHEMA_VERSION = 1;

  // Keys absent from DEFAULTS are dropped by normalize(). That is how the
  // page-redirect settings removed in 1.0.7 disappear from stored data.
  const DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    defaultRedirector: 'fxtwitter',
    enabledIds: XIT.PRESETS.map((p) => p.id),
    custom: [],
    pinnedIds: [],

    copyButton: true,
    hijackNativeCopy: true,
    toast: true,
    stripTracking: true,
    contextMenu: true,
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
    s.pinnedIds = [...new Set((Array.isArray(s.pinnedIds) ? s.pinnedIds : []).filter((id) => known.has(id)))];

    if (!known.has(s.defaultRedirector) || !s.enabledIds.includes(s.defaultRedirector)) {
      s.defaultRedirector = s.enabledIds.includes('fxtwitter') ? 'fxtwitter' : (s.enabledIds[0] || DEFAULTS.defaultRedirector);
    }

    for (const k of ['copyButton', 'hijackNativeCopy', 'toast', 'stripTracking', 'contextMenu']) {
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
    let undo = null;
    if (!operation || typeof operation !== 'object') throw new Error('Invalid settings operation.');
    if (operation.type === 'patch') {
      const patch = operation.patch || {};
      raw = { ...current, ...patch };
    } else if (operation.type === 'replace') {
      if (!operation.settings || typeof operation.settings !== 'object' || Array.isArray(operation.settings)) throw new Error('Settings must be a JSON object.');
      raw = operation.settings;
    } else if (operation.type === 'rewrite') {
      // Re-save normalized settings so keys that are no longer in DEFAULTS
      // leave stored data, not just the object normalize() returns.
      raw = current;
    } else if (operation.type === 'reset') {
      raw = DEFAULTS;
      await promisify((cb) => api.storage.local.remove('lastCopyFailure', cb));
    } else if (operation.type === 'enabled') {
      const ids = new Set(current.enabledIds);
      if (operation.enabled) ids.add(operation.id); else ids.delete(operation.id);
      raw = { ...current, enabledIds: [...ids] };
    } else if (operation.type === 'remove-custom') {
      const entry = current.custom.find((c) => c.id === operation.id);
      if (!entry) throw new Error('That custom redirector no longer exists.');
      raw = { ...current, custom: current.custom.filter((c) => c.id !== operation.id) };
      undo = { entry, enabled: current.enabledIds.includes(entry.id), pinIndex: current.pinnedIds.indexOf(entry.id),
        defaultBefore: current.defaultRedirector };
    } else if (operation.type === 'restore-custom') {
      const removed = await getUndo();
      if (!removed) throw new Error('There is no removed redirector to restore.');
      if (allRedirectors(current).some((r) => r.id === removed.entry.id)) throw new Error('That redirector ID is already in use.');
      const pins = [...current.pinnedIds];
      if (removed.pinIndex >= 0) pins.splice(removed.pinIndex, 0, removed.entry.id);
      raw = { ...current, custom: [...current.custom, removed.entry], pinnedIds: pins,
        enabledIds: removed.enabled ? [...current.enabledIds, removed.entry.id] : current.enabledIds,
        defaultRedirector: current.defaultRedirector === removed.defaultAfter ? removed.defaultBefore : current.defaultRedirector };
    } else if (operation.type === 'pin') {
      const pins = current.pinnedIds.filter((id) => id !== operation.id);
      if (operation.pinned) pins.push(operation.id);
      raw = { ...current, pinnedIds: pins };
    } else if (operation.type === 'move-pin') {
      const pins = [...current.pinnedIds];
      const index = pins.indexOf(operation.id);
      const nextIndex = index + (operation.direction < 0 ? -1 : 1);
      if (index >= 0 && nextIndex >= 0 && nextIndex < pins.length) [pins[index], pins[nextIndex]] = [pins[nextIndex], pins[index]];
      raw = { ...current, pinnedIds: pins };
    } else if (['add-custom', 'edit-custom', 'duplicate-custom'].includes(operation.type)) {
      const original = current.custom.find((c) => c.id === operation.id);
      if (operation.type !== 'add-custom' && !original) throw new Error('That custom redirector no longer exists.');
      const entry = operation.type === 'duplicate-custom' ? { ...original, name: original.name + ' copy' } : operation.entry || {};
      const name = String(entry.name || '').trim();
      const validation = XIT.validateTemplate(entry.template);
      if (!name || !validation.ok) throw new Error(validation.error || 'Give the redirector a name.');
      const base = 'c-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
      const taken = new Set(allRedirectors(current).map((r) => r.id));
      let id = base;
      for (let n = 2; taken.has(id); n++) id = base + '-' + n;
      if (operation.type === 'edit-custom') {
        raw = { ...current, custom: current.custom.map((c) => c.id === original.id ? { ...c, name, template: entry.template } : c) };
      } else {
        raw = { ...current, custom: [...current.custom, { id, name, template: entry.template }], enabledIds: [...current.enabledIds, id] };
      }
    } else {
      throw new Error('Unknown settings operation.');
    }
    const next = normalize(raw);
    if (JSON.stringify(next) !== JSON.stringify(current) || operation.type === 'reset' || operation.type === 'rewrite') {
      await promisify((cb) => api.storage.local.set({ settings: next }, cb));
    }
    if (undo) {
      await promisify((cb) => api.storage.session.set({ removedCustom: { ...undo,
        defaultAfter: next.defaultRedirector } }, cb));
    } else if (['restore-custom', 'reset', 'replace'].includes(operation.type)) {
      await promisify((cb) => api.storage.session.remove('removedCustom', cb));
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
  const editCustom = (id, entry) => mutate({ type: 'edit-custom', id, entry });
  const duplicateCustom = (id) => mutate({ type: 'duplicate-custom', id });
  const restoreCustom = () => mutate({ type: 'restore-custom' });
  const setPinned = (id, pinned) => mutate({ type: 'pin', id, pinned });
  const movePinned = (id, direction) => mutate({ type: 'move-pin', id, direction });
  const getUndo = async () => (await promisify((cb) => api.storage.session.get('removedCustom', cb))).removedCustom || null;

  /** Every redirector definition, presets first, regardless of enabled state. */
  function allRedirectors(settings) {
    return XIT.PRESETS.concat((settings && settings.custom) || []);
  }

  /** Only the ones the user kept, in preset order then custom order. */
  function enabledRedirectors(settings) {
    const on = new Set((settings && settings.enabledIds) || []);
    return redirectorGroups(settings).flatMap((g) => g.entries).filter((r) => on.has(r.id));
  }

  function redirectorGroups(settings, enabledOnly = true) {
    const all = allRedirectors(settings).filter((r) => !enabledOnly || settings.enabledIds.includes(r.id));
    const pinned = settings.pinnedIds || [];
    return [{ id: 'pinned', label: 'Pinned', entries: pinned.map((id) => all.find((r) => r.id === id)).filter(Boolean) },
      ...XIT.GROUPS.map((g) => ({ ...g, entries: all.filter((r) => r.group === g.id && !pinned.includes(r.id)) }))]
      .filter((g) => g.entries.length);
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
    startWriter, mutate,
    editCustom, duplicateCustom, restoreCustom, getUndo, setPinned, movePinned, redirectorGroups,
    allRedirectors, enabledRedirectors, findRedirector, defaultRedirector, extraHosts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
