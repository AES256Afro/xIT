/* xIT - options page. */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;
  const $ = (id) => document.getElementById(id);

  const SAMPLE = 'https://x.com/jack/status/20?s=20&t=xyz';
  let settings = null;
  let savedTimer = 0;

  function saved(text) {
    $('saved').textContent = text || 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1800);
  }

  async function commit(patch) {
    settings = await XITStore.save(patch);
    saved();
    render();
  }

  function sampleFor(redirector) {
    const out = XIT.convert(SAMPLE, redirector, { stripTracking: settings.stripTracking });
    return out.ok ? out.url : out.reason;
  }

  /* ---- default redirector ---- */

  function renderDefault() {
    const sel = $('default-select');
    sel.textContent = '';
    for (const g of XIT.GROUPS) {
      const inGroup = XITStore.enabledRedirectors(settings).filter((r) => r.group === g.id);
      if (!inGroup.length) continue;
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const r of inGroup) {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.value = settings.defaultRedirector;

    const d = XITStore.defaultRedirector(settings);
    const prev = $('default-preview');
    prev.textContent = '';
    const b = document.createElement('b');
    b.textContent = sampleFor(d);
    prev.append(document.createTextNode('x.com/jack/status/20 becomes '), b);
  }

  /* ---- browse redirect ---- */

  function renderBrowse() {
    $('t-browse').checked = settings.browseRedirect;
    const sel = $('browse-select');
    sel.textContent = '';
    for (const r of XITStore.enabledRedirectors(settings)) {
      if (!XIT.supportsBrowse(r)) continue;
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name;
      sel.appendChild(o);
    }
    // Keep the stored choice visible even if it is not browse-capable.
    if (!sel.querySelector('option[value="' + CSS.escape(settings.browseRedirectorId) + '"]')) {
      const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
      if (r) {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.name + ' (not usable for page loads)';
        sel.appendChild(o);
      }
    }
    sel.value = settings.browseRedirectorId;

    $('s-status').checked = !!settings.browseScope.status;
    $('s-profile').checked = !!settings.browseScope.profile;
    $('s-other').checked = !!settings.browseScope.other;

    for (const el of [sel, $('s-status'), $('s-profile'), $('s-other')]) el.disabled = !settings.browseRedirect;

    const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
    const msgs = [];
    if (settings.browseRedirect) {
      if (!r || !XIT.supportsBrowse(r)) {
        msgs.push('“' + ((r && r.name) || 'none') + '” cannot be expressed as a redirect rule. Pick another, or turn this off.');
      } else if (!settings.browseScope.status && !settings.browseScope.profile && !settings.browseScope.other) {
        msgs.push('No page types selected, so nothing is being redirected.');
      }
    }
    $('browse-warn').textContent = msgs.join(' ');
  }

  /* ---- redirector list ---- */

  function renderList() {
    const host = $('redirector-list');
    host.textContent = '';
    const all = XITStore.allRedirectors(settings);

    for (const g of XIT.GROUPS) {
      const inGroup = all.filter((r) => r.group === g.id);
      if (!inGroup.length) continue;

      const wrap = document.createElement('div');
      wrap.className = 'rgroup';
      const head = document.createElement('div');
      head.className = 'rgroup-head';
      head.textContent = g.label;
      const blurb = document.createElement('p');
      blurb.className = 'rgroup-blurb';
      blurb.textContent = g.blurb;
      wrap.append(head, blurb);

      for (const r of inGroup) {
        const row = document.createElement('div');
        row.className = 'ritem';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings.enabledIds.includes(r.id);
        cb.id = 'en-' + r.id;
        cb.addEventListener('change', () => {
          const set = new Set(settings.enabledIds);
          if (cb.checked) set.add(r.id); else set.delete(r.id);
          commit({ enabledIds: Array.from(set) });
        });

        const main = document.createElement('label');
        main.className = 'ritem-main';
        main.setAttribute('for', cb.id);
        const b = document.createElement('b');
        b.textContent = r.name;
        const span = document.createElement('span');
        span.textContent = r.note ? r.note + ' · ' + r.template : r.template;
        main.append(b, span);

        row.append(cb, main);

        if (r.id === settings.defaultRedirector) {
          const badge = document.createElement('span');
          badge.className = 'ritem-badge badge-default';
          badge.textContent = 'default';
          row.appendChild(badge);
        }

        const probe = document.createElement('span');
        probe.className = 'ritem-badge';
        probe.dataset.probe = r.id;
        row.appendChild(probe);

        if (r.custom) {
          const del = document.createElement('button');
          del.className = 'row-btn';
          del.textContent = 'Remove';
          del.addEventListener('click', () => {
            commit({ custom: settings.custom.filter((c) => c.id !== r.id) });
          });
          row.appendChild(del);
        }

        wrap.appendChild(row);
      }
      host.appendChild(wrap);
    }
  }

  /* ---- reachability probe ---- */

  async function probeOne(redirector, badge) {
    const host = XIT.templateHost(redirector.template);
    if (!host) return;
    badge.className = 'ritem-badge badge-wait';
    badge.textContent = 'checking';

    const origins = ['*://' + host + '/*'];
    try {
      const has = await api.permissions.contains({ origins });
      if (!has && !(await api.permissions.request({ origins }))) {
        badge.className = 'ritem-badge badge-wait';
        badge.textContent = 'no access';
        return;
      }
    } catch (_) { /* try the fetch anyway */ }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      await fetch('https://' + host + '/', { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
      badge.className = 'ritem-badge badge-ok';
      badge.textContent = 'responds';
    } catch (_) {
      badge.className = 'ritem-badge badge-bad';
      badge.textContent = 'no response';
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeAll() {
    const badges = Array.from(document.querySelectorAll('[data-probe]'));
    for (const badge of badges) {
      const r = XITStore.findRedirector(settings, badge.dataset.probe);
      if (r) await probeOne(r, badge);
    }
    saved('Reachability checked. This only says the host answered, not that it works.');
  }

  /* ---- custom redirectors ---- */

  function slugify(name) {
    const base = 'c-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
    let id = base;
    let n = 2;
    const taken = new Set(XITStore.allRedirectors(settings).map((r) => r.id));
    while (taken.has(id)) id = base + '-' + n++;
    return id;
  }

  function renderCustomPreview() {
    const tpl = $('c-template').value.trim();
    const box = $('custom-preview');
    if (!tpl) { box.textContent = ''; $('custom-error').textContent = ''; return; }
    const v = XIT.validateTemplate(tpl);
    if (!v.ok) { box.textContent = ''; $('custom-error').textContent = v.error; return; }
    $('custom-error').textContent = '';
    const out = XIT.convert(SAMPLE, { name: 'Custom', template: tpl }, { stripTracking: settings.stripTracking });
    box.textContent = '';
    const b = document.createElement('b');
    b.textContent = out.ok ? out.url : out.reason;
    box.append(document.createTextNode('x.com/jack/status/20 becomes '), b);
  }

  /* ---- import / export ---- */

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xit-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    saved('Exported');
  }

  async function importSettings(file) {
    try {
      const raw = JSON.parse(await file.text());
      settings = await XITStore.save(raw);
      render();
      saved('Imported');
    } catch (e) {
      $('saved').textContent = '';
      alert('That file could not be read as settings: ' + (e && e.message));
    }
  }

  /* ---- render + wire ---- */

  function render() {
    renderDefault();
    renderBrowse();
    renderList();
    $('t-button').checked = settings.copyButton;
    $('t-hijack').checked = settings.hijackNativeCopy;
    $('t-strip').checked = settings.stripTracking;
    $('t-toast').checked = settings.toast;
    $('t-menu').checked = settings.contextMenu;
    renderCustomPreview();
  }

  async function ensureOriginPermission(redirector) {
    const host = XIT.templateHost(redirector && redirector.template);
    if (!host) return true;
    const origins = ['*://' + host + '/*'];
    try {
      if (await api.permissions.contains({ origins })) return true;
      return await api.permissions.request({ origins });
    } catch (_) {
      return true;
    }
  }

  async function init() {
    settings = await XITStore.load();
    render();

    $('default-select').addEventListener('change', (ev) => commit({ defaultRedirector: ev.target.value }));

    for (const [id, key] of [['t-button', 'copyButton'], ['t-hijack', 'hijackNativeCopy'],
      ['t-strip', 'stripTracking'], ['t-toast', 'toast'], ['t-menu', 'contextMenu']]) {
      $(id).addEventListener('change', (ev) => commit({ [key]: ev.target.checked }));
    }

    $('t-browse').addEventListener('change', async (ev) => {
      if (ev.target.checked) {
        const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
        if (!(await ensureOriginPermission(r))) {
          ev.target.checked = false;
          $('browse-warn').textContent = 'Redirecting page loads needs access to ' + XIT.templateHost(r.template) + '.';
          return;
        }
      }
      commit({ browseRedirect: ev.target.checked });
    });

    $('browse-select').addEventListener('change', async (ev) => {
      const r = XITStore.findRedirector(settings, ev.target.value);
      if (settings.browseRedirect && !(await ensureOriginPermission(r))) {
        ev.target.value = settings.browseRedirectorId;
        $('browse-warn').textContent = 'Needs access to ' + XIT.templateHost(r.template) + '.';
        return;
      }
      commit({ browseRedirectorId: ev.target.value });
    });

    for (const [id, key] of [['s-status', 'status'], ['s-profile', 'profile'], ['s-other', 'other']]) {
      $(id).addEventListener('change', (ev) => {
        commit({ browseScope: Object.assign({}, settings.browseScope, { [key]: ev.target.checked }) });
      });
    }

    $('c-template').addEventListener('input', renderCustomPreview);

    $('custom-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = $('c-name').value.trim();
      const template = $('c-template').value.trim();
      const v = XIT.validateTemplate(template);
      if (!name) { $('custom-error').textContent = 'Give it a name.'; return; }
      if (!v.ok) { $('custom-error').textContent = v.error; return; }
      const entry = { id: slugify(name), name, template, group: 'custom' };
      commit({ custom: settings.custom.concat([entry]) });
      $('c-name').value = '';
      $('c-template').value = '';
      $('custom-preview').textContent = '';
    });

    $('test-all').addEventListener('click', () => probeAll());
    $('export').addEventListener('click', exportSettings);
    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) importSettings(f);
      ev.target.value = '';
    });
    $('reset').addEventListener('click', async () => {
      if (!confirm('Reset every setting back to defaults?')) return;
      await api.storage.local.remove('settings');
      settings = await XITStore.load();
      await XITStore.save({});
      render();
      saved('Reset');
    });

    if (navigator.userAgent.includes('Firefox')) $('kbd').textContent = 'Alt+Shift+C';
  }

  init().catch((e) => { $('saved').textContent = 'Error: ' + (e && e.message); });
})();
