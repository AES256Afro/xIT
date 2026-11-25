/*
 * xIT - Settings: the first-run redirector picker.
 *
 * One of the classic scripts options.html loads in order. They share the
 * page's top-level names, as the sections of one file would: page.js holds
 * the state and helpers the others use, and options.js starts the page.
 */
'use strict';

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

    // Say which bundled service an alias really is, so a new user can tell
    // that three of the embed fixers are one service under three names.
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
    pin.textContent = XITI18N.t(pinned ? 'rowUnpin' : 'rowPin');
    pin.setAttribute('aria-label', XITI18N.t(pinned ? 'popupUnpinNamed' : 'popupPinNamed', [r.name]));
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
  // The picker lists only what xIT bundles or catalogues. Anything else the
  // user enabled is their own redirector, which this dialog never showed,
  // so it has no say over it: those stay exactly as they were.
  const offered = new Set(order);
  const enabledIds = order.filter((id) => pick.enabled.has(id))
    .concat(settings.enabledIds.filter((id) => !offered.has(id)));
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
