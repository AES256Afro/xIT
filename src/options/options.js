/* xIT - options page. */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;
  const $ = (id) => document.getElementById(id);

  const SAMPLE = 'https://x.com/jack/status/20?s=20&t=xyz';
  let settings = null;
  let redirectStatus = null;
  let savedTimer = 0;

  function saved(text) {
    $('saved').textContent = text || 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1800);
  }

  async function commit(patch) {
    try {
      settings = await (patch && typeof patch.then === 'function' ? patch : XITStore.save(patch));
      saved();
      render();
    } catch (e) { $('saved').textContent = 'Could not save: ' + e.message; }
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
    const state = XITStore.browseStatusMessage(settings, redirectStatus);
    $('browse-warn').dataset.state = msgs.length || (redirectStatus &&
      redirectStatus.key === XITStore.browseStatusKey(settings) && redirectStatus.state === 'error') ? 'error' : 'normal';
    if (state) msgs.push(state);
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
          commit(XITStore.setEnabled(r.id, cb.checked));
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
            commit(XITStore.removeCustom(r.id));
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
    const origin = XIT.templateOrigin(redirector.template);
    const permission = XIT.permissionOrigin(redirector.template);
    badge.className = 'ritem-badge badge-wait';
    badge.textContent = 'checking';

    try {
      if (!origin || !permission || !(await api.permissions.contains({ origins: [permission] }))) throw new Error('No access');
    } catch (_) {
      badge.textContent = 'no access';
      return;
    }
    if (!settings.enabledIds.includes(redirector.id)) { badge.textContent = ''; return; }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      await fetch(origin + '/', { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' });
      badge.className = 'ritem-badge badge-ok';
      badge.textContent = 'responds';
    } catch (_) {
      badge.className = 'ritem-badge badge-bad';
      badge.textContent = 'no response';
    } finally {
      clearTimeout(timer);
    }
  }

  let probing = false;
  async function probeAll() {
    if (probing) return;
    probing = true;
    const button = $('test-all');
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Checking…';
    const list = XITStore.enabledRedirectors(settings);
    const origins = [...new Set(list.map((r) => XIT.permissionOrigin(r.template)).filter(Boolean))];
    try {
      // Request once while handling the click. Awaiting a network operation
      // before requesting access loses the user gesture in some browsers.
      if (origins.length) {
        try { await api.permissions.request({ origins }); } catch (_) { /* each job checks its own access */ }
      }
      let index = 0;
      const worker = async () => {
        while (index < list.length) {
          const r = list[index++];
          const badge = [...document.querySelectorAll('[data-probe]')].find((b) => b.dataset.probe === r.id);
          if (badge && settings.enabledIds.includes(r.id)) await probeOne(r, badge);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
      saved('Reachability checked. This only says the host answered, not that it works.');
    } finally {
      probing = false;
      button.disabled = false;
      button.textContent = label;
    }
  }

  /* ---- custom redirectors ---- */

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
      settings = await XITStore.replace(raw);
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
    const origin = XIT.permissionOrigin(redirector && redirector.template);
    if (!origin) return false;
    const origins = [origin];
    try {
      return await api.permissions.request({ origins });
    } catch (_) {
      return false;
    }
  }

  async function init() {
    settings = await XITStore.load();
    render();
    XITStore.onChanged((next) => { settings = next; render(); });
    XITStore.watchStatus((next) => { redirectStatus = next; renderBrowse(); });

    $('default-select').addEventListener('change', (ev) => commit({ defaultRedirector: ev.target.value }));

    for (const [id, key] of [['t-button', 'copyButton'], ['t-hijack', 'hijackNativeCopy'],
      ['t-strip', 'stripTracking'], ['t-toast', 'toast'], ['t-menu', 'contextMenu']]) {
      $(id).addEventListener('change', (ev) => commit({ [key]: ev.target.checked }));
    }

    $('t-browse').addEventListener('change', async (ev) => {
      const enabled = ev.target.checked;
      if (enabled) {
        const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
        if (!(await ensureOriginPermission(r))) {
          ev.target.checked = false;
          $('browse-warn').textContent = 'Redirecting page loads needs access to ' + XIT.templateHost(r.template) + '.';
          $('browse-warn').dataset.state = 'error';
          return;
        }
      }
      commit({ browseRedirect: enabled });
    });

    $('browse-select').addEventListener('change', async (ev) => {
      const id = ev.target.value;
      const r = XITStore.findRedirector(settings, id);
      if (settings.browseRedirect && !(await ensureOriginPermission(r))) {
        ev.target.value = settings.browseRedirectorId;
        $('browse-warn').textContent = 'Needs access to ' + XIT.templateHost(r.template) + '.';
        $('browse-warn').dataset.state = 'error';
        return;
      }
      commit({ browseRedirectorId: id });
    });

    for (const [id, key] of [['s-status', 'status'], ['s-profile', 'profile'], ['s-other', 'other']]) {
      $(id).addEventListener('change', (ev) => {
        commit({ browseScope: { [key]: ev.target.checked } });
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
      commit(XITStore.addCustom({ name, template }));
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
      settings = await XITStore.reset();
      render();
      saved('Reset');
    });

    if (navigator.userAgent.includes('Firefox')) $('kbd').textContent = 'Alt+Shift+C';
  }

  init().catch((e) => { $('saved').textContent = 'Error: ' + (e && e.message); });
})();
