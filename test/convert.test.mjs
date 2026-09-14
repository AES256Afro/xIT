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
    assert.equal(conv(`https://${host}/jack/status/20`, 'xcancel').url, 'https://xcancel.com/jack/status/20');
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
  assert.equal(conv('https://twitter.com/i/web/status/20', 'xcancel').url, 'https://xcancel.com/i/web/status/20');
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
  assert.equal(conv('https://fxtwitter.com/jack/status/20', 'xcancel').url, 'https://xcancel.com/jack/status/20');
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

test('browse rules compile for host-swap templates', () => {
  const rules = XIT.compileBrowseRules('https://xcancel.com/{path}{query}', { status: true, profile: true, other: true });
  assert.ok(rules.some(r => r.priority === 2));
  assert.ok(rules.every((r) => r.transform ? r.transform.host === 'xcancel.com' : r.regexSubstitution.startsWith('https://xcancel.com/')));
  // RE2 has no lookahead; make sure we never emit one.
  assert.ok(rules.every((r) => !/\(\?[=!<]/.test(r.regexFilter)));
});

test('browse rules compile for id templates, status scope only', () => {
  const rules = XIT.compileBrowseRules('https://threadreaderapp.com/thread/{id}.html', { status: true, profile: true, other: true });
  assert.equal(rules.length, 2);
  assert.equal(XIT.compileBrowseRules('https://threadreaderapp.com/thread/{id}.html', { profile: true }).length, 0);
});

test('direct-media template is not offered for browsing', () => {
  assert.equal(XIT.supportsBrowse(byId('fxtwitter-direct')), false);
  assert.equal(XIT.supportsBrowse(byId('fxtwitter')), true);
});

test('guard rules keep reserved paths and bypassed URLs out of redirects', () => {
  const guards = XIT.guardRules();
  assert.ok(guards.every((g) => g.action === 'allow'));
  const reserved = guards.find((g) => g.regexFilter.includes('notifications'));
  assert.ok(new RegExp(reserved.regexFilter).test('https://x.com/notifications'));
  assert.ok(!new RegExp(reserved.regexFilter).test('https://x.com/jack/status/20'));
  const bypass = guards.find((g) => g.regexFilter.includes('xit_bypass'));
  assert.ok(new RegExp(bypass.regexFilter).test('https://x.com/jack?xit_bypass=1'));
});

test('generated browse regexes match what they should', () => {
  const rules = XIT.compileBrowseRules(
    'https://xcancel.com/{path}{query}', { status: true, profile: true, other: true });
  const [status, iStatus] = rules;
  const profile = rules.find(r => r.priority === 2);
  const other = rules.find(r => r.priority === 1);
  assert.ok(new RegExp(status.regexFilter).test('https://x.com/jack/status/20'));
  assert.ok(!new RegExp(status.regexFilter).test('https://x.com/jack'));
  assert.ok(new RegExp(iStatus.regexFilter).test('https://x.com/i/web/status/20'));
  assert.ok(new RegExp(profile.regexFilter).test('https://x.com/jack'));
  assert.ok(!new RegExp(profile.regexFilter).test('https://x.com/jack/status/20'));
  assert.ok(new RegExp(other.regexFilter).test('https://x.com/search?q=hi'));
});

test('reserved routes and bypass values match complete segments', () => {
  const guards=XIT.guardRules();
  const allowed=url=>guards.some(r=>new RegExp(r.regexFilter).test(url));
  for(const p of ['home','home?lang=en','settings/account','i/lists/20']) assert.equal(allowed('https://x.com/'+p),true,p);
  for(const p of ['homegrown','topicsmith','jobsmith','jack?xit_bypass=10','jack?xit_bypass=1no','jack#?xit_bypass=1']) assert.equal(allowed('https://x.com/'+p),false,p);
  assert.equal(allowed('https://x.com/jack?xit_bypass=1&lang=en'),true);
});

test('destination hostname and origin survive www, ports, and IPv6', () => {
  for(const [authority,hostname] of [['www.example.com','www.example.com'],['www.example.com:8443','www.example.com'],['[::1]:8443','[::1]']]) {
    const t='https://'+authority+'/{path}{query}';
    assert.equal(XIT.validateTemplate(t).ok,true);
    assert.equal(XIT.templateHost(t),hostname);
    assert.equal(XIT.templateOrigin(t),'https://'+authority);
    assert.equal(XIT.permissionOrigin(t),'https://'+hostname+'/*');
    assert.equal(XIT.convert('https://x.com/jack/status/20',{template:t}).url,'https://'+authority+'/jack/status/20');
    assert.ok(XIT.compileBrowseRules(t,{status:true}).every(r=>r.regexSubstitution==='https://'+authority+'/\\1'));
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
