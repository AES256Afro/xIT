/*
 * xIT - isolated world content script.
 * Owns the in-page button, the dropdown, the toast, and the fallback
 * interception of X's native "Copy link".
 */
(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  const XIT = globalThis.XIT;
  const XITStore = globalThis.XITStore;

  let settings = null;
  let extraHosts = new Set();
  let mainWorldReady = false;

  /* ---------------------------------------------------------------- *
   * Icons
   * ---------------------------------------------------------------- */

  const ICON_REDIRECT = 'M14.5 4.5 21 11l-6.5 6.5V13H10a4.5 4.5 0 0 0-4.5 4.5V20H3v-2.5A7 7 0 0 1 10 10.5h4.5V4.5Z';
  const ICON_CARET = 'M12 16.5 5 9h14l-7 7.5Z';
  const ICON_OPEN = 'M13 4h7v7h-2V7.4l-8.3 8.3-1.4-1.4L16.6 6H13V4ZM5 6h5v2H6v10h10v-4h2v6H4V6h1Z';
  const ICON_STAR = 'm12 3.6 2.5 5.3 5.8.8-4.2 4.1 1 5.8-5.1-2.8-5.1 2.8 1-5.8-4.2-4.1 5.8-.8L12 3.6Zm0 4.6-1.1 2.4-2.6.4 1.9 1.8-.4 2.6L12 14.2l2.2 1.2-.4-2.6 1.9-1.8-2.6-.4L12 8.2Z';

  /* ---------------------------------------------------------------- *
   * Theme
   * ---------------------------------------------------------------- */

  function luminance(rgbString) {
    const m = /rgba?\(([^)]+)\)/.exec(rgbString || '');
    if (!m) return null;
    const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function syncTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const l = luminance(bg);
    if (l == null) return;
    document.documentElement.setAttribute('data-xit-theme', l > 0.5 ? 'light' : 'dark');
  }

  /* ---------------------------------------------------------------- *
   * Toast
   * ---------------------------------------------------------------- */

  let toastEl = null;
  let toastTimer = 0;

  function toast(text, kind) {
    if (settings && settings.toast === false) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'xit-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.setAttribute('data-kind', kind || 'ok');
    // Force a frame so the transition runs on repeat copies.
    toastEl.removeAttribute('data-show');
    requestAnimationFrame(() => toastEl && toastEl.setAttribute('data-show', '1'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.removeAttribute('data-show');
    }, kind === 'error' ? 3800 : 2200);
  }

  /* ---------------------------------------------------------------- *
   * Clipboard
   * ---------------------------------------------------------------- */

  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function shortLabel(url) {
    return url.length > 78 ? url.slice(0, 75) + '…' : url;
  }

  async function copyWith(redirector, sourceUrl) {
    const out = XIT.convert(sourceUrl, redirector, {
      stripTracking: settings.stripTracking,
      extraHosts,
    });
    if (!out.ok) {
      toast(out.reason, 'error');
      return false;
    }
    const ok = await writeClipboard(out.url);
    toast(ok ? 'Copied ' + redirector.name + ': ' + shortLabel(out.url) : 'Could not write to the clipboard', ok ? 'ok' : 'error');
    return ok;
  }

  async function copyOriginal(sourceUrl) {
    const clean = XIT.canonical(sourceUrl, { stripTracking: settings.stripTracking, extraHosts });
    if (!clean) {
      toast('Not an X/Twitter link.', 'error');
      return;
    }
    const ok = await writeClipboard(clean);
    toast(ok ? 'Copied x.com link: ' + shortLabel(clean) : 'Could not write to the clipboard', ok ? 'ok' : 'error');
  }

  function openWith(redirector, sourceUrl) {
    const out = XIT.convert(sourceUrl, redirector, { stripTracking: settings.stripTracking, extraHosts });
    if (!out.ok) {
      toast(out.reason, 'error');
      return;
    }
    api.runtime.sendMessage({ type: 'xit:open', url: out.url }).catch(() => {
      window.open(out.url, '_blank', 'noopener');
    });
  }

  /* ---------------------------------------------------------------- *
   * Finding the tweet a click belongs to
   * ---------------------------------------------------------------- */

  function permalinkFor(article) {
    if (!article) return null;
    // X's timestamp link is the canonical permalink for that tweet.
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      if (a.querySelector('time')) return a.href;
    }
    for (const a of links) {
      if (/\/status\/\d+(?:[/?#]|$)/.test(a.getAttribute('href') || '')) return a.href;
    }
    return null;
  }

  function sourceUrlFor(article) {
    return permalinkFor(article) || location.href;
  }

  /** The tweet the user most likely means for the keyboard shortcut. */
  function currentArticle() {
    const focused = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('article[data-testid="tweet"]')
      : null;
    if (focused) return focused;

    const hovered = document.querySelectorAll('article[data-testid="tweet"]:hover');
    if (hovered.length) return hovered[hovered.length - 1];

    // Otherwise the first article meaningfully in view.
    let best = null;
    let bestTop = Infinity;
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const r = a.getBoundingClientRect();
      if (r.bottom < 80 || r.top > window.innerHeight - 40) continue;
      const top = Math.abs(r.top - 100);
      if (top < bestTop) { bestTop = top; best = a; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- *
   * Dropdown
   * ---------------------------------------------------------------- */

  let menuEl = null;
  let menuOwner = null;
  let menuSourceUrl = null;
  let menuTrigger = null;

  function closeMenu(restoreFocus = false) {
    const trigger = menuTrigger;
    if (menuEl) menuEl.hidden = true;
    if (menuOwner) {
      menuOwner.removeAttribute('data-open');
      const caret = menuOwner.querySelector('.xit-btn-caret');
      if (caret) caret.setAttribute('aria-expanded', 'false');
    }
    menuOwner = null;
    menuSourceUrl = null;
    menuTrigger = null;
    if (restoreFocus && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function buildMenu() {
    const el = document.createElement('div');
    el.className = 'xit-menu';
    el.setAttribute('role', 'menu');
    el.hidden = true;

    el.addEventListener('click', async (ev) => {
      const act = ev.target.closest('.xit-row-act');
      const row = ev.target.closest('.xit-row');
      const foot = ev.target.closest('[data-foot]');
      ev.stopPropagation();

      if (foot) {
        const kind = foot.getAttribute('data-foot');
        const src = menuSourceUrl;
        closeMenu();
        if (kind === 'original') await copyOriginal(src);
        if (kind === 'options') api.runtime.sendMessage({ type: 'xit:open-options' }).catch(() => {});
        return;
      }
      if (!row) return;

      const redirector = XITStore.findRedirector(settings, row.getAttribute('data-id'));
      if (!redirector) return;
      const src = menuSourceUrl;

      if (act && act.getAttribute('data-act') === 'open') {
        closeMenu();
        openWith(redirector, src);
        return;
      }
      if (act && act.getAttribute('data-act') === 'default') {
        await XITStore.save({ defaultRedirector: redirector.id });
        toast(redirector.name + ' is now the default', 'ok');
        closeMenu();
        return;
      }
      closeMenu();
      await copyWith(redirector, src);
    });

    el.addEventListener('keydown', (ev) => {
      // Buttons inside rows and the footer keep their native activation.
      if (ev.target.closest('button')) return;
      const rows = Array.from(el.querySelectorAll('.xit-row'));
      const idx = rows.findIndex((r) => r.classList.contains('xit-active'));
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = ev.key === 'ArrowDown'
          ? Math.min(rows.length - 1, idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
        rows.forEach((r) => r.classList.remove('xit-active'));
        if (rows[next]) {
          rows[next].classList.add('xit-active');
          rows[next].focus({ preventScroll: true });
          rows[next].scrollIntoView({ block: 'nearest' });
        }
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (rows[idx]) rows[idx].click();
      }
    });

    document.body.appendChild(el);
    return el;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(pathData) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function renderMenu() {
    const focused = menuEl.contains(document.activeElement) ? document.activeElement : null;
    const focusRow = focused && focused.closest('.xit-row');
    const focusId = focusRow && focusRow.getAttribute('data-id');
    const focusAction = focused && focused.getAttribute('data-act');
    const focusFoot = focused && focused.getAttribute('data-foot');
    const scrollTop = menuEl.scrollTop;
    const list = XITStore.enabledRedirectors(settings);
    const fragment = document.createDocumentFragment();
    for (const g of XIT.GROUPS) {
      const inGroup = list.filter((r) => r.group === g.id);
      if (!inGroup.length) continue;
      fragment.appendChild(element('div', 'xit-group-label', g.label));
      for (const r of inGroup) {
        const row = element('div', 'xit-row');
        row.setAttribute('role', 'menuitem');
        row.setAttribute('tabindex', '-1');
        row.setAttribute('data-id', r.id);
        if (r.id === settings.defaultRedirector) row.setAttribute('data-default', '1');
        row.appendChild(element('span', 'xit-row-dot'));
        const label = element('span', 'xit-row-label');
        label.appendChild(element('span', 'xit-row-name', r.name));
        if (r.note) label.appendChild(element('span', 'xit-row-note', r.note));
        row.appendChild(label);
        for (const [action, title, pathData] of [
          ['open', 'Open with ' + r.name, ICON_OPEN],
          ['default', 'Make ' + r.name + ' the default', ICON_STAR],
        ]) {
          const button = element('button', 'xit-row-act');
          button.setAttribute('data-act', action);
          button.setAttribute('title', title);
          button.setAttribute('aria-label', title);
          button.appendChild(icon(pathData));
          row.appendChild(button);
        }
        fragment.appendChild(row);
      }
    }
    fragment.appendChild(element('div', 'xit-sep'));
    const foot = element('div', 'xit-foot');
    for (const [action, text] of [['original', 'Copy clean x.com link'], ['options', 'Settings']]) {
      const button = element('button', '', text);
      button.setAttribute('data-foot', action);
      foot.appendChild(button);
    }
    fragment.appendChild(foot);
    menuEl.replaceChildren(fragment);
    if (focused) {
      const row = [...menuEl.querySelectorAll('.xit-row')].find((r) => r.getAttribute('data-id') === focusId);
      const target = focusFoot ? menuEl.querySelector('[data-foot="' + focusFoot + '"]')
        : focusAction && row ? row.querySelector('[data-act="' + focusAction + '"]') : row;
      if (row) row.classList.add('xit-active');
      if (target) target.focus({ preventScroll: true });
    }
    menuEl.scrollTop = scrollTop;
  }

  function openMenu(wrap, sourceUrl) {
    if (!menuEl) menuEl = buildMenu();
    if (menuOwner === wrap && !menuEl.hidden) { closeMenu(); return; }
    closeMenu();
    menuOwner = wrap;
    menuTrigger = wrap.contains(document.activeElement) ? document.activeElement : wrap.querySelector('.xit-btn-main');
    menuSourceUrl = sourceUrl;
    renderMenu();
    menuEl.hidden = false;
    wrap.setAttribute('data-open', '1');
    wrap.querySelector('.xit-btn-caret').setAttribute('aria-expanded', 'true');

    // Place it under the button, flipping up or inward as needed.
    const r = wrap.getBoundingClientRect();
    menuEl.style.top = '0px';
    menuEl.style.left = '0px';
    const m = menuEl.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, r.top - m.height - 6);
    let left = r.left;
    if (left + m.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - m.width - 8);
    menuEl.style.top = top + 'px';
    menuEl.style.left = left + 'px';

    const first = menuEl.querySelector('.xit-row');
    if (first) { first.classList.add('xit-active'); first.focus(); }
  }

  /* ---------------------------------------------------------------- *
   * Button injection
   * ---------------------------------------------------------------- */

  function isTweetActionBar(group) {
    if (!group.closest('article')) return false;
    return !!group.querySelector('[data-testid="reply"], [data-testid="like"], [data-testid="unlike"], [data-testid="retweet"]');
  }

  function makeButton(article) {
    const wrap = document.createElement('div');
    wrap.className = 'xit-wrap';
    wrap.setAttribute('role', 'group');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'xit-btn xit-btn-main';
    main.appendChild(icon(ICON_REDIRECT));

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'xit-btn xit-btn-caret';
    caret.appendChild(icon(ICON_CARET));
    caret.setAttribute('aria-haspopup', 'menu');
    caret.setAttribute('aria-expanded', 'false');
    caret.setAttribute('aria-label', 'Choose a redirector');

    function labelMain() {
      const d = XITStore.defaultRedirector(settings);
      const t = 'Copy as ' + d.name;
      main.title = t;
      main.setAttribute('aria-label', t);
    }
    labelMain();
    wrap.addEventListener('xit:relabel', labelMain);

    let longPress = 0;

    main.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.altKey || ev.shiftKey) { openMenu(wrap, sourceUrlFor(article)); return; }
      main.setAttribute('data-busy', '1');
      await copyWith(XITStore.defaultRedirector(settings), sourceUrlFor(article));
      main.removeAttribute('data-busy');
    });

    main.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openMenu(wrap, sourceUrlFor(article));
    });

    main.addEventListener('pointerdown', () => {
      clearTimeout(longPress);
      longPress = setTimeout(() => openMenu(wrap, sourceUrlFor(article)), 450);
    });
    for (const e of ['pointerup', 'pointerleave', 'pointercancel']) {
      main.addEventListener(e, () => clearTimeout(longPress));
    }

    caret.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openMenu(wrap, sourceUrlFor(article));
    });

    wrap.appendChild(main);
    wrap.appendChild(caret);
    return wrap;
  }

  function scan(root = document) {
    if (!settings || !settings.copyButton) return;
    const groups = root.querySelectorAll(root === document ? 'article [role="group"]' : '[role="group"]');
    for (const group of groups) {
      // X recycles nodes: a marked bar that lost its button needs a new one.
      if (group.hasAttribute('data-xit') && group.querySelector('.xit-wrap')) continue;
      if (!isTweetActionBar(group)) continue;
      group.setAttribute('data-xit', '1');
      const article = group.closest('article');
      try {
        group.appendChild(makeButton(article));
      } catch (e) {
        console.warn('[xit] could not add button', e);
      }
    }
  }

  function removeButtons() {
    for (const w of document.querySelectorAll('.xit-wrap')) w.remove();
    for (const g of document.querySelectorAll('[data-xit]')) g.removeAttribute('data-xit');
  }

  function relabelButtons() {
    for (const w of document.querySelectorAll('.xit-wrap')) {
      w.dispatchEvent(new CustomEvent('xit:relabel'));
    }
  }

  let scanQueued = false;
  let fullScan = false;
  const pendingArticles = new Set();
  function queueScan(article) {
    if (!settings || !settings.copyButton) return;
    if (article) pendingArticles.add(article); else fullScan = true;
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      try {
        if (fullScan) scan();
        else for (const article of pendingArticles) if (article.isConnected) scan(article);
      } catch (e) { console.warn('[xit] scan failed', e); }
      fullScan = false;
      pendingArticles.clear();
    });
  }

  function scanMutations(records) {
    if (!settings || !settings.copyButton) return;
    const owned = '.xit-wrap, .xit-menu, .xit-toast';
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest(owned)) continue;
      const added = [...record.addedNodes].filter((node) => node.nodeType !== 1 || !node.matches(owned));
      if (!added.length && !record.removedNodes.length) continue;
      const article = target && target.closest('article');
      if (article) queueScan(article);
      for (const node of added) {
        if (node.nodeType !== 1) continue;
        if (node.matches('article')) queueScan(node);
        else for (const child of node.querySelectorAll('article')) queueScan(child);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Native "Copy link" interception - fallback path
   *
   * The main-world clipboard wrapper handles this properly. If it never
   * reported in (older browser, no MAIN world), catch the menu item itself.
   * ---------------------------------------------------------------- */

  // X renders its share menu in a portal outside the <article>, so the tweet
  // has to be remembered from the click that opened the menu.
  let lastTweetArticle = null;

  function rememberTweet(ev) {
    const a = ev.target.closest && ev.target.closest('article[data-testid="tweet"]');
    if (a) lastTweetArticle = a;
  }

  function nativeCopyFallback(ev) {
    if (!settings || !settings.hijackNativeCopy || mainWorldReady) return;
    const item = ev.target.closest && ev.target.closest('[role="menuitem"], [data-testid="copy-link-to-tweet"]');
    if (!item) return;
    const text = (item.textContent || '').trim().toLowerCase();
    if (!/copy link/.test(text)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const article = (lastTweetArticle && lastTweetArticle.isConnected)
      ? lastTweetArticle
      : document.querySelector('article[data-testid="tweet"]');
    const src = permalinkFor(article) || location.href;
    copyWith(XITStore.defaultRedirector(settings), src);

    // Close X's menu, which no longer gets its own click.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  /* ---------------------------------------------------------------- *
   * Main world plumbing
   * ---------------------------------------------------------------- */

  function pushConfig() {
    if (!settings) return;
    const d = XITStore.defaultRedirector(settings);
    window.postMessage({
      __xit: 'config',
      payload: {
        enabled: !!settings.hijackNativeCopy,
        template: d ? d.template : null,
        name: d ? d.name : '',
        requires: (d && d.requires) || [],
        stripTracking: settings.stripTracking,
      },
    }, location.origin);
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d.__xit !== 'string') return;
    if (d.__xit === 'hello') {
      mainWorldReady = true;
      pushConfig();
    } else if (d.__xit === 'ready') {
      // The document_start hello may predate our listener. This confirms
      // receipt of our config without starting another message exchange.
      mainWorldReady = true;
    } else if (d.__xit === 'copied' && typeof d.url === 'string') {
      toast('Copied: ' + shortLabel(d.url), 'ok');
    }
  }, false);

  /* ---------------------------------------------------------------- *
   * Messages from the background
   * ---------------------------------------------------------------- */

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'xit:copy-text') {
      writeClipboard(msg.text).then((ok) => {
        toast(ok ? 'Copied: ' + shortLabel(msg.text) : 'Could not write to the clipboard', ok ? 'ok' : 'error');
        sendResponse({ ok });
      });
      return true;
    }

    if (msg.type === 'xit:copy-current') {
      const article = currentArticle();
      copyWith(XITStore.defaultRedirector(settings), sourceUrlFor(article))
        .then((ok) => sendResponse({ ok }));
      return true;
    }

    if (msg.type === 'xit:ping') {
      sendResponse({ ok: true, url: location.href });
      return true;
    }
  });

  /* ---------------------------------------------------------------- *
   * Bypass parameter cleanup
   * ---------------------------------------------------------------- */

  function cleanBypassParam() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get(XIT.BYPASS_PARAM) !== '1') return;
      u.searchParams.delete(XIT.BYPASS_PARAM);
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    } catch (_) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- *
   * Start
   * ---------------------------------------------------------------- */

  async function start() {
    settings = await XITStore.load();
    extraHosts = XITStore.extraHosts(settings);

    syncTheme();
    cleanBypassParam();
    pushConfig();
    queueScan();

    new MutationObserver(scanMutations).observe(document.body, { childList: true, subtree: true });

    // X swaps themes without a reload; body style is the tell.
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });

    document.addEventListener('pointerdown', rememberTweet, true);
    document.addEventListener('click', nativeCopyFallback, true);

    document.addEventListener('click', (ev) => {
      if (!menuEl || menuEl.hidden) return;
      const t = ev.target;
      if (!t || t.nodeType !== 1 || !t.closest) { closeMenu(); return; }
      if (!t.closest('.xit-menu') && !t.closest('.xit-wrap')) closeMenu();
    }, true);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && menuEl && !menuEl.hidden) {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
      }
    }, true);
    // The menu is position:fixed and anchored to its button, so it closes when
    // the page scrolls out from under it. This is a capture listener, so it
    // also sees the menu scrolling its own overflow: ignore that, or the list
    // cannot be scrolled at all.
    window.addEventListener('scroll', (ev) => {
      if (!menuEl || menuEl.hidden) return;
      const t = ev.target;
      if (t === menuEl) return;
      if (t && t.nodeType === 1 && menuEl.contains(t)) return;
      closeMenu();
    }, true);
    window.addEventListener('resize', () => { if (menuEl && !menuEl.hidden) closeMenu(); });

    XITStore.onChanged((next) => {
      const wasButton = settings.copyButton;
      settings = next;
      extraHosts = XITStore.extraHosts(next);
      pushConfig();
      if (!next.copyButton) removeButtons();
      else if (!wasButton) queueScan();
      relabelButtons();
      if (menuEl && !menuEl.hidden) renderMenu();
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
