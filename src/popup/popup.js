/* xIT - popup. */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;

  const $ = (id) => document.getElementById(id);
  // B4: this used to list three of the six origins the manifest declares, so
  // the gate below could pass while diagnostics reported access as incomplete.
  const HOST_PATTERNS = XIT.HOST_PATTERNS;

  let settings = null;
  let tab = null;
  let sourceUrl = '';        // what we convert: the tab URL, or whatever is pasted
  let statusTimer = 0;

  function status(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.setAttribute('data-kind', kind || 'ok');
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => { el.textContent = ''; }, 2600);
  }

  /*
   * The hosts here are gathered by walking every configured redirector, so
   * building this per row per keystroke was most of O2 on its own. Settings
   * are replaced wholesale on every change (load and normalize each build a
   * fresh object), so their identity says when this is stale: the same object
   * cannot describe different hosts. Nothing may write to what comes back.
   */
  let optsFor = null;
  let optsCache = null;

  function opts() {
    if (optsFor !== settings) {
      optsCache = { stripTracking: settings.stripTracking, extraHosts: XITStore.extraHosts(settings) };
      optsFor = settings;
    }
    return optsCache;
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_e) {
        return false;
      }
    }
  }

  async function doCopy(redirector) {
    const out = XIT.convert(sourceUrl, redirector, opts());
    if (!out.ok) { status(out.reason, 'error'); return; }
    const ok = await writeClipboard(XIT.formatCopy(out.url, out.parts, settings.copyFormat));
    status(ok ? XITI18N.t('popupCopied', [redirector.name]) : XITI18N.t('popupCopyFailed'), ok ? 'ok' : 'error');
  }

  function doOpen(redirector) {
    const out = XIT.convert(sourceUrl, redirector, opts());
    if (!out.ok) { status(out.reason, 'error'); return; }
    api.tabs.create({ url: out.url, index: tab ? tab.index + 1 : undefined });
    window.close();
  }

  /* ---- current tab / source ---- */

  function describe(parts) {
    if (!parts) return XITI18N.t('popupNotATweet');
    // B6: the sentinel check that used to be here is XIT.handleOf now, so the
    // popup and the copy formats cannot disagree about what counts as an
    // account again.
    const handle = XIT.handleOf(parts);
    if (parts.kind === 'status') return XITI18N.t(handle ? 'popupTweetBy' : 'popupTweetNoAuthor', [handle]);
    if (parts.kind === 'profile') return XITI18N.t('popupProfileOf', [parts.user]);
    return 'X page: /' + parts.path;
  }

  function refreshPreview() {
    const parts = XIT.parse(sourceUrl, opts().extraHosts);
    $('current-kind').textContent = describe(parts);

    const d = XITStore.defaultRedirector(settings);
    $('default-pill').textContent = d ? d.name : '…';

    const out = parts ? XIT.convert(sourceUrl, d, opts()) : { ok: false, reason: XITI18N.t('popupNoSource') };
    $('preview').textContent = out.ok ? out.url : out.reason;

    const usable = !!out.ok;
    $('copy-default').disabled = !usable;
    $('open-default').disabled = !usable;
    $('copy-clean').disabled = !parts;
    $('open-original').disabled = !parts;

    renderList(parts);
  }

  /*
   * O2: this list is shaped by the settings and written by the source. A
   * keystroke in the paste field changes only the source, so rebuilding every
   * row, its five buttons and their listeners per keystroke redid work that
   * could not have changed, and ran convert once per row to throw the rows
   * away. The rows are built once per settings object and only the two things
   * a new source can alter, the sub line and what is still clickable, are
   * written again. Settings identity is the test for the same reason opts()
   * uses it: a settings change always brings a fresh object, and nothing else
   * can change the shape of this list.
   */
  let rowsFor = null;
  let rows = [];

  function buildRows() {
    const list = $('list');
    const scrollTop = list.scrollTop;
    const focused = document.activeElement;
    const focusId = focused && focused.closest('[data-id]')?.dataset.id;
    const focusAction = focused && focused.dataset.action;
    list.textContent = '';
    rows = [];

    for (const g of XITStore.redirectorGroups(settings)) {
      const inGroup = g.entries;

      const head = document.createElement('div');
      head.className = 'item-group';
      head.textContent = XITI18N.of('group', g.id, g.label);
      list.appendChild(head);

      for (const r of inGroup) {
        const row = document.createElement('div');
        row.className = 'item';
        row.dataset.id = r.id;
        if (r.id === settings.defaultRedirector) row.setAttribute('data-default', '1');

        const name = document.createElement('div');
        name.className = 'item-name';
        const b = document.createElement('b');
        b.textContent = r.name;
        const sub = document.createElement('span');
        name.append(b, sub);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'mini';
        copyBtn.dataset.action = 'copy';
        copyBtn.textContent = XITI18N.t('actionCopy');
        copyBtn.addEventListener('click', () => doCopy(r));

        const openBtn = document.createElement('button');
        openBtn.className = 'mini';
        openBtn.dataset.action = 'open';
        openBtn.textContent = XITI18N.t('actionOpen');
        openBtn.addEventListener('click', () => doOpen(r));

        const defBtn = document.createElement('button');
        defBtn.className = 'mini';
        defBtn.dataset.action = 'default';
        defBtn.textContent = '★';
        defBtn.title = XITI18N.t('popupMakeDefault', [r.name]);
        defBtn.setAttribute('aria-label', defBtn.title);
        defBtn.setAttribute('aria-pressed', String(r.id === settings.defaultRedirector));
        defBtn.addEventListener('click', async () => {
          settings = await XITStore.save({ defaultRedirector: r.id });
          status(XITI18N.t('popupNowDefault', [r.name]));
          refreshPreview();
        });

        const pinned = settings.pinnedIds.includes(r.id);
        const pin = document.createElement('button');
        pin.className = 'mini';
        pin.dataset.action = 'pin';
        pin.textContent = XITI18N.t(pinned ? 'rowUnpin' : 'rowPin');
        pin.setAttribute('aria-label', XITI18N.t(pinned ? 'popupUnpinNamed' : 'popupPinNamed', [r.name]));
        pin.setAttribute('aria-pressed', String(pinned));
        pin.addEventListener('click', () => commit(XITStore.setPinned(r.id, !pinned)));
        row.append(name, copyBtn, openBtn, pin, defBtn);
        list.appendChild(row);
        rows.push({ redirector: r, sub, copyBtn, openBtn });
      }
    }
    if (focusId && focusAction) list.querySelector('[data-id="' + CSS.escape(focusId) + '"] [data-action="' + focusAction + '"]')?.focus({ preventScroll: true });
    list.scrollTop = scrollTop;
  }

  /** Write the part of each row that the source decides, and nothing else. */
  function updateRows(parts) {
    const o = opts();
    for (const row of rows) {
      const r = row.redirector;
      const out = parts ? XIT.convert(sourceUrl, r, o) : { ok: false, reason: '' };
      row.sub.textContent = out.ok ? out.url.replace(/^https:\/\//, '')
        : (out.reason || (r.note ? XITI18N.of('note', r.id, r.note) : ''));
      row.copyBtn.disabled = !out.ok;
      row.openBtn.disabled = !out.ok;
    }
  }

  function renderList(parts) {
    if (rowsFor !== settings) {
      buildRows();
      rowsFor = settings;
    }
    updateRows(parts);
  }

  async function commit(operation) {
    try {
      settings = await operation;
      refreshPreview();
    } catch (error) { status(XITI18N.t('errSave', [error.message]), 'error'); }
  }

  /* ---- host permission gate (mostly Firefox) ---- */

  async function checkHostPermission() {
    try {
      const ok = await api.permissions.contains({ origins: HOST_PATTERNS });
      $('perm').hidden = ok;
      if (!ok) {
        $('perm-grant').addEventListener('click', async () => {
          const granted = await api.permissions.request({ origins: HOST_PATTERNS });
          if (granted) {
            $('perm').hidden = true;
            status(XITI18N.t('popupAccessGranted'));
          } else {
            status(XITI18N.t('popupAccessDenied'), 'error');
          }
        });
      }
    } catch (_) {
      $('perm').hidden = true;
    }
  }

  /* ---- wiring ---- */

  async function init() {
    XITI18N.apply();
    settings = await XITStore.load();
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
    sourceUrl = (tab && tab.url) || '';

    refreshPreview();
    XITStore.onChanged((next) => {
      settings = next;
      refreshPreview();
      $('t-button').checked = settings.copyButton;
      $('t-hijack').checked = settings.hijackNativeCopy;
      $('t-strip').checked = settings.stripTracking;
    });
    await checkHostPermission();

    $('t-button').checked = settings.copyButton;
    $('t-hijack').checked = settings.hijackNativeCopy;
    $('t-strip').checked = settings.stripTracking;

    $('copy-default').addEventListener('click', () => doCopy(XITStore.defaultRedirector(settings)));
    $('open-default').addEventListener('click', () => doOpen(XITStore.defaultRedirector(settings)));
    $('copy-clean').addEventListener('click', async () => {
      const clean = XIT.cleanCopy(sourceUrl, opts(), settings.copyFormat);
      if (!clean) { status(XITI18N.t('popupNotATweetFull'), 'error'); return; }
      const ok = await writeClipboard(clean);
      status(ok ? XITI18N.t('popupCopiedClean') : XITI18N.t('popupCopyFailed'), ok ? 'ok' : 'error');
    });

    $('manual').addEventListener('input', (ev) => {
      const v = ev.target.value.trim();
      sourceUrl = v || (tab && tab.url) || '';
      refreshPreview();
    });
    $('manual').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        doCopy(XITStore.defaultRedirector(settings));
      }
    });
    if (!XIT.parse(sourceUrl, opts().extraHosts)) $('manual').focus();
    $('open-original').addEventListener('click', async () => {
      try {
        const result = await api.runtime.sendMessage({ type: 'xit:open-original', url: sourceUrl });
        if (!result || !result.ok) throw new Error(XITI18N.t('popupOpenFailed'));
        window.close();
      } catch (error) { status(error.message, 'error'); }
    });
    $('copy-diagnostics').addEventListener('click', async () => {
      const button = $('copy-diagnostics');
      button.disabled = true;
      try {
        const result = await api.runtime.sendMessage({ type: 'xit:diagnostics' });
        if (!result || !result.ok) throw new Error(XITI18N.t('diagFailed'));
        const ok = await writeClipboard(JSON.stringify(result.report, null, 2));
        status(ok ? XITI18N.t('popupDiagCopied') : XITI18N.t('popupCopyFailed'), ok ? 'ok' : 'error');
      } catch (error) { status(error.message, 'error'); }
      finally { button.disabled = false; }
    });

    $('open-options').addEventListener('click', () => {
      if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
      else api.tabs.create({ url: api.runtime.getURL('options/options.html') });
      window.close();
    });

    const toggle = (id, key) => {
      $(id).addEventListener('change', async (ev) => {
        settings = await XITStore.save({ [key]: ev.target.checked });
        refreshPreview();
      });
    };
    toggle('t-button', 'copyButton');
    toggle('t-hijack', 'hijackNativeCopy');
    toggle('t-strip', 'stripTracking');
  }

  init().catch((e) => status(String(e && e.message || e), 'error'));
})();
