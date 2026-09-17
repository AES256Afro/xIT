import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ctx = vm.createContext({ console, URL, URLSearchParams, JSON });
vm.runInContext(readFileSync(path.join(ROOT, 'src/lib/redirectors.js'), 'utf8'), ctx);
const XIT = ctx.XIT;

const byId = (id) => XIT.PRESETS.find((p) => p.id === id);
const conv = (url, id, opts) => XIT.convert(url, byId(id), opts);

test('rewrites a plain tweet link', () => {
  assert.equal(conv('https://x.com/jack/status/20', 'fxtwitter').url, 'https://fxtwitter.com/jack/status/20');
});

test('accepts twitter.com, www and mobile hosts', () => {
  for (const host of ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'www.x.com']) {
    assert.equal(conv(`https://${host}/jack/status/20`, 'vxtwitter').url, 'https://vxtwitter.com/jack/status/20');
  }
});

test('strips share tracking by default and keeps real params', () => {
  assert.equal(conv('https://x.com/jack/status/20?s=20&t=abc', 'fxtwitter').url, 'https://fxtwitter.com/jack/status/20');
  assert.equal(conv('https://x.com/jack/status/20?lang=en', 'fxtwitter').url, 'https://fxtwitter.com/jack/status/20?lang=en');
});

test('keeps tracking when asked to', () => {
  assert.equal(
    conv('https://x.com/jack/status/20?s=20', 'fxtwitter', { stripTracking: false }).url,
    'https://fxtwitter.com/jack/status/20?s=20'
  );
});

test('preserves photo and video sub-paths', () => {
  assert.equal(conv('https://x.com/jack/status/20/photo/2', 'vxtwitter').url, 'https://vxtwitter.com/jack/status/20/photo/2');
});

test('handles the /i/web/status form', () => {
  const p = XIT.parse('https://twitter.com/i/web/status/20');
  assert.equal(p.kind, 'status');
  assert.equal(p.id, '20');
  assert.equal(conv('https://twitter.com/i/web/status/20', 'vxtwitter').url, 'https://vxtwitter.com/i/web/status/20');
});

test('templates that need a tweet id refuse a profile link', () => {
  const r = conv('https://x.com/jack', 'threadreader');
  assert.equal(r.ok, false);
  assert.match(r.reason, /specific tweet/);
});

test('thread tools build their own path shape', () => {
  assert.equal(conv('https://x.com/jack/status/20', 'threadreader').url, 'https://threadreaderapp.com/thread/20.html');
  assert.equal(conv('https://x.com/jack/status/20', 'unrollnow').url, 'https://unrollnow.com/status/20');
});

test('profiles are recognised but site features are not', () => {
  assert.equal(XIT.parse('https://x.com/jack').kind, 'profile');
  assert.equal(XIT.parse('https://x.com/home').kind, 'other');
  assert.equal(XIT.parse('https://x.com/settings').kind, 'other');
  assert.equal(XIT.parse('https://x.com/i/lists/123').kind, 'other');
});

test('non-twitter and non-http URLs are rejected', () => {
  assert.equal(XIT.parse('https://example.com/jack/status/20'), null);
  assert.equal(XIT.parse('javascript:alert(1)'), null);
  assert.equal(XIT.parse('not a url'), null);
  assert.equal(XIT.parse(''), null);
  assert.equal(XIT.parse(null), null);
});

test('an already-redirected link can be retargeted', () => {
  assert.equal(conv('https://fxtwitter.com/jack/status/20', 'vxtwitter').url, 'https://vxtwitter.com/jack/status/20');
  assert.equal(conv('https://nitter.net/jack/status/20', 'fxtwitter').url, 'https://fxtwitter.com/jack/status/20');
});

test('converting to the site it already points at is refused', () => {
  const r = conv('https://fxtwitter.com/jack/status/20', 'fxtwitter');
  assert.equal(r.ok, false);
});

test('canonical returns a clean x.com URL', () => {
  assert.equal(XIT.canonical('https://mobile.twitter.com/jack/status/20?s=20'), 'https://x.com/jack/status/20');
  assert.equal(XIT.canonical('https://xcancel.com/jack/status/20'), 'https://x.com/jack/status/20');
});

