/*
 * xIT - core URL logic.
 *
 * Loaded as a classic script in every context (background, content script,
 * popup, options, page main-world) so it must not use import/export.
 * Everything hangs off globalThis.XIT.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Source / mirror host recognition
   * ------------------------------------------------------------------ */

  const SOURCE_HOST_RE = /^(?:www\.|mobile\.|m\.)?(?:twitter|x)\.com$/i;

  // First path segment that is a site feature, never a username.
  const RESERVED = new Set([
    'i', 'home', 'explore', 'notifications', 'messages', 'settings', 'search',
    'compose', 'login', 'logout', 'signup', 'intent', 'hashtag', 'share',
    'account', 'tos', 'privacy', 'about', 'who_to_follow', 'lists', 'topics',
    'bookmarks', 'jobs', 'following', 'followers', 'connect_people', 'notifications',
    'search-advanced', 'session', 'oauth', 'widgets', 'download', 'messages',
  ]);

  const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

  // Share-tracking junk X appends to copied links.
  const TRACKING_PARAMS = ['s', 't', 'ref_src', 'ref_url', 'cn', 'twclid', 'mx', 'ref_component'];

  /* ------------------------------------------------------------------ *
   * Groups + presets
   * ------------------------------------------------------------------ */

  const GROUPS = [
    { id: 'embed',   label: 'Embed fixers',      blurb: 'Tweets unfurl properly in Discord, Slack and Signal.' },
    { id: 'thread',  label: 'Thread tools',      blurb: 'Unroll a long thread into one page.' },
    { id: 'custom',  label: 'Custom',            blurb: 'Your own instances and templates.' },
  ];

  const PRESETS = [
    // --- embed fixers ---------------------------------------------------
    { id: 'fxtwitter', name: 'FxTwitter', group: 'embed', host: 'fxtwitter.com',
      template: 'https://fxtwitter.com/{path}{query}',
      note: 'The usual default. Rich embeds, video, multi-image.' },
    { id: 'fixupx', name: 'FixupX', group: 'embed', host: 'fixupx.com',
      template: 'https://fixupx.com/{path}{query}',
      note: 'FxTwitter under an x.com-shaped name.' },
    { id: 'twittpr', name: 'Twittpr', group: 'embed', host: 'twittpr.com',
      template: 'https://twittpr.com/{path}{query}',
      note: 'FxTwitter alias, handy when fxtwitter.com is filtered.' },
    { id: 'vxtwitter', name: 'vxTwitter', group: 'embed', host: 'vxtwitter.com',
      template: 'https://vxtwitter.com/{path}{query}',
      note: 'Alternative embed fixer. Good multi-image galleries.' },
    { id: 'fixvx', name: 'FixVX', group: 'embed', host: 'fixvx.com',
      template: 'https://fixvx.com/{path}{query}',
      note: 'vxTwitter alias.' },
    { id: 'fxtwitter-direct', name: 'FxTwitter (direct media)', group: 'embed', host: 'd.fxtwitter.com',
      template: 'https://d.fxtwitter.com/{path}', requires: ['id'],
      note: 'Jumps straight to the video/image file itself.' },

    // --- thread tools ---------------------------------------------------
    { id: 'threadreader', name: 'Thread Reader App', group: 'thread', host: 'threadreaderapp.com',
      template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'],
      note: 'Unrolls the whole thread. Needs a tweet link, not a profile.' },
    { id: 'unrollnow', name: 'Unroll Now', group: 'thread', host: 'unrollnow.com',
      template: 'https://unrollnow.com/status/{id}', requires: ['id'],
      note: 'Needs a tweet link, not a profile.' },
  ];

  const PRESET_HOSTS = new Set(PRESETS.map((p) => p.host));

  // Front-ends xIT no longer offers. Links from them are still read, so a
  // pasted xcancel or Nitter URL can be converted to a supported redirector,
  // but nothing ever sends a user to these hosts.
  const WITHDRAWN_HOSTS = new Set(['xcancel.com', 'twiiit.com']);

  /* ------------------------------------------------------------------ *
   * Parsing
   * ------------------------------------------------------------------ */

  function bareHost(hostname) {
    return String(hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isSourceHost(hostname) {
    return SOURCE_HOST_RE.test(String(hostname || ''));
  }

  // A host we can re-parse, so an already-redirected link can be retargeted.
  function isMirrorHost(hostname, extraHosts) {
    const bare = bareHost(hostname);
    if (PRESET_HOSTS.has(bare) || WITHDRAWN_HOSTS.has(bare)) return true;
    if (extraHosts && extraHosts.has(String(hostname).toLowerCase())) return true;
    return /(^|\.)nitter\b/.test(bare) || bare.startsWith('nitter.');
  }

  /**
   * Pull the interesting pieces out of a tweet/profile URL.
   * Returns null when the URL is not one we handle.
   */
  function parse(raw, extraHosts) {
    let u;
    try {
      u = new URL(String(raw == null ? '' : raw).trim());
    } catch (_) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    const source = isSourceHost(u.hostname);
    if (!source && !isMirrorHost(u.hostname, extraHosts)) return null;

    let segs = u.pathname.split('/').filter(Boolean);
    // Thread tools publish their own path shapes. Recover the status ID
    // before retargeting; those paths are not valid on a plain mirror.
    const mirror = bareHost(u.hostname);
    if (mirror === 'threadreaderapp.com' || mirror === 'unrollnow.com') {
      const match = (mirror === 'threadreaderapp.com'
        ? /^\/thread\/(\d+)\.html\/?$/ : /^\/status\/(\d+)\/?$/).exec(u.pathname);
      if (!match) return null;
      segs = ['i', 'web', 'status', match[1]];
    }
    let kind = 'other';
    let user = null;
    let id = null;

    const sIdx = segs.findIndex((s) => s === 'status' || s === 'statuses');
    if (sIdx >= 0 && /^\d+$/.test(segs[sIdx + 1] || '')) {
      kind = 'status';
      id = segs[sIdx + 1];
      // /user/status/ID, /i/status/ID, /i/web/status/ID
      const prev = segs[sIdx - 1];
      user = prev === 'web' ? (segs[sIdx - 2] || 'i') : (prev || 'i');
    } else if (segs.length === 1 && !RESERVED.has(segs[0].toLowerCase()) && USERNAME_RE.test(segs[0])) {
      kind = 'profile';
      user = segs[0];
    }

    return {
      kind,
      user,
      id,
      host: u.hostname.toLowerCase(),
      bare: bareHost(u.hostname),
      isSource: source,
      path: segs.join('/'),
      search: u.search,
      hash: u.hash,
      href: u.href,
    };
  }

  function stripTracking(search) {
    if (!search || search === '?') return '';
    const p = new URLSearchParams(search.replace(/^\?/, ''));
    for (const k of TRACKING_PARAMS) p.delete(k);
    const out = p.toString();
    return out ? '?' + out : '';
  }

  /* ------------------------------------------------------------------ *
   * Templates
   * ------------------------------------------------------------------ */

  const TOKENS = ['user', 'id', 'path', 'query', 'hash', 'host'];

  function expand(template, parts, opts) {
    const o = opts || {};
    const search = o.stripTracking === false ? parts.search : stripTracking(parts.search);
    const map = {
      user: parts.user || '',
      id: parts.id || '',
      path: parts.path || '',
      query: search || '',
      hash: parts.hash || '',
      host: parts.bare || '',
    };
    return template.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m));
  }

  /**
   * Validate a user-entered template. Returns { ok } or { ok:false, error }.
   */
  function validateTemplate(template) {
    const t = String(template || '').trim();
    if (!t) return { ok: false, error: 'Template is empty.' };
    if (!/^https:\/\//i.test(t)) return { ok: false, error: 'Must start with https://' };
    if (/[\\\u0000-\u0020]/.test(t)) return { ok: false, error: 'Use URL encoding for spaces; backslashes and control characters are not allowed.' };
    const used = [];
    const bad = [];
    t.replace(/\{(\w+)\}/g, (m, k) => {
      (TOKENS.includes(k) ? used : bad).push(k);
      return m;
    });
    if (bad.length) return { ok: false, error: 'Unknown token: {' + bad[0] + '}. Use ' + TOKENS.map((x) => '{' + x + '}').join(', ') + '.' };
    if (!used.length) return { ok: false, error: 'Needs at least one token, e.g. {path} or {id}.' };
    try {
      // Token-free version must still be a parseable URL.
      const u = new URL(t.replace(/\{\w+\}/g, 'x'));
      if (u.username || u.password) return { ok: false, error: 'Do not include credentials in a template.' };
    } catch (_) {
      return { ok: false, error: 'Not a valid URL once tokens are filled in.' };
    }
    return { ok: true, tokens: used };
  }

  function templateHost(template) {
    const u = templateURL(template);
    return u ? u.hostname : null;
  }

  function templateURL(template) {
    const t = String(template || '').trim();
    const authority = /^https:\/\/([^/?#]+)/i.exec(t);
    if (!authority || /[{}\\\s]/.test(authority[1])) return null;
    try {
      const u = new URL(t.replace(/\{\w+\}/g, 'x'));
      return u.protocol === 'https:' && !u.username && !u.password ? u : null;
    } catch (_) { return null; }
  }

  /**
   * Convert a URL with a redirector.
   * Returns { ok:true, url } or { ok:false, reason } (reason is user-facing).
   */
  function convert(raw, redirector, opts) {
    const o = opts || {};
    if (!redirector || !redirector.template) return { ok: false, reason: 'No redirector selected.' };
    const parts = parse(raw, o.extraHosts);
    if (!parts) return { ok: false, reason: 'Not an X/Twitter link.' };

    const requires = redirector.requires || [];
    if (requires.includes('id') && !parts.id) {
      return { ok: false, reason: redirector.name + ' needs a link to a specific tweet.' };
    }
    if (requires.includes('user') && !parts.user) {
      return { ok: false, reason: redirector.name + ' needs a link with an account in it.' };
    }
    const url = expand(redirector.template, parts, { stripTracking: o.stripTracking !== false });
    if (url === parts.href) return { ok: false, reason: 'Already pointing at ' + (templateHost(redirector.template) || 'that site') + '.' };
    return { ok: true, url, parts };
  }

  /** Canonical x.com URL for a parsed link, tracking params dropped. */
  function canonical(raw, opts) {
    const o = opts || {};
    const parts = parse(raw, o.extraHosts);
    if (!parts) return null;
    return 'https://x.com/' + parts.path + (o.stripTracking === false ? parts.search : stripTracking(parts.search)) + parts.hash;
  }

  root.XIT = {
    GROUPS, PRESETS, TOKENS, TRACKING_PARAMS,
    parse, expand, convert, canonical, stripTracking,
    validateTemplate, templateHost,
    isSourceHost, isMirrorHost, bareHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
