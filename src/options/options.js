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
  let editingId = null;

  function saved(text) {
    $('saved').textContent = text || XITI18N.t('saved');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1800);
  }

  async function commit(patch) {
    try {
      settings = await (patch && typeof patch.then === 'function' ? patch : XITStore.save(patch));
      saved();
      render();
      return true;
    } catch (e) { $('saved').textContent = XITI18N.t('errSave', [e.message]); return false; }
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
      og.label = XITI18N.of('group', g.id, g.label);
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

  /* ---- reachability check (P4, Q5) ---- */

  // Observations, not settings: they live in storage.local under their own
  // key, so they are not exported with the user's choices.
  let checks = {};
  let checking = false;

  const CHECK_LABEL = {
    ok: XITI18N.t('checkOk'),
    failing: XITI18N.t('checkFailing'),
    refused: XITI18N.t('checkRefused'),
    silent: XITI18N.t('checkSilent'),
    denied: XITI18N.t('checkDenied'),
    unknown: XITI18N.t('checkUnknown'),
  };

  function checkBadge(row, r) {
    const result = checks[r.id];
    const checkable = !!XIT.checkOrigin(r.template);
    if (!result && checkable) return;
    const badge = document.createElement('span');
    badge.className = 'ritem-badge badge-check';
    if (!checkable) {
      badge.dataset.state = 'unknown';
      badge.textContent = CHECK_LABEL.unknown;
      // A permission can only be asked for an origin the manifest declared,
      // and a wildcard covering anything the user might type would be a much
      // bigger ask than this feature is worth.
      badge.title = XITI18N.t('checkUnknownWhy');
      row.appendChild(badge);
      return;
    }
    badge.dataset.state = result.state;
    badge.textContent = CHECK_LABEL[result.state] || result.state;
    if (result.status) badge.textContent += ' (' + result.status + ')';
    badge.title = XITI18N.t('checkedAt', [new Date(result.at).toLocaleString()])
      + '. A response does not prove the host can still display tweets.';
    row.appendChild(badge);
  }

  async function runCheck(ids) {
    if (checking || !ids.length) return;
    const all = XITStore.allRedirectors(settings);
    const origins = [...new Set(ids
      .map((id) => all.find((r) => r.id === id))
      .map((r) => r && XIT.checkOrigin(r.template))
      .filter(Boolean))].map((origin) => origin + '*');
    if (!origins.length) {
      saved(XITI18N.t('checkNoneCheckable'));
      return;
    }
    // Asked for first, while the click is still the user's gesture, and only
    // for the hosts this check is about.
    let granted = false;
    try { granted = await api.permissions.request({ origins }); } catch (_) { granted = false; }
    if (!granted) { $('saved').textContent = XITI18N.t('checkNoAccess'); return; }

    checking = true;
    render();
    try {
      const result = await api.runtime.sendMessage({ type: 'xit:check-hosts', ids });
      if (!result || !result.ok) throw new Error((result && result.error) || XITI18N.t('checkFailed'));
      checks = { ...checks, ...result.results };
      saved(XITI18N.t('checkDone'));
    } catch (error) {
      $('saved').textContent = error.message;
    } finally {
      checking = false;
      render();
    }
  }

  async function loadChecks() {
    try {
      const got = await api.storage.local.get('hostChecks');
      checks = (got && got.hostChecks) || {};
    } catch (_) { checks = {}; }
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

  /*
   * U7: the list had no filter and no ordering for anything unpinned. The
   * filter is view state, not a setting: it is a way of finding a row, so it
   * would be wrong to still be in force the next time Settings is opened.
   * The ordering is a setting, because it applies to every list.
   */
  let listFilter = '';

  /** Does this entry match what was typed? Name, host, template and note. */
  function matchesFilter(entry) {
    if (!listFilter) return true;
    const haystack = [entry.name, entry.template, entry.note, XIT.templateHost(entry.template)]
      .filter(Boolean).join(' ').toLowerCase();
    return listFilter.split(/\s+/).every((word) => haystack.includes(word));
  }

  function renderList() {
    const host = $('redirector-list');
    const focused = document.activeElement;
    const focusRow = focused && focused.closest('[data-id]')?.dataset.id;
    const focusAction = focused && focused.dataset.action;
    host.textContent = '';
    let shown = 0;
    for (const g of XITStore.redirectorGroups(settings, false)) {
      const wrap = document.createElement('div');
      wrap.className = 'rgroup';
      const head = document.createElement('div');
      head.className = 'rgroup-head';
      head.textContent = XITI18N.of('group', g.id, g.label);
      wrap.appendChild(head);
      if (g.blurb) {
        const blurb = document.createElement('p');
        blurb.className = 'rgroup-blurb';
        blurb.textContent = g.blurb;
        wrap.appendChild(blurb);
      }
      for (const r of g.entries) {
        if (!matchesFilter(r)) continue;
        shown += 1;
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
        const note = r.note ? XITI18N.of('note', r.id, r.note) : '';
        detail.textContent = note ? note + ' · ' + r.template : r.template;
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
        const pin = rowButton(actions, r.id, 'pin', XITI18N.t(pinned ? 'rowUnpin' : 'rowPin'), () => commit(XITStore.setPinned(r.id, !pinned)));
        pin.setAttribute('aria-pressed', String(pinned));
        if (pinned) {
          const index = settings.pinnedIds.indexOf(r.id);
          rowButton(actions, r.id, 'up', XITI18N.t('rowMoveUp'), () => commit(XITStore.movePinned(r.id, -1))).disabled = index === 0;
          rowButton(actions, r.id, 'down', XITI18N.t('rowMoveDown'), () => commit(XITStore.movePinned(r.id, 1))).disabled = index === settings.pinnedIds.length - 1;
        }
        // A catalogue entry lives in `custom` but its definition is ours, so it
        // can be dropped but not edited: editing the template would silently
        // make it something other than the redirector it claims to be.
        if (r.custom) {
          rowButton(actions, r.id, 'edit', XITI18N.t('rowEdit'), () => editCustom(r));
          rowButton(actions, r.id, 'duplicate', XITI18N.t('rowDuplicate'), () => commit(XITStore.duplicateCustom(r.id)));
        }
        const canCheck = !!XIT.checkOrigin(r.template);
        if (canCheck) {
          const button = rowButton(actions, r.id, 'check', XITI18N.t('rowCheck'), () => runCheck([r.id]));
          button.disabled = checking;
        }
        if (r.custom || r.catalogue) {
          rowButton(actions, r.id, 'remove', XITI18N.t('rowRemove'), async () => {
            if (await commit(XITStore.removeCustom(r.id))) {
              if (editingId === r.id) cancelEdit();
              await renderUndo();
              $('undo-remove').focus({ preventScroll: true });
            }
          }).classList.add('danger');
        }
        checkBadge(row, r);
        row.appendChild(actions);
        wrap.appendChild(row);
      }
      // A group whose rows were all filtered out would otherwise leave its
      // heading and blurb standing over nothing.
      if (wrap.querySelector('.ritem')) host.appendChild(wrap);
    }
    $('list-empty').textContent = shown ? '' : XITI18N.t('listNoMatch', [listFilter]);
    $('list-empty').hidden = !!shown;
    $('list-sort').value = settings.listSort;
    if (focusRow && focusAction) {
      const row = host.querySelector('[data-id="' + CSS.escape(focusRow) + '"]');
      let target = row && row.querySelector('[data-action="' + focusAction + '"]');
      if (target && target.disabled) target = row.querySelector('[data-action="pin"]');
      target?.focus({ preventScroll: true });
    }
  }

  function editCustom(entry) {
    editingId = entry.id;
    $('custom-heading').textContent = XITI18N.t('panelCustomEdit');
    $('c-name').value = entry.name;
    $('c-template').value = entry.template;
    $('custom-submit').textContent = XITI18N.t('customSubmitSave');
    $('custom-cancel').hidden = false;
    renderCustomPreview();
    $('custom-form').scrollIntoView({ block: 'center' });
    $('c-name').focus({ preventScroll: true });
  }

  function cancelEdit() {
    editingId = null;
    $('custom-heading').textContent = XITI18N.t('panelCustom');
    $('custom-submit').textContent = XITI18N.t('customSubmitAdd');
    $('custom-cancel').hidden = true;
    $('c-name').value = '';
    $('c-template').value = '';
    renderCustomPreview();
  }

  async function renderUndo() {
    const removed = await XITStore.getUndo();
    $('undo-custom').hidden = !removed;
    $('undo-text').textContent = removed ? XITI18N.t('undoRemoved', [removed.entry.name]) : '';
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

  /* ---- first-run picker ---- *
   * Opens itself once, then only when asked for. It is the one place a
   * catalogue entry is taken, which is why it has to be re-openable: a
   * one-shot would hide five redirectors behind an install moment.
   */

  // What the picker currently has ticked and pinned, which is not the saved
  // settings until the user presses Save.
  let pick = null;

  function pickerEntries() {
    return XIT.PRESETS.map((r) => ({ ...r, bundled: true }))
      .concat(XIT.CATALOGUE.map((r) => ({ ...r, bundled: false })));
  }

  function renderPicker() {
    const host = $('picker-list');
    host.textContent = '';
    for (const r of pickerEntries()) {
      const row = document.createElement('div');
      row.className = 'ritem';
      row.dataset.id = r.id;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'pick-' + r.id;
      cb.checked = pick.enabled.has(r.id);
      cb.addEventListener('change', () => {
        if (cb.checked) pick.enabled.add(r.id);
        else { pick.enabled.delete(r.id); pick.pinned.delete(r.id); }
        renderPicker();
      });

      const main = document.createElement('label');
      main.className = 'ritem-main';
      main.setAttribute('for', cb.id);
      const name = document.createElement('b');
      name.textContent = r.name;
      const note = document.createElement('span');
      note.textContent = r.note ? XITI18N.of('note', r.id, r.note) : r.template;
      main.append(name, note);
      row.append(cb, main);

      // U6: aliases were presented as peers, so a new user could not tell
      // that three of the five embed fixers were one service.
      if (r.sameAs) {
        const alias = document.createElement('span');
        alias.className = 'pick-alias';
        const of = XIT.PRESETS.find((p) => p.id === r.sameAs);
        alias.textContent = XITI18N.t('sameServiceAs', [of ? of.name : r.sameAs]);
        row.appendChild(alias);
      }

      const tools = document.createElement('div');
      tools.className = 'ritem-tools';
      const pinned = pick.pinned.has(r.id);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'row-btn';
      pin.textContent = pinned ? 'Unpin' : 'Pin';
      pin.setAttribute('aria-label', (pinned ? 'Unpin ' : 'Pin ') + r.name);
      pin.setAttribute('aria-pressed', String(pinned));
      pin.disabled = !pick.enabled.has(r.id);
      pin.addEventListener('click', () => {
        if (pinned) pick.pinned.delete(r.id);
        else pick.pinned.add(r.id);
        renderPicker();
      });
      tools.appendChild(pin);
      row.appendChild(tools);
      host.appendChild(row);
    }
  }

  function openPicker() {
    pick = {
      enabled: new Set(settings.enabledIds),
      pinned: new Set(settings.pinnedIds),
    };
    $('p-name').value = '';
    $('p-template').value = '';
    $('picker-error').textContent = '';
    renderPicker();
    $('picker').showModal();
  }

  async function savePicker() {
    const name = $('p-name').value.trim();
    const template = $('p-template').value.trim();
    if (name || template) {
      const v = XIT.validateTemplate(template);
      if (!name) { $('picker-error').textContent = XITI18N.t('pickerNeedName'); return; }
      if (!v.ok) { $('picker-error').textContent = v.error; return; }
    }
    // Keep the order the entries are offered in, so the lists stay stable.
    const order = pickerEntries().map((r) => r.id);
    const enabledIds = order.filter((id) => pick.enabled.has(id));
    const pinnedIds = settings.pinnedIds.filter((id) => pick.pinned.has(id))
      .concat(order.filter((id) => pick.pinned.has(id) && !settings.pinnedIds.includes(id)));
    if (!enabledIds.length && !template) {
      $('picker-error').textContent = XITI18N.t('pickerNeedOne');
      return;
    }
    const defaultRedirector = enabledIds.includes(settings.defaultRedirector)
      ? settings.defaultRedirector : (enabledIds[0] || settings.defaultRedirector);
    // Enabling a catalogue ID is what adopts it, so this one write covers the
    // ticks, the pins and the default together.
    if (!await commit({ enabledIds, pinnedIds, defaultRedirector, pickerDone: true })) return;
    if (template && !await commit(XITStore.addCustom({ name, template }))) return;
    $('picker').close();
    saved(XITI18N.t('savedChoices'));
  }

  /* ---- import / export ---- */

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xit-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    saved(XITI18N.t('savedExported'));
  }

  /**
   * U5: an import failure used to come through alert(), which blocks the page
   * and cannot be styled or read back. This stays on screen until the next
   * attempt, because the user may need to go and look at the file, and
   * role="alert" means a screen reader announces it without being moved.
   */
  function backupError(text) {
    const node = $('backup-error');
    node.textContent = text || '';
    node.hidden = !text;
  }

  /**
   * Q2: import replaced the whole settings object, so taking one redirector
   * from somebody meant adopting their default, pins and switches with it.
   * The file is read first and the choice offered second, because what the
   * file actually contains is what makes the choice meaningful.
   */
  let pendingImport = null;

  async function importSettings(file) {
    backupError('');
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (e) {
      $('saved').textContent = '';
      backupError(XITI18N.t('importUnreadable', [String((e && e.message) || e)]));
      return;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      backupError(XITI18N.t('importNotObject'));
      return;
    }
    const theirs = Array.isArray(raw.custom) ? raw.custom : [];
    const usable = theirs.filter((c) => c && XIT.validateTemplate(c.template).ok);
    // B8: every redirector already available, bundled ones included, and not
    // just the user's own. The merge itself skips a template it already has;
    // counting only `custom` here would offer an Add that adds nothing and
    // then report "Nothing to add."
    const mine = new Set(XITStore.allRedirectors(settings).map((r) => r.template));
    const fresh = usable.filter((c) => !mine.has(c.template));
    pendingImport = raw;
    $('import-summary').textContent = fresh.length
      ? XITI18N.t(fresh.length === 1 ? 'importSummaryOne' : 'importSummaryMany', [String(fresh.length), String(usable.length)])
      : usable.length
        ? XITI18N.t('importNothingNew')
        : XITI18N.t('importNoneAtAll');
    $('import-merge').disabled = !fresh.length;
    $('import-replace').disabled = false;
    $('confirm-import').showModal();
  }

  async function applyImport(mode) {
    const raw = pendingImport;
    pendingImport = null;
    $('confirm-import').close();
    if (!raw) return;
    const before = new Set(settings.custom.map((c) => c.id));
    try {
      settings = await (mode === 'merge' ? XITStore.merge(raw) : XITStore.replace(raw));
      render();
      if (mode !== 'merge') { saved(XITI18N.t('savedImported')); return; }
      const gained = settings.custom.filter((c) => !before.has(c.id)).length;
      // The browser's message format has no plural rules, so the choice of
      // message is made here and a translator gets one message per form.
      saved(gained
        ? XITI18N.t(gained === 1 ? 'importAddedOne' : 'importAddedMany', [String(gained)])
        : XITI18N.t('importNothingToAdd'));
    } catch (e) {
      $('saved').textContent = '';
      backupError(XITI18N.t('importUnreadable', [String((e && e.message) || e)]));
    }
  }

  /* ---- render + wire ---- */

  function renderCopyFormat() {
    const select = $('copy-format');
    if (!select.options.length) {
      for (const f of XIT.COPY_FORMATS) {
        const option = document.createElement('option');
        option.value = f.id;
        option.textContent = XITI18N.of('copyFormat', f.id, f.name);
        select.appendChild(option);
      }
    }
    select.value = settings.copyFormat;
    const chosen = XIT.COPY_FORMATS.find((f) => f.id === settings.copyFormat);
    $('copy-format-sample').textContent = chosen ? chosen.hint : '';
  }

  function render() {
    renderDefault();
    renderList();
    renderCopyFormat();
    $('t-button').checked = settings.copyButton;
    $('t-hijack').checked = settings.hijackNativeCopy;
    $('t-strip').checked = settings.stripTracking;
    $('t-toast').checked = settings.toast;
    $('t-menu').checked = settings.contextMenu;
    $('t-menu-all').checked = settings.contextMenuAll;
    $('t-menu-all').disabled = !settings.contextMenu;
    $('check-hosts').disabled = checking;
    $('check-hosts').textContent = XITI18N.t(checking ? 'checkInProgress' : 'checkHostsButton');
    renderCustomPreview();
  }

  async function init() {
    // C10: before anything is drawn, so a localised string never appears as a
    // flash of English. The markup carries the English as its fallback.
    XITI18N.apply();
    settings = await XITStore.load();
    await loadChecks();
    render();
    XITStore.onChanged((next) => { settings = next; render(); });
    await renderUndo();
    api.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.removedCustom) renderUndo(); });
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.hostChecks) return;
      checks = changes.hostChecks.newValue || {};
      renderList();
    });
    $('undo-remove').addEventListener('click', async () => { await commit(XITStore.restoreCustom()); await renderUndo(); });
    $('custom-cancel').addEventListener('click', cancelEdit);

    $('default-select').addEventListener('change', (ev) => commit({ defaultRedirector: ev.target.value }));

    for (const [id, key] of [['t-button', 'copyButton'], ['t-hijack', 'hijackNativeCopy'],
      ['t-strip', 'stripTracking'], ['t-toast', 'toast'], ['t-menu', 'contextMenu'],
      ['t-menu-all', 'contextMenuAll']]) {
      $(id).addEventListener('change', (ev) => commit({ [key]: ev.target.checked }));
    }

    $('c-template').addEventListener('input', renderCustomPreview);

    $('custom-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = editingId;
      const name = $('c-name').value.trim();
      const template = $('c-template').value.trim();
      const v = XIT.validateTemplate(template);
      if (!name) { $('custom-error').textContent = XITI18N.t('customNeedName'); return; }
      if (!v.ok) { $('custom-error').textContent = v.error; return; }
      const entry = { name, template };
      if (await commit(id ? XITStore.editCustom(id, entry) : XITStore.addCustom(entry))) cancelEdit();
    });

    $('copy-diagnostics').addEventListener('click', async () => {
      const button = $('copy-diagnostics');
      button.disabled = true;
      try {
        const result = await api.runtime.sendMessage({ type: 'xit:diagnostics' });
        if (!result || !result.ok) throw new Error(XITI18N.t('diagFailed'));
        const text = JSON.stringify(result.report, null, 2);
        $('diagnostics-preview').textContent = text;
        $('diagnostics-preview').hidden = false;
        try { await navigator.clipboard.writeText(text); saved(XITI18N.t('diagCopied')); }
        catch (_) { saved(XITI18N.t('diagSelectManually')); }
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
    // U5: confirm() blocked the page and said only "Reset every setting back
    // to defaults?". The dialog spells out what is actually lost, and
    // showModal() gives the focus trap and Escape for free. Escape and the
    // backdrop both mean no, because the only button that resets is reset-go.
    $('reset').addEventListener('click', () => {
      backupError('');
      $('confirm-reset').showModal();
    });
    $('import-merge').addEventListener('click', () => applyImport('merge'));
    $('import-replace').addEventListener('click', () => applyImport('replace'));
    $('import-cancel').addEventListener('click', () => $('confirm-import').close());
    // Escape and the backdrop reach this too, so a dismissed question never
    // leaves a parsed file sitting in memory waiting to be applied.
    $('confirm-import').addEventListener('close', () => { pendingImport = null; });
    $('reset-cancel').addEventListener('click', () => $('confirm-reset').close());
    $('reset-go').addEventListener('click', async () => {
      $('confirm-reset').close();
      settings = await XITStore.reset();
      render();
      saved(XITI18N.t('savedReset'));
    });

    $('check-hosts').addEventListener('click', () => runCheck(
      XITStore.enabledRedirectors(settings).map((r) => r.id)));
    $('open-picker').addEventListener('click', openPicker);
    $('picker-save').addEventListener('click', savePicker);
    $('picker-skip').addEventListener('click', () => $('picker').close());
    // Enter in the template field saves rather than dismissing the dialog,
    // which is what method="dialog" would otherwise do with the form.
    $('picker-form').addEventListener('submit', (ev) => { ev.preventDefault(); savePicker(); });
    // Covers Skip, Escape and the backdrop alike: having been asked once is
    // what counts, so it does not reappear on every visit to Settings.
    $('picker').addEventListener('close', () => {
      if (!settings.pickerDone) commit({ pickerDone: true });
    });
    $('p-template').addEventListener('input', () => { $('picker-error').textContent = ''; });

    // U8: the address had to be retyped by hand. An extension cannot open
    // either of these pages itself, which is why this is a copy button and
    // not a link.
    const firefox = navigator.userAgent.includes('Firefox');
    if (firefox) {
      $('kbd').textContent = 'Alt+Shift+C';
      $('shortcut-url').textContent = 'about:addons';
      $('shortcut-note').textContent = XITI18N.t('shortcutNoteFirefox');
    }
    $('copy-format').addEventListener('change', (ev) => commit({ copyFormat: ev.target.value }));
    $('list-filter').addEventListener('input', (ev) => {
      listFilter = ev.target.value.trim().toLowerCase();
      renderList();
    });
    $('list-sort').addEventListener('change', (ev) => commit({ listSort: ev.target.value }));
    $('copy-shortcut-url').addEventListener('click', async (ev) => {
      const address = $('shortcut-url').textContent;
      try {
        await navigator.clipboard.writeText(address);
        saved(XITI18N.t('addressCopied'));
      } catch (_) {
        // A clipboard write can be refused. Select it so the user can copy by
        // hand rather than being told it worked when it did not.
        const range = document.createRange();
        range.selectNodeContents($('shortcut-url'));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        saved(XITI18N.t('addressCopyFailed'));
      }
      ev.currentTarget.blur();
    });

    // First run. Opened from here rather than on install, so somebody who
    // never opens Settings is not handed a dialog out of nowhere, and anybody
    // upgrading with choices already made is left alone.
    if (!settings.pickerDone) openPicker();
  }

  init().catch((e) => { $('saved').textContent = XITI18N.t('errGeneric', [String((e && e.message) || e)]); });
})();
