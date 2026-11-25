/*
 * xIT - Settings: keyboard shortcuts, the copy format, rendering and startup.
 *
 * One of the classic scripts options.html loads in order. They share the
 * page's top-level names, as the sections of one file would: page.js holds
 * the state and helpers the others use, and options.js starts the page.
 */
'use strict';

/*
 * What the browser actually has bound. A suggested key that clashes is
 * dropped at install without a word, and the user can bind or unbind either
 * command, so neither can be written into the page. Without the commands API
 * the markup's own text stands.
 */
async function renderShortcuts() {
  let commands;
  try {
    if (!api.commands || !api.commands.getAll) return;
    commands = await api.commands.getAll();
  } catch (_) { return; }
  for (const [id, name] of [['kbd', 'copy-current-tweet'], ['kbd-open', 'open-current-tweet']]) {
    const command = (commands || []).find((c) => c.name === name);
    $(id).textContent = command && command.shortcut ? command.shortcut : XITI18N.t('shortcutNotSet');
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
  // Before anything is drawn, so a localised string never appears as a
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
      saved(XITI18N.t(await XITClipboard.write(text) ? 'diagCopied' : 'diagSelectManually'));
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
  // A dialog rather than confirm(), so it can spell out what is actually
  // lost; showModal() gives the focus trap and Escape for free. Escape and the
  // backdrop both mean no, because the only button that resets is reset-go.
  $('reset').addEventListener('click', () => {
    backupError('');
    // Filled from DEFAULTS each time the dialog opens, rather than written
    // into the sentence.
    $('reset-defaults').textContent = resetDefaults();
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
    // Through commit(), which says what went wrong if the write fails.
    if (await commit(XITStore.reset())) saved(XITI18N.t('savedReset'));
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

  // An extension cannot open either browser's shortcuts page itself, which
  // is why this is a copy button and not a link.
  const firefox = navigator.userAgent.includes('Firefox');
  await renderShortcuts();
  // Bindings are changed on the browser's own page, in another tab, so
  // coming back to this one is when they may have moved.
  window.addEventListener('focus', () => { renderShortcuts(); });
  if (firefox) {
    $('shortcut-url').textContent = 'about:addons';
    $('shortcut-note').textContent = XITI18N.t('shortcutNoteFirefox');
  }
  $('copy-format').addEventListener('change', (ev) => commit({ copyFormat: ev.target.value }));
  $('list-filter').addEventListener('input', (ev) => {
    listFilter = ev.target.value.trim().toLowerCase();
    applyFilter();
  });
  $('list-sort').addEventListener('change', (ev) => commit({ listSort: ev.target.value }));
  $('copy-shortcut-url').addEventListener('click', async (ev) => {
    // Taken before the first await: a browser clears currentTarget once
    // dispatch is over.
    const button = ev.currentTarget;
    const address = $('shortcut-url').textContent;
    if (await XITClipboard.write(address)) {
      saved(XITI18N.t('addressCopied'));
    } else {
      // A clipboard write can be refused. Select it so the user can copy by
      // hand rather than being told it worked when it did not.
      const range = document.createRange();
      range.selectNodeContents($('shortcut-url'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      saved(XITI18N.t('addressCopyFailed'));
    }
    button.blur();
  });

  // First run. Opened from here rather than on install, so somebody who
  // never opens Settings is not handed a dialog out of nowhere, and anybody
  // upgrading with choices already made is left alone.
  if (!settings.pickerDone) openPicker();
}

init().catch((e) => { $('saved').textContent = XITI18N.t('errGeneric', [String((e && e.message) || e)]); });
