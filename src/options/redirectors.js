/*
 * xIT - Settings: the default, the redirector list, reachability checks and custom entries.
 *
 * One of the classic scripts options.html loads in order. They share the
 * page's top-level names, as the sections of one file would: page.js holds
 * the state and helpers the others use, and options.js starts the page.
 */
'use strict';

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
  sampleSentence($('default-preview'), sampleFor(d));
}

/* ---- reachability check ---- */

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
  badge.title = XITI18N.t('checkedAtNote', [new Date(result.at).toLocaleString()]);
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
  /*
   * The guard at the top of this function is only a guard if the flag is
   * set before the first await. The permission request is the longest wait
   * here, because the browser's own prompt sits in front of the page, and a
   * second click during it must not start a second check.
   *
   * Setting it here also disables the buttons for the length of the prompt,
   * which is the honest state: a check has begun. Everything between the
   * click and the request below is synchronous, so the request is still
   * made within the user's gesture, which is what the permission API wants.
   */
  checking = true;
  render();
  try {
    let granted = false;
    try { granted = await api.permissions.request({ origins }); } catch (_) { granted = false; }
    // Returning from inside the try still runs the finally, so the flag is
    // cleared and the buttons come back whichever way this ends.
    if (!granted) { $('saved').textContent = XITI18N.t('checkNoAccess'); return; }

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
  button.setAttribute('aria-label', XITI18N.t('rowActionNamed', [text, XITStore.findRedirector(settings, id).name]));
  button.addEventListener('click', handler);
  row.appendChild(button);
  return button;
}

/*
 * The filter is view state, not a setting: it is a way of finding a row, so it
 * would be wrong to still be in force the next time Settings is opened.
 * The ordering is a setting, because it applies to every list.
 */
let listFilter = '';

/** Everything about an entry the filter looks at: name, host, template, note. */
function haystack(entry) {
  return [entry.name, entry.template, entry.note, XIT.templateHost(entry.template)]
    .filter(Boolean).join(' ').toLowerCase();
}

/** Does that haystack match what was typed? */
function matchesFilter(hay) {
  if (!listFilter) return true;
  return listFilter.split(/\s+/).every((word) => hay.includes(word));
}

/*
 * The filter decides which rows are shown. It says nothing about what a row
 * contains, so it is applied to rows that already exist rather than used to
 * skip building them, and a keystroke recreates nothing. Each row carries its own haystack,
 * so this needs no second pass over the settings. One function does the
 * whole job, called at the end of a render and on its own from the
 * keystroke, so a filtered view and a freshly rendered one cannot drift.
 */
function applyFilter() {
  const host = $('redirector-list');
  let shown = 0;
  for (const row of host.querySelectorAll('.ritem')) {
    const hit = matchesFilter(row.dataset.filter);
    row.hidden = !hit;
    if (hit) shown += 1;
  }
  // A group whose rows were all filtered out would otherwise leave its
  // heading and blurb standing over nothing.
  for (const group of host.querySelectorAll('.rgroup')) {
    group.hidden = !group.querySelector('.ritem:not([hidden])');
  }
  $('list-empty').textContent = shown ? '' : XITI18N.t('listNoMatch', [listFilter]);
  $('list-empty').hidden = !!shown;
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
    head.textContent = XITI18N.of('group', g.id, g.label);
    wrap.appendChild(head);
    if (g.blurb) {
      const blurb = document.createElement('p');
      blurb.className = 'rgroup-blurb';
      blurb.textContent = XITI18N.of('blurb', g.id, g.blurb);
      wrap.appendChild(blurb);
    }
    for (const r of g.entries) {
      const row = document.createElement('div');
      row.className = 'ritem';
      row.dataset.id = r.id;
      row.dataset.filter = haystack(r);
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
        badge.textContent = XITI18N.t('badgeDefault');
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
    // A group with no entries at all would leave its heading standing over
    // nothing. Which of its rows the filter shows is applyFilter's business.
    if (wrap.querySelector('.ritem')) host.appendChild(wrap);
  }
  applyFilter();
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
  sampleSentence(box, out.ok ? out.url : out.reason);
}