test('template validation catches the usual mistakes', () => {
  assert.equal(XIT.validateTemplate('https://a.com/{path}{query}').ok, true);
  assert.equal(XIT.validateTemplate('http://a.com/{path}').ok, false, 'must be https');
  assert.equal(XIT.validateTemplate('https://a.com/').ok, false, 'needs a token');
  assert.equal(XIT.validateTemplate('https://a.com/{nope}').ok, false, 'unknown token');
  assert.equal(XIT.validateTemplate('').ok, false);
});

test('custom templates convert', () => {
  const custom = { name: 'Mine', template: 'https://n.example.com/{user}/status/{id}', requires: ['id'] };
  assert.equal(XIT.convert('https://x.com/jack/status/20?s=1', custom).url, 'https://n.example.com/jack/status/20');
});

test('custom template hostnames survive www, ports, and IPv6', () => {
  for(const [authority,hostname] of [['www.example.com','www.example.com'],['www.example.com:8443','www.example.com'],['[::1]:8443','[::1]']]) {
    const t='https://'+authority+'/{path}{query}';
    assert.equal(XIT.validateTemplate(t).ok,true);
    assert.equal(XIT.templateHost(t),hostname);
    assert.equal(XIT.convert('https://x.com/jack/status/20',{template:t}).url,'https://'+authority+'/jack/status/20');
  }
});

test('credentials and substitution escape characters are refused', () => {
  assert.equal(XIT.validateTemplate('https://user:pass@example.com/{path}').ok,false);
  assert.equal(XIT.validateTemplate('https://example.com/\\1/{id}').ok,false);
  assert.equal(XIT.templateHost('https://{user}.example.com/{id}'),null);
});

test('thread tool URLs retarget through the recovered tweet ID', () => {
  for(const url of ['https://threadreaderapp.com/thread/20.html','https://unrollnow.com/status/20']) {
    assert.equal(conv(url,'fxtwitter').url,'https://fxtwitter.com/i/web/status/20');
    assert.equal(XIT.canonical(url),'https://x.com/i/web/status/20');
  }
  assert.equal(XIT.parse('https://threadreaderapp.com/about'),null);
});

test('Open on X canonicalizes mirrors without adding parameters', () => {
  // There is no page redirect to bypass any more, so nothing is appended.
  assert.equal(XIT.canonical('https://fxtwitter.com/jack/status/20?s=20&lang=en'), 'https://x.com/jack/status/20?lang=en');
  assert.equal(XIT.canonical('https://x.com/jack/status/20#photo'), 'https://x.com/jack/status/20#photo');
  assert.equal(XIT.canonical('https://threadreaderapp.com/thread/20.html'), 'https://x.com/i/web/status/20');
  assert.equal(XIT.canonical('https://example.com/not-a-tweet'), null);
});

test('withdrawn front-ends are no longer offered', () => {
  const hosts = XIT.PRESETS.map((p) => p.host);
  for (const withdrawn of ['xcancel.com', 'twiiit.com']) assert.equal(hosts.includes(withdrawn), false, withdrawn);
  assert.equal(hosts.some((h) => /nitter/.test(h)), false, 'no Nitter instance');
  assert.equal(XIT.GROUPS.some((g) => g.id === 'privacy'), false, 'no privacy front-end group');
  for (const id of ['xcancel', 'twiiit', 'nitter-net', 'nitter-poast', 'nitter-privacydev']) assert.equal(byId(id), undefined, id);
});

test('links from withdrawn front-ends can still be converted away from them', () => {
  // Reading these hosts is kept on purpose: it moves users off them.
  for (const url of ['https://xcancel.com/jack/status/20', 'https://twiiit.com/jack/status/20', 'https://nitter.poast.org/jack/status/20']) {
    assert.equal(conv(url, 'fxtwitter').url, 'https://fxtwitter.com/jack/status/20', url);
    assert.equal(XIT.canonical(url), 'https://x.com/jack/status/20', url);
  }
});

test('the redirect engine is not exported', () => {
  for (const name of ['compileBrowseRules', 'guardRules', 'supportsBrowse', 'originalUrl', 'permissionOrigin', 'templateOrigin', 'BYPASS_PARAM']) {
    assert.equal(name in XIT, false, name);
  }
});
