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
    // Right-click menu shows the default and the pinned entries only. The
    // full list ran to roughly 25 items in one menu (U3).
    contextMenuAll: false,
    // The first-run picker has been through once. Set by the picker itself,
    // not by install, so somebody who never opens it still gets it.
    pickerDone: false,
    // How a copied link is written out: one of XIT.COPY_FORMATS (Q4).
    copyFormat: 'url',
    // How unpinned entries are ordered in every list (U7). 'group' keeps the
    // order they are defined in; 'name' sorts alphabetically. Pinned entries
    // always keep the order you put them in, which is the point of pinning.
    listSort: 'group',
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

  /**
   * What a template cannot do without.
   *
   * {path} already carries the account and the status id for any link that
   * has them, so a template using it needs nothing in particular. A template
   * that names {id} or {user} on their own does: without this, convert()
   * expands the missing piece to an empty string and copies a link pointing
   * at the host root.
   *
   * B7: only {id} was inferred, so convert()'s requires-'user' branch was
   * unreachable and a template of https://host/{user} silently produced
   * https://host/ for a search page and https://host/ for an authorless
   * tweet.
   */
  function inferRequires(template) {
    const t = String(template || '');
    if (/\{path\}/.test(t)) return [];
    const needs = [];
    if (/\{id\}/.test(t)) needs.push('id');
    if (/\{user\}/.test(t)) needs.push('user');
    return needs;
  }

  // The shape a stored redirector id may have. normalize drops anything else,
  // so every route that invents or accepts an id has to agree with this: B9
  // was the merge accepting an id normalize would then throw away.
  const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

  function normalize(raw) {
    const s = clone(DEFAULTS);
    for (const key of Object.keys(DEFAULTS)) {
      if (raw && Object.prototype.hasOwnProperty.call(raw, key)) s[key] = raw[key];
    }
    s.schemaVersion = SCHEMA_VERSION;

    // A redirector the user took from the catalogue lives in `custom` like any
    // other choice they made. Settings written before 1.1.0 enabled five
    // redirectors that are now catalogue entries, so anything still referring
    // to one is adopted here rather than dropped: an upgrader who made FixupX
    // their default keeps it.
    const customIn = Array.isArray(s.custom) ? s.custom.slice() : [];
    const held = new Set(customIn.map((c) => c && String(c.id || '')));
    const referenced = [].concat(
      Array.isArray(s.enabledIds) ? s.enabledIds : [],
      Array.isArray(s.pinnedIds) ? s.pinnedIds : [],
      [s.defaultRedirector],
    );
    for (const ref of referenced) {
      const entry = XIT.findCatalogue(ref);
      if (entry && !held.has(entry.id)) {
        held.add(entry.id);
        customIn.push({ id: entry.id, template: entry.template });
      }
    }

    // Drop custom entries that no longer validate, and de-duplicate ids.
    const seen = new Set(XIT.PRESETS.map((p) => p.id));
    s.custom = customIn.filter((c) => {
      if (!c || typeof c.template !== 'string') return false;
      if (!XIT.validateTemplate(c.template).ok) return false;
      const id = String(c.id || '');
      if (!ID_RE.test(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((c) => {
      const entry = XIT.findCatalogue(c.id);
      // A catalogue entry keeps its own definition, so a template corrected in
      // a later release reaches people who already took it. Only what the user
      // typed themselves is stored verbatim.
      if (entry) {
        return { id: entry.id, name: entry.name, group: entry.group, template: entry.template,
          requires: (entry.requires || []).slice(), note: entry.note || '',
          sameAs: entry.sameAs || '', catalogue: true };
      }
      return {
        id: String(c.id),
        name: String(c.name || c.id),
        group: 'custom',
        template: String(c.template).trim(),
        requires: inferRequires(c.template),
        note: c.note ? String(c.note) : '',
        custom: true,
      };
    });

    const known = new Set(XIT.PRESETS.map((p) => p.id).concat(s.custom.map((c) => c.id)));
    s.enabledIds = [...new Set((Array.isArray(s.enabledIds) ? s.enabledIds : []).filter((id) => known.has(id)))];
    s.pinnedIds = [...new Set((Array.isArray(s.pinnedIds) ? s.pinnedIds : []).filter((id) => known.has(id)))];

    if (!known.has(s.defaultRedirector) || !s.enabledIds.includes(s.defaultRedirector)) {
      s.defaultRedirector = s.enabledIds.includes('fxtwitter') ? 'fxtwitter' : (s.enabledIds[0] || DEFAULTS.defaultRedirector);
    }

    for (const k of ['copyButton', 'hijackNativeCopy', 'toast', 'stripTracking', 'contextMenu',
      'contextMenuAll', 'pickerDone']) {
      s[k] = !!s[k];
    }
    // An unknown format would otherwise reach every copy path and be passed
    // through as a bare URL, which works but silently ignores the setting.
    if (!XIT.COPY_FORMATS.some((f) => f.id === s.copyFormat)) s.copyFormat = DEFAULTS.copyFormat;
    if (s.listSort !== 'name' && s.listSort !== 'group') s.listSort = DEFAULTS.listSort;
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

  /** A custom id derived from a name, stepped until it is free. */
  function freshId(name, taken) {
    const base = 'c-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
    let id = base === 'c-' ? 'c-redirector' : base;
    const start = id;
    for (let n = 2; taken.has(id); n++) id = start + '-' + n;
    return id;
  }

  async function applyMutation(operation) {
    const current = await load();
    let raw = current;
    let undo = null;
    if (!operation || typeof operation !== 'object') throw new Error(XITI18N.t('errBadOperation'));
    if (operation.type === 'patch') {
      const patch = operation.patch || {};
      raw = { ...current, ...patch };
    } else if (operation.type === 'replace') {
      if (!operation.settings || typeof operation.settings !== 'object' || Array.isArray(operation.settings)) throw new Error(XITI18N.t('errNotJsonObject'));
      raw = operation.settings;
    } else if (operation.type === 'merge') {
      // Q2: import used to replace the whole object, so taking one redirector
      // from somebody meant adopting their default, pins and toggles too. A
      // merge brings across their redirectors and nothing else: which of them
      // you pin, star or turn off stays your decision.
      const incoming = operation.settings;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error(XITI18N.t('errNotJsonObject'));
      const theirs = Array.isArray(incoming.custom) ? incoming.custom : [];
      const taken = new Set(allRedirectors(current).map((r) => r.id));
      // B8: every redirector already available, bundled ones included. Keyed
      // on current.custom alone this added a second FxTwitter whenever their
      // file happened to carry it as an entry of their own.
      const held = new Set(allRedirectors(current).map((r) => r.template));
      const added = [];
      for (const entry of theirs) {
        if (!entry || typeof entry !== 'object') continue;
        const template = entry.template;
        if (!XIT.validateTemplate(template).ok) continue;
        // The same redirector under a different name is still the same
        // redirector, so this is keyed on the template, not the id.
        if (held.has(template)) continue;
        // A catalogue entry they had taken keeps our definition and our id,
        // exactly as enabling it here would. Anything else is their own.
        const catalogue = XIT.findCatalogue(entry.id);
        const name = String(entry.name || (catalogue && catalogue.name) || '').trim();
        if (!name) continue;
        let id = catalogue ? catalogue.id : String(entry.id || '');
        // B9: a taken id was replaced and an invalid one was not, so an entry
        // whose id merely had a space in it was added here and then dropped by
        // normalize. The template was fine and the redirector was usable; only
        // the name it arrived under was not.
        if (!id || taken.has(id) || !ID_RE.test(id)) id = freshId(name, taken);
        taken.add(id);
        held.add(template);
        added.push(catalogue ? { id, template } : { id, name, template });
      }
      raw = { ...current, custom: [...current.custom, ...added],
        enabledIds: [...current.enabledIds, ...added.map((c) => c.id)] };
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
      if (!entry) throw new Error(XITI18N.t('errNoSuchCustom'));
      raw = { ...current, custom: current.custom.filter((c) => c.id !== operation.id) };
      undo = { entry, enabled: current.enabledIds.includes(entry.id), pinIndex: current.pinnedIds.indexOf(entry.id),
        defaultBefore: current.defaultRedirector };
    } else if (operation.type === 'restore-custom') {
      const removed = await getUndo();
      if (!removed) throw new Error(XITI18N.t('errNothingToRestore'));
      if (allRedirectors(current).some((r) => r.id === removed.entry.id)) throw new Error(XITI18N.t('errIdTaken'));
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
      if (operation.type !== 'add-custom' && !original) throw new Error(XITI18N.t('errNoSuchCustom'));
      const entry = operation.type === 'duplicate-custom' ? { ...original, name: original.name + ' copy' } : operation.entry || {};
      const name = String(entry.name || '').trim();
      const validation = XIT.validateTemplate(entry.template);
      if (!name || !validation.ok) throw new Error(validation.error || XITI18N.t('errNeedName'));
      if (operation.type === 'edit-custom') {
        raw = { ...current, custom: current.custom.map((c) => c.id === original.id ? { ...c, name, template: entry.template } : c) };
      } else {
        const taken = new Set(allRedirectors(current).map((r) => r.id));
        const id = freshId(name, taken);
        raw = { ...current, custom: [...current.custom, { id, name, template: entry.template }], enabledIds: [...current.enabledIds, id] };
      }
    } else {
      throw new Error(XITI18N.t('errUnknownOperation'));
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
        if (!result || !result.ok) throw new Error((result && result.error) || XITI18N.t('errSaveFailed'));
        return normalize(result.settings);
      });
    }
    const pending = writeChain.then(() => applyMutation(operation));
    writeChain = pending.catch(() => {});
    return pending;
  }

  const save = (patch) => mutate({ type: 'patch', patch });
  const replace = (settings) => mutate({ type: 'replace', settings });
  const merge = (settings) => mutate({ type: 'merge', settings });
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

  /**
   * What the right-click menu should list. Everything the user enabled was
   * roughly 25 items in a single menu (U3), so unless they ask for the full
   * list it is the default plus whatever they pinned.
   */
  function menuRedirectors(settings) {
    const enabled = enabledRedirectors(settings);
    if (settings && settings.contextMenuAll) return enabled;
    const wanted = [settings.defaultRedirector].concat(settings.pinnedIds || []);
    const out = [];
    for (const id of wanted) {
      const entry = enabled.find((r) => r.id === id);
      if (entry && !out.includes(entry)) out.push(entry);
    }
    return out;
  }

  /**
   * A fingerprint of everything the right-click menu is built from, so a
   * settings write that cannot change the menu does not rebuild it (O4).
   */
  function menuSignature(settings) {
    if (!settings || !settings.contextMenu) return 'off';
    return JSON.stringify([settings.contextMenuAll, defaultRedirector(settings).name,
      menuRedirectors(settings).map((r) => [r.id, r.name, (r.requires || []).join('+')])]);
  }

  /**
   * O3: this runs on every render in four places, and used to do a linear
   * `find` over every redirector for each pinned id, plus a linear `includes`
   * over the pinned list for every redirector. Both are indexed once per call
   * instead. A cache across calls was the other option and is not worth it:
   * it would have to be invalidated on every settings write, and the work
   * here is now proportional to the list rather than to its square.
   */
  function redirectorGroups(settings, enabledOnly = true) {
    const on = new Set(settings.enabledIds || []);
    const all = allRedirectors(settings).filter((r) => !enabledOnly || on.has(r.id));
    const byId = new Map(all.map((r) => [r.id, r]));
    const pinned = settings.pinnedIds || [];
    const isPinned = new Set(pinned);
    // U7: pinning says "these first, in this order", so only the rest sorts.
    const order = settings && settings.listSort === 'name'
      ? (entries) => entries.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
      : (entries) => entries;
    return [{ id: 'pinned', label: 'Pinned', entries: pinned.map((id) => byId.get(id)).filter(Boolean) },
      ...XIT.GROUPS.map((g) => ({ ...g, entries: order(all.filter((r) => r.group === g.id && !isPinned.has(r.id))) }))]
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
    load, save, replace, merge, reset, setEnabled, addCustom, removeCustom, normalize, onChanged,
    startWriter, mutate,
    editCustom, duplicateCustom, restoreCustom, getUndo, setPinned, movePinned, redirectorGroups,
    menuRedirectors, menuSignature,
    allRedirectors, enabledRedirectors, findRedirector, defaultRedirector, extraHosts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
