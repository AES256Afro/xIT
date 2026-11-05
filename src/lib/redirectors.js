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

  // The one list of X origins. tools/build.mjs reads this to generate
  // host_permissions and the content script matches, the background uses it
  // for menu patterns, and the popup uses it for its permission gate. Keeping
  // three copies in step by hand is what let them drift apart.
  const HOST_PATTERNS = [
    '*://x.com/*', '*://www.x.com/*',
    '*://twitter.com/*', '*://www.twitter.com/*',
    '*://mobile.twitter.com/*', '*://m.twitter.com/*',
  ];

  // First path segment that is a site feature, never a username.
  const RESERVED = new Set([
    'i', 'home', 'explore', 'notifications', 'messages', 'settings', 'search',
    'compose', 'login', 'logout', 'signup', 'intent', 'hashtag', 'share',
    'account', 'tos', 'privacy', 'about', 'who_to_follow', 'lists', 'topics',
    'bookmarks', 'jobs', 'following', 'followers', 'connect_people',
    'search-advanced', 'session', 'oauth', 'widgets', 'download',
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

  // Bundled and enabled on install. Three, one per job: embeds, embeds with
  // better galleries, threads. Everything else is in CATALOGUE below, off
  // until the user asks for it. Eight pre-ticked presets made the choice look
  // like a list to read rather than a decision to make, and five of them were
  // aliases of the other three (U6).
  const PRESETS = [
    { id: 'fxtwitter', name: 'FxTwitter', group: 'embed', host: 'fxtwitter.com',
      template: 'https://fxtwitter.com/{path}{query}',
      note: 'The usual default. Rich embeds, video, multi-image.' },
    { id: 'vxtwitter', name: 'vxTwitter', group: 'embed', host: 'vxtwitter.com',
      template: 'https://vxtwitter.com/{path}{query}',
      note: 'A different service. Good multi-image galleries.' },
    { id: 'threadreader', name: 'Thread Reader App', group: 'thread', host: 'threadreaderapp.com',
      template: 'https://threadreaderapp.com/thread/{id}.html', requires: ['id'],
      recover: /^\/thread\/(\d+)\.html\/?$/,
      note: 'Unrolls the whole thread. Needs a tweet link, not a profile.' },
  ];

  // Shipped as data, nothing enabled until the user picks it. `sameAs` names
  // the bundled redirector an entry is really an alias of, so the UI can say
  // so instead of presenting aliases as peers. Taking one of these writes an
  // ordinary entry into the user's own list, so there is one code path for
  // "a redirector the user chose" and no new storage shape; the definition
  // still comes from here, so a corrected template reaches them on upgrade.
  const CATALOGUE = [
    { id: 'fixupx', name: 'FixupX', group: 'embed', host: 'fixupx.com', sameAs: 'fxtwitter',
      template: 'https://fixupx.com/{path}{query}',
      note: 'FxTwitter under an x.com-shaped name. Same service, same output.' },
    { id: 'twittpr', name: 'Twittpr', group: 'embed', host: 'twittpr.com', sameAs: 'fxtwitter',
      template: 'https://twittpr.com/{path}{query}',
      note: 'FxTwitter again, useful when fxtwitter.com is filtered.' },
    { id: 'fixvx', name: 'FixVX', group: 'embed', host: 'fixvx.com', sameAs: 'vxtwitter',
      template: 'https://fixvx.com/{path}{query}',
      note: 'vxTwitter under another name. Same service.' },
    { id: 'fxtwitter-direct', name: 'FxTwitter (direct media)', group: 'embed', host: 'd.fxtwitter.com', sameAs: 'fxtwitter',
      template: 'https://d.fxtwitter.com/{path}', requires: ['id'],
      note: 'Jumps straight to the video or image file itself.' },
    { id: 'twitter-thread', name: 'twitter-thread.com', group: 'thread', host: 'twitter-thread.com',
      template: 'https://twitter-thread.com/t/{id}', requires: ['id'],
      recover: /^\/t\/(\d+)\/?$/,
      note: 'A second thread unroller. Needs a tweet link, not a profile.' },
  ];

  // Every host xIT itself vouches for: bundled or catalogue. isMirrorHost
  // reads these so a link already pointing at one can be retargeted, and the
  // main world accepts a config template only for one of them (S1).
  const PRESET_HOSTS = new Set(PRESETS.concat(CATALOGUE).map((p) => p.host));

  // Origins the reachability check may ask for. Only hosts xIT itself ships,
  // because `permissions.request` can only ask for an origin the manifest
  // declared as optional, and declaring a wildcard to cover templates the user
  // typed would be a far bigger permission than the feature is worth. A custom
  // template is therefore not checkable, and the UI says so. tools/build.mjs
  // reads this list for optional_host_permissions.
  const CHECK_ORIGINS = PRESETS.concat(CATALOGUE)
    .map((p) => 'https://' + p.host + '/')
    .filter((origin, at, all) => all.indexOf(origin) === at);

  /** The origin to request before checking this template, or null. */
  function checkOrigin(template) {
    const host = templateHost(template);
    if (!host) return null;
    const origin = 'https://' + host.toLowerCase() + '/';
    return CHECK_ORIGINS.includes(origin) ? origin : null;
  }

  function findCatalogue(id) {
    return CATALOGUE.find((c) => c.id === String(id)) || null;
  }

  // Front-ends xIT no longer offers. Links from them are still read, so a
  // pasted xcancel or Nitter URL can be converted to a supported redirector,
  // but nothing ever sends a user to these hosts.
  // xcancel and twiiit went after a cease and desist; unrollnow.com stopped
  // answering (503) and was retired in 1.0.8.
  const WITHDRAWN_HOSTS = new Set(['xcancel.com', 'twiiit.com', 'unrollnow.com']);

  // A redirector whose paths are not a plain x.com mirror has to say how to
  // read a status ID back out of one, or a link already on it cannot be
  // retargeted: it would be parsed as a username and converted to nonsense.
  // Any new entry with its own path shape belongs here, via `recover`.
  const RECOVER = new Map(PRESETS.concat(CATALOGUE)
    .filter((p) => p.recover)
    .map((p) => [p.host, p.recover])
    .concat([['unrollnow.com', /^\/status\/(\d+)\/?$/]]));

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
    return /(^|\.)nitter\b/.test(bare);
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
    const recover = RECOVER.get(mirror);
    if (recover) {
      const match = recover.exec(u.pathname);
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

  /**
   * Is this template pointed at one of the redirectors we ship?
   *
   * S1: the main world cannot authenticate the config it is handed, because
   * the only channel into a page's own context is postMessage, which every
   * script on the page can both read and send. So it does not trust the
   * template: it accepts one only when the host is a bundled preset. A page
   * script can still switch the user between two redirectors xIT ships, which
   * is a nuisance; it can no longer aim the native copy at a host it chose.
   */
  function isPresetTemplate(template) {
    const host = templateHost(template);
    if (!host) return false;
    return PRESET_HOSTS.has(host.toLowerCase());
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
    GROUPS, PRESETS, CATALOGUE, TOKENS, TRACKING_PARAMS, HOST_PATTERNS, CHECK_ORIGINS,
    parse, expand, convert, canonical, stripTracking,
    validateTemplate, templateHost, isPresetTemplate, findCatalogue, checkOrigin,
    isSourceHost, isMirrorHost, bareHost,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
