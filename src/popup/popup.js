/* xIT - popup. */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;

  const $ = (id) => document.getElementById(id);
  const HOST_PATTERNS = ['*://x.com/*', '*://twitter.com/*', '*://mobile.twitter.com/*'];

  let settings = null;
  let redirectStatus = null;
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

  function opts() {
    return { stripTracking: settings.stripTracking, extraHosts: XITStore.extraHosts(settings) };
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
    const ok = await writeClipboard(out.url);
    status(ok ? 'Copied ' + redirector.name + ' link' : 'Clipboard write failed', ok ? 'ok' : 'error');
  }

  function doOpen(redirector) {
    const out = XIT.convert(sourceUrl, redirector, opts());
    if (!out.ok) { status(out.reason, 'error'); return; }
    api.tabs.create({ url: out.url, index: tab ? tab.index + 1 : undefined });
    window.close();
  }

  /* ---- current tab / source ---- */

  function describe(parts) {
    if (!parts) return 'Not an X/Twitter link';
    if (parts.kind === 'status') return 'Tweet by @' + (parts.user === 'i' ? '…' : parts.user);
    if (parts.kind === 'profile') return '@' + parts.user + "'s profile";
    return 'X page: /' + parts.path;
  }

  function refreshPreview() {
    const parts = XIT.parse(sourceUrl, opts().extraHosts);
    $('current-kind').textContent = describe(parts);

    const d = XITStore.defaultRedirector(settings);
    $('default-pill').textContent = d ? d.name : '…';

    const out = parts ? XIT.convert(sourceUrl, d, opts()) : { ok: false, reason: 'Open a tweet, or paste a link below.' };
    $('preview').textContent = out.ok ? out.url : out.reason;

    const usable = !!out.ok;
    $('copy-default').disabled = !usable;
    $('open-default').disabled = !usable;
    $('copy-clean').disabled = !parts;
    $('open-original').disabled = !parts;

    renderList(parts);
  }

  function renderList(parts) {
    const list = $('list');
    const scrollTop = list.scrollTop;
    const focused = document.activeElement;
    const focusId = focused && focused.closest('[data-id]')?.dataset.id;
    const focusAction = focused && focused.dataset.action;
    list.textContent = '';

    for (const g of XITStore.redirectorGroups(settings)) {
      const inGroup = g.entries;

      const head = document.createElement('div');
      head.className = 'item-group';
      head.textContent = g.label;
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
        const out = parts ? XIT.convert(sourceUrl, r, opts()) : { ok: false, reason: '' };
        sub.textContent = out.ok ? out.url.replace(/^https:\/\//, '') : (out.reason || r.note || '');
        name.append(b, sub);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'mini';
        copyBtn.dataset.action = 'copy';
        copyBtn.textContent = 'Copy';
        copyBtn.disabled = !out.ok;
        copyBtn.addEventListener('click', () => doCopy(r));

        const openBtn = document.createElement('button');
        openBtn.className = 'mini';
        openBtn.dataset.action = 'open';
        openBtn.textContent = 'Open';
        openBtn.disabled = !out.ok;
        openBtn.addEventListener('click', () => doOpen(r));

        const defBtn = document.createElement('button');
        defBtn.className = 'mini';
        defBtn.dataset.action = 'default';
        defBtn.textContent = '★';
        defBtn.title = 'Make ' + r.name + ' the default';
        defBtn.setAttribute('aria-label', defBtn.title);
        defBtn.setAttribute('aria-pressed', String(r.id === settings.defaultRedirector));
        defBtn.addEventListener('click', async () => {
          settings = await XITStore.save({ defaultRedirector: r.id });
          status(r.name + ' is now the default');
          refreshPreview();
        });

        const pinned = settings.pinnedIds.includes(r.id);
        const pin = document.createElement('button');
        pin.className = 'mini';
        pin.dataset.action = 'pin';
        pin.textContent = pinned ? 'Unpin' : 'Pin';
        pin.setAttribute('aria-label', (pinned ? 'Unpin ' : 'Pin ') + r.name);
        pin.setAttribute('aria-pressed', String(pinned));
        pin.addEventListener('click', () => commit(XITStore.setPinned(r.id, !pinned)));
        row.append(name, copyBtn, openBtn, pin, defBtn);
        list.appendChild(row);
      }
    }
    if (focusId && focusAction) list.querySelector('[data-id="' + CSS.escape(focusId) + '"] [data-action="' + focusAction + '"]')?.focus({ preventScroll: true });
    list.scrollTop = scrollTop;
  }

  /* ---- browse redirect ---- */

  function renderBrowse() {
    const paused = XITStore.isPaused(settings);
    $('pause-browse').hidden = paused;
    $('pause-browse').disabled = !settings.browseRedirect;
    $('resume-browse').hidden = !paused;
    const sel = $('browse-target');
    sel.textContent = '';
    for (const r of XITStore.enabledRedirectors(settings)) {
      if (!XIT.supportsBrowse(r)) continue;
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name;
      sel.appendChild(o);
    }
    sel.value = settings.browseRedirectorId;
    sel.disabled = !settings.browseRedirect;
    $('t-browse').checked = settings.browseRedirect;

    const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
    const scope = settings.browseScope;
    const which = [scope.status && 'tweets', scope.profile && 'profiles', scope.other && 'everything else']
      .filter(Boolean).join(', ');
    const state = XITStore.browseStatusMessage(settings, redirectStatus);
    $('browse-note').textContent = state + (settings.browseRedirect && redirectStatus &&
      redirectStatus.state === 'active' && redirectStatus.key === XITStore.browseStatusKey(settings)
      ? ' Redirecting ' + which + ' with ' + r.name + '.' : '');
  }

  async function commit(operation) {
    try {
      settings = await operation;
      refreshPreview();
      renderBrowse();
    } catch (error) { status('Could not save: ' + error.message, 'error'); }
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
            status('Access granted. Reload your X tab.');
          } else {
            status('Access was not granted.', 'error');
          }
        });
      }
    } catch (_) {
      $('perm').hidden = true;
    }
  }

  /* ---- wiring ---- */

  async function init() {
    settings = await XITStore.load();
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
    sourceUrl = (tab && tab.url) || '';

    refreshPreview();
    renderBrowse();
    XITStore.watchStatus((next) => { redirectStatus = next; renderBrowse(); });
    XITStore.onChanged((next) => {
      settings = next;
      refreshPreview();
      renderBrowse();
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
      const clean = XIT.canonical(sourceUrl, opts());
      if (!clean) { status('Not an X/Twitter link.', 'error'); return; }
      const ok = await writeClipboard(clean);
      status(ok ? 'Copied clean x.com link' : 'Clipboard write failed', ok ? 'ok' : 'error');
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
        if (!result || !result.ok) throw new Error('Could not open that X link.');
        window.close();
      } catch (error) { status(error.message, 'error'); }
    });
    $('pause-browse').addEventListener('click', () => commit(XITStore.pause()));
    $('resume-browse').addEventListener('click', () => commit(XITStore.resume()));
    $('copy-diagnostics').addEventListener('click', async () => {
      const button = $('copy-diagnostics');
      button.disabled = true;
      try {
        const result = await api.runtime.sendMessage({ type: 'xit:diagnostics' });
        if (!result || !result.ok) throw new Error('Could not collect diagnostics. Try again.');
        const ok = await writeClipboard(JSON.stringify(result.report, null, 2));
        status(ok ? 'Diagnostics copied. No links or clipboard data included.' : 'Clipboard write failed', ok ? 'ok' : 'error');
      } catch (error) { status(error.message, 'error'); }
      finally { button.disabled = false; }
    });

    $('open-options').addEventListener('click', () => {
      if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
      else api.tabs.create({ url: api.runtime.getURL('options/options.html') });
      window.close();
    });

    const toggle = async (id, key) => {
      $(id).addEventListener('change', async (ev) => {
        settings = await XITStore.save({ [key]: ev.target.checked });
        refreshPreview();
        renderBrowse();
      });
    };
    await toggle('t-button', 'copyButton');
    await toggle('t-hijack', 'hijackNativeCopy');
    await toggle('t-strip', 'stripTracking');

    $('t-browse').addEventListener('change', async (ev) => {
      const enabled = ev.target.checked;
      if (enabled) {
        const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
        if (!(await ensureOriginPermission(r))) {
          ev.target.checked = false;
          status('Page redirecting needs access to ' + XIT.templateHost(r.template), 'error');
          return;
        }
      }
      settings = await XITStore.save({ browseRedirect: enabled });
      renderBrowse();
    });

    $('browse-target').addEventListener('change', async (ev) => {
      const id = ev.target.value;
      const r = XITStore.findRedirector(settings, id);
      if (settings.browseRedirect && !(await ensureOriginPermission(r))) {
        ev.target.value = settings.browseRedirectorId;
        status('Needs access to ' + XIT.templateHost(r.template), 'error');
        return;
      }
      settings = await XITStore.save({ browseRedirectorId: id });
      renderBrowse();
    });
  }

  init().catch((e) => status(String(e && e.message || e), 'error'));
})();
