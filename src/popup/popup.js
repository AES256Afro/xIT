/* xIT - popup. */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;

  const $ = (id) => document.getElementById(id);
  const HOST_PATTERNS = ['*://x.com/*', '*://twitter.com/*', '*://mobile.twitter.com/*'];

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

    renderList(parts);
  }

  function renderList(parts) {
    const list = $('list');
    list.textContent = '';
    const enabled = XITStore.enabledRedirectors(settings);

    for (const g of XIT.GROUPS) {
      const inGroup = enabled.filter((r) => r.group === g.id);
      if (!inGroup.length) continue;

      const head = document.createElement('div');
      head.className = 'item-group';
      head.textContent = g.label;
      list.appendChild(head);

      for (const r of inGroup) {
        const row = document.createElement('div');
        row.className = 'item';
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
        copyBtn.textContent = 'Copy';
        copyBtn.disabled = !out.ok;
        copyBtn.addEventListener('click', () => doCopy(r));

        const openBtn = document.createElement('button');
        openBtn.className = 'mini';
        openBtn.textContent = 'Open';
        openBtn.disabled = !out.ok;
        openBtn.addEventListener('click', () => doOpen(r));

        const defBtn = document.createElement('button');
        defBtn.className = 'mini';
        defBtn.textContent = '★';
        defBtn.title = 'Make ' + r.name + ' the default';
        defBtn.setAttribute('aria-label', defBtn.title);
        defBtn.addEventListener('click', async () => {
          settings = await XITStore.save({ defaultRedirector: r.id });
          api.runtime.sendMessage({ type: 'xit:settings-changed' }).catch(() => {});
          status(r.name + ' is now the default');
          refreshPreview();
        });

        row.append(name, copyBtn, openBtn, defBtn);
        list.appendChild(row);
      }
    }
  }

  /* ---- browse redirect ---- */

  function renderBrowse() {
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
    $('browse-note').textContent = !settings.browseRedirect
      ? ''
      : (r && XIT.supportsBrowse(r) ? 'Redirecting ' + (which || 'nothing - pick a scope in Settings') : 'That redirector cannot be used for page loads.');
  }

  async function ensureOriginPermission(redirector) {
    const host = XIT.templateHost(redirector && redirector.template);
    if (!host) return true;
    const origins = ['*://' + host + '/*'];
    try {
      if (await api.permissions.contains({ origins })) return true;
      return await api.permissions.request({ origins });
    } catch (_) {
      return true; // Older builds: let the DNR call decide.
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

    $('open-options').addEventListener('click', () => {
      if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
      else api.tabs.create({ url: api.runtime.getURL('options/options.html') });
      window.close();
    });

    const toggle = async (id, key) => {
      $(id).addEventListener('change', async (ev) => {
        settings = await XITStore.save({ [key]: ev.target.checked });
        api.runtime.sendMessage({ type: 'xit:settings-changed' }).catch(() => {});
        refreshPreview();
        renderBrowse();
      });
    };
    await toggle('t-button', 'copyButton');
    await toggle('t-hijack', 'hijackNativeCopy');
    await toggle('t-strip', 'stripTracking');

    $('t-browse').addEventListener('change', async (ev) => {
      if (ev.target.checked) {
        const r = XITStore.findRedirector(settings, settings.browseRedirectorId);
        if (!(await ensureOriginPermission(r))) {
          ev.target.checked = false;
          status('Page redirecting needs access to ' + XIT.templateHost(r.template), 'error');
          return;
        }
      }
      settings = await XITStore.save({ browseRedirect: ev.target.checked });
      api.runtime.sendMessage({ type: 'xit:settings-changed' }).catch(() => {});
      renderBrowse();
    });

    $('browse-target').addEventListener('change', async (ev) => {
      const r = XITStore.findRedirector(settings, ev.target.value);
      if (settings.browseRedirect && !(await ensureOriginPermission(r))) {
        ev.target.value = settings.browseRedirectorId;
        status('Needs access to ' + XIT.templateHost(r.template), 'error');
        return;
      }
      settings = await XITStore.save({ browseRedirectorId: ev.target.value });
      api.runtime.sendMessage({ type: 'xit:settings-changed' }).catch(() => {});
      renderBrowse();
    });
  }

  init().catch((e) => status(String(e && e.message || e), 'error'));
})();
