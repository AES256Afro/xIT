/*
 * Xit - core URL logic.
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
    { id: 'privacy', label: 'Privacy frontends', blurb: 'Read without X tracking or the login wall.' },
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
      template: 'https://d.fxtwitter.com/{path}', requires: ['id'], browse: false,
      note: 'Jumps straight to the video/image file itself.' },

    // --- privacy frontends ---------------------------------------------
    { id: 'xcancel', name: 'xcancel', group: 'privacy', host: 'xcancel.com',
      template: 'https://xcancel.com/{path}{query}',
      note: 'The most dependable public Nitter instance.' },
    { id: 'twiiit', name: 'twiiit (picks an instance)', group: 'privacy', host: 'twiiit.com',
      template: 'https://twiiit.com/{path}{query}',
      note: 'Forwards to whichever Nitter instance is currently up.' },
    { id: 'nitter-net', name: 'nitter.net', group: 'privacy', host: 'nitter.net',
      template: 'https://nitter.net/{path}{query}' },
    { id: 'nitter-poast', name: 'nitter.poast.org', group: 'privacy', host: 'nitter.poast.org',
      template: 'https://nitter.poast.org/{path}{query}' },
    { id: 'nitter-privacydev', name: 'nitter.privacydev.net', group: 'privacy', host: 'nitter.privacydev.net',
      template: 'https://nitter.privacydev.net/{path}{query}' },

    // --- thread tools ---------------------------------------------------
    { id: 'threadreader', name: 'Thread Reader App', group: 'thread', host: 'threadreaderapp.com',
      template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'],
      note: 'Unrolls the whole thread. Needs a tweet link, not a profile.' },
    { id: 'unrollnow', name: 'Unroll Now', group: 'thread', host: 'unrollnow.com',
      template: 'https://unrollnow.com/status/{id}', requires: ['id'],
      note: 'Needs a tweet link, not a profile.' },
  ];

  const PRESET_HOSTS = new Set(PRESETS.map((p) => p.host));

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
    if (PRESET_HOSTS.has(bare)) return true;
    if (extraHosts && extraHosts.has(bare)) return true;
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

    const segs = u.pathname.split('/').filter(Boolean);
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
      new URL(t.replace(/\{\w+\}/g, 'x'));
    } catch (_) {
      return { ok: false, error: 'Not a valid URL once tokens are filled in.' };
    }
    return { ok: true, tokens: used };
  }

  function templateHost(template) {
    const m = /^https?:\/\/([^/{}\s]+)/i.exec(String(template || ''));
    return m ? bareHost(m[1]) : null;
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

  function supportsBrowse(redirector) {
    if (!redirector) return false;
    if (redirector.browse === false) return false;
    return compileBrowseRules(redirector.template, { status: true, profile: true, other: true }).length > 0;
  }

  /* ------------------------------------------------------------------ *
   * declarativeNetRequest rule compilation
   *
   * Chrome and Firefox both run these through RE2: no lookahead, no
   * backreferences. Layering is done with rule priority instead.
   *   5 bypass allow  4 status redirect  3 reserved allow
   *   2 profile redirect  1 catch-all redirect
   * ------------------------------------------------------------------ */

  const SRC = '^https?://(?:www\\.|mobile\\.|m\\.)?(?:twitter|x)\\.com/';
  const RESERVED_ALT = [
    'i/', 'home', 'explore', 'notifications', 'messages', 'settings', 'search',
    'compose', 'login', 'logout', 'signup', 'intent/', 'account', 'tos',
    'privacy', 'about', 'bookmarks', 'topics', 'jobs', 'oauth', 'widgets',
  ].join('|');

  const BYPASS_PARAM = 'xit_bypass';

  function compileBrowseRules(template, scopes) {
    const t = String(template || '');
    const host = templateHost(t);
    if (!host) return [];
    const sc = scopes || {};
    const rules = [];

    // Shape A: plain host swap, path preserved.
    if (/^https:\/\/[^/{}\s]+\/\{path\}(?:\{query\})?(?:\{hash\})?$/i.test(t)) {
      if (sc.status) {
        rules.push({ priority: 4, regexFilter: SRC + '([^/?#]+/status(?:es)?/\\d+.*)$', regexSubstitution: 'https://' + host + '/\\1' });
        rules.push({ priority: 4, regexFilter: SRC + '(i/(?:web/)?status/\\d+.*)$', regexSubstitution: 'https://' + host + '/\\1' });
      }
      if (sc.profile) {
        rules.push({ priority: 2, regexFilter: SRC + '([A-Za-z0-9_]{1,15})/?(\\?.*)?$', regexSubstitution: 'https://' + host + '/\\1\\2' });
      }
      if (sc.other) {
        rules.push({ priority: 1, regexFilter: SRC + '(.*)$', regexSubstitution: 'https://' + host + '/\\1' });
      }
      return rules;
    }

    // Shape B: status-only template built from {user} and/or {id}.
    if (/\{id\}/.test(t) && !/\{path\}|\{query\}|\{hash\}/.test(t)) {
      if (!sc.status) return [];
      const subUserId = t.replace(/\{user\}/g, '\\1').replace(/\{id\}/g, '\\2');
      rules.push({ priority: 4, regexFilter: SRC + '([^/?#]+)/status(?:es)?/(\\d+)', regexSubstitution: subUserId });
      const subIdOnly = t.replace(/\{user\}/g, 'i').replace(/\{id\}/g, '\\1');
      rules.push({ priority: 4, regexFilter: SRC + 'i/(?:web/)?status/(\\d+)', regexSubstitution: subIdOnly });
      return rules;
    }

    return []; // Not expressible as a pre-request rule.
  }

  function guardRules() {
    return [
      { priority: 5, regexFilter: '^https?://[^/]*(?:twitter|x)\\.com/.*[?&]' + BYPASS_PARAM + '=1', action: 'allow' },
      { priority: 3, regexFilter: SRC + '(?:' + RESERVED_ALT + ')', action: 'allow' },
    ];
  }

  root.XIT = {
    GROUPS, PRESETS, TOKENS, TRACKING_PARAMS, BYPASS_PARAM, RESERVED,
    parse, expand, convert, canonical, stripTracking,
    validateTemplate, templateHost, supportsBrowse,
    compileBrowseRules, guardRules,
    isSourceHost, isMirrorHost, bareHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
