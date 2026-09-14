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
  let editingId = null;
  const probeResults = new Map();
  let probing = false;

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
      return true;
    } catch (e) { $('saved').textContent = 'Could not save: ' + e.message; return false; }
  }

  function sampleFor(redirector) {
    const out = XIT.convert(SAMPLE, redirector, { stripTracking: settings.stripTracking });
    return out.ok ? out.url : out.reason;
  }

  /* ---- default redirector ---- */

  function renderDefault() {
    const sel = $('default-select');
    sel.textContent = '';
    for (const g of XITStore.redirectorGroups(settings)) {
      const inGroup = g.entries;
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
    const paused = XITStore.isPaused(settings);
    $('pause-browse').hidden = paused;
    $('pause-browse').disabled = !settings.browseRedirect;
    $('resume-browse').hidden = !paused;
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

  function rowButton(row, id, action, text, handler) {
    const button = document.createElement('button');
    button.className = 'row-btn';
    button.dataset.action = action;
    button.textContent = text;
    button.setAttribute('aria-label', text + ' ' + XITStore.findRedirector(settings, id).name);
    button.addEventListener('click', handler);
    row.appendChild(button);
    return button;
  }

  function renderList() {
    const host = $('redirector-list');
    const focused = document.activeElement;
    const focusRow = focused && focused.closest('[data-id]')?.dataset.id;
    const focusAction = focused && focused.dataset.action;
    host.textContent = '';
    for (const g of XITStore.redirectorGroups(settings, false)) {
      const wrap = document.createElement('div');
      wrap.className = 'rgroup';
      const head = document.createElement('div');
      head.className = 'rgroup-head';
      head.textContent = g.label;
      wrap.appendChild(head);
      if (g.blurb) {
        const blurb = document.createElement('p');
        blurb.className = 'rgroup-blurb';
        blurb.textContent = g.blurb;
        wrap.appendChild(blurb);
      }
      for (const r of g.entries) {
        const row = document.createElement('div');
        row.className = 'ritem';
        row.dataset.id = r.id;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings.enabledIds.includes(r.id);
        cb.id = 'en-' + r.id;
        cb.addEventListener('change', () => commit(XITStore.setEnabled(r.id, cb.checked)));
        const main = document.createElement('label');
        main.className = 'ritem-main';
        main.setAttribute('for', cb.id);
        const name = document.createElement('b');
        name.textContent = r.name;
        const detail = document.createElement('span');
        detail.textContent = r.note ? r.note + ' · ' + r.template : r.template;
        main.append(name, detail);
        row.append(cb, main);
        if (r.id === settings.defaultRedirector) {
          const badge = document.createElement('span');
          badge.className = 'ritem-badge badge-default';
          badge.textContent = 'default';
          row.appendChild(badge);
        }
        const actions = document.createElement('div');
        actions.className = 'ritem-tools';
        const pinned = settings.pinnedIds.includes(r.id);
        const pin = rowButton(actions, r.id, 'pin', pinned ? 'Unpin' : 'Pin', () => commit(XITStore.setPinned(r.id, !pinned)));
        pin.setAttribute('aria-pressed', String(pinned));
        if (pinned) {
          const index = settings.pinnedIds.indexOf(r.id);
          rowButton(actions, r.id, 'up', 'Move up', () => commit(XITStore.movePinned(r.id, -1))).disabled = index === 0;
          rowButton(actions, r.id, 'down', 'Move down', () => commit(XITStore.movePinned(r.id, 1))).disabled = index === settings.pinnedIds.length - 1;
        }
        const check = rowButton(actions, r.id, 'check', 'Check this host', () => probeList([r]));
        check.disabled = probing || !cb.checked || !XIT.templateOrigin(r.template);
        if (!cb.checked) check.title = 'Enable this redirector to check it.';
        const probe = document.createElement('span');
        probe.className = 'ritem-badge';
        probe.dataset.probe = r.id;
        actions.appendChild(probe);
        if (r.custom) {
          rowButton(actions, r.id, 'edit', 'Edit', () => editCustom(r));
          rowButton(actions, r.id, 'duplicate', 'Duplicate', () => commit(XITStore.duplicateCustom(r.id)));
          rowButton(actions, r.id, 'remove', 'Remove', async () => {
            if (await commit(XITStore.removeCustom(r.id))) {
              if (editingId === r.id) cancelEdit();
              await renderUndo();
              $('undo-remove').focus({ preventScroll: true });
            }
          }).classList.add('danger');
        }
        row.appendChild(actions);
        wrap.appendChild(row);
      }
      host.appendChild(wrap);
    }
    renderProbes();
    if (focusRow && focusAction) {
      const row = host.querySelector('[data-id="' + CSS.escape(focusRow) + '"]');
      let target = row && row.querySelector('[data-action="' + focusAction + '"]');
      if (target && target.disabled) target = row.querySelector('[data-action="pin"]');
      target?.focus({ preventScroll: true });
    }
  }

  function renderProbes() {
    for (const badge of document.querySelectorAll('[data-probe]')) {
      const r = XITStore.findRedirector(settings, badge.dataset.probe);
      const result = probeResults.get(badge.dataset.probe);
      if (!result || !r || result.origin !== XIT.templateOrigin(r.template)) { badge.textContent = ''; continue; }
      const minutes = Math.floor((Date.now() - result.at) / 60000);
      const age = minutes < 1 ? 'just now' : minutes === 1 ? '1 minute ago' : minutes + ' minutes ago';
      badge.textContent = result.state === 'checking' ? 'Checking…' : result.state === 'denied' ? 'Access not granted' :
        (result.state === 'ok' ? 'Responded ' : 'Did not respond ') + age;
      badge.className = 'ritem-badge ' + (result.state === 'ok' ? 'badge-ok' : result.state === 'failed' ? 'badge-bad' : 'badge-wait');
      badge.title = result.state === 'checking' ? '' : 'Checked ' + new Date(result.at).toLocaleString();
    }
  }

  async function probeOne(redirector) {
    const origin = XIT.templateOrigin(redirector.template);
    const permission = XIT.permissionOrigin(redirector.template);
    const record = (state) => { probeResults.set(redirector.id, { origin, state, at: Date.now() }); renderProbes(); };
    record('checking');
    try {
      if (!origin || !permission || !(await api.permissions.contains({ origins: [permission] }))) throw new Error('No access');
    } catch (_) { record('denied'); return; }
    const current = XITStore.findRedirector(settings, redirector.id);
    if (!settings.enabledIds.includes(redirector.id) || !current || XIT.templateOrigin(current.template) !== origin) {
      probeResults.delete(redirector.id); renderProbes(); return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      await fetch(origin + '/', { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' });
      record('ok');
    } catch (_) { record('failed'); }
    finally { clearTimeout(timer); }
  }

  async function probeList(list) {
    if (probing) return;
    probing = true;
    const origins = [...new Set(list.map((r) => XIT.permissionOrigin(r.template)).filter(Boolean))];
    // Request immediately in the click handler, before awaiting anything else.
    let permission;
    try { permission = origins.length ? Promise.resolve(api.permissions.request({ origins })).catch(() => false) : Promise.resolve(false); }
    catch (_) { permission = Promise.resolve(false); }
    $('test-all').disabled = true;
    $('test-all').textContent = 'Checking…';
    document.querySelectorAll('[data-action="check"]').forEach((button) => { button.disabled = true; });
    try {
      await permission;
      let index = 0;
      const worker = async () => {
        while (index < list.length) {
          const r = list[index++];
          if (settings.enabledIds.includes(r.id)) await probeOne(r);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
      saved('Check complete. A response does not prove the host can display tweets.');
    } finally {
      probing = false;
      $('test-all').disabled = false;
      $('test-all').textContent = 'Check which are reachable';
      renderList();
    }
  }

  function editCustom(entry) {
    editingId = entry.id;
    $('custom-heading').textContent = 'Edit custom redirector';
    $('c-name').value = entry.name;
    $('c-template').value = entry.template;
    $('custom-submit').textContent = 'Save changes';
    $('custom-cancel').hidden = false;
    renderCustomPreview();
    $('custom-form').scrollIntoView({ block: 'center' });
    $('c-name').focus({ preventScroll: true });
  }

  function cancelEdit() {
    editingId = null;
    $('custom-heading').textContent = 'Custom redirector';
    $('custom-submit').textContent = 'Add';
    $('custom-cancel').hidden = true;
    $('c-name').value = '';
    $('c-template').value = '';
    renderCustomPreview();
  }

  async function renderUndo() {
    const removed = await XITStore.getUndo();
    $('undo-custom').hidden = !removed;
    $('undo-text').textContent = removed ? 'Removed ' + removed.entry.name + '.' : '';
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
    await renderUndo();
    api.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.removedCustom) renderUndo(); });
    setInterval(renderProbes, 30000);
    $('pause-browse').addEventListener('click', () => commit(XITStore.pause()));
    $('resume-browse').addEventListener('click', () => commit(XITStore.resume()));
    $('undo-remove').addEventListener('click', async () => { await commit(XITStore.restoreCustom()); await renderUndo(); });
    $('custom-cancel').addEventListener('click', cancelEdit);

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

    $('custom-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = editingId;
      const name = $('c-name').value.trim();
      const template = $('c-template').value.trim();
      const v = XIT.validateTemplate(template);
      if (!name) { $('custom-error').textContent = 'Give it a name.'; return; }
      if (!v.ok) { $('custom-error').textContent = v.error; return; }
      const entry = { name, template };
      if (settings.browseRedirect && id === settings.browseRedirectorId && !(await ensureOriginPermission(entry))) {
        $('custom-error').textContent = 'Allow access to the new destination before saving an active page redirect.';
        return;
      }
      if (id !== editingId) return;
      if (await commit(id ? XITStore.editCustom(id, entry) : XITStore.addCustom(entry))) cancelEdit();
    });

    $('test-all').addEventListener('click', () => probeList(XITStore.enabledRedirectors(settings)));
    $('copy-diagnostics').addEventListener('click', async () => {
      const button = $('copy-diagnostics');
      button.disabled = true;
      try {
        const result = await api.runtime.sendMessage({ type: 'xit:diagnostics' });
        if (!result || !result.ok) throw new Error('Could not collect diagnostics. Try again.');
        const text = JSON.stringify(result.report, null, 2);
        $('diagnostics-preview').textContent = text;
        $('diagnostics-preview').hidden = false;
        try { await navigator.clipboard.writeText(text); saved('Diagnostics copied.'); }
        catch (_) { saved('Select and copy the diagnostics shown below.'); }
      } catch (error) { $('saved').textContent = error.message; }
      finally { button.disabled = false; }
    });
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
