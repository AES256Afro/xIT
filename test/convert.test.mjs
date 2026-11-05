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
});

test('unrollnow is retired but its links are still readable', () => {
  // The host answered 503 and was removed in 1.0.8. Nothing may send a user
  // there, and a link somebody already has must still convert away from it.
  assert.equal(XIT.PRESETS.some((p) => p.id === 'unrollnow'), false);
  assert.equal(XIT.PRESETS.some((p) => p.host === 'unrollnow.com'), false);
  assert.equal(XIT.isMirrorHost('unrollnow.com'), true);
  assert.equal(conv('https://unrollnow.com/status/20', 'fxtwitter').url, 'https://fxtwitter.com/i/web/status/20');
  assert.equal(XIT.canonical('https://unrollnow.com/status/20'), 'https://x.com/i/web/status/20');
});

test('the host pattern list is the one the manifest is built from', () => {
  // B4: the popup gate, the menu patterns and the manifest all read this.
  assert.deepEqual(Array.from(XIT.HOST_PATTERNS), [
    '*://x.com/*', '*://www.x.com/*',
    '*://twitter.com/*', '*://www.twitter.com/*',
    '*://mobile.twitter.com/*', '*://m.twitter.com/*',
  ]);
  for (const pattern of XIT.HOST_PATTERNS) {
    const host = pattern.replace('*://', '').replace('/*', '');
    assert.equal(XIT.isSourceHost(host), true, host + ' should parse as a source host');
  }
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

/* -------------------------------------------------------------------- *
 * Milestone 2, the choice model
 * -------------------------------------------------------------------- */

test('three redirectors are bundled and the rest are a catalogue', () => {
  assert.deepEqual(Array.from(XIT.PRESETS.map((p) => p.id)), ['fxtwitter', 'vxtwitter', 'threadreader']);
  assert.deepEqual(Array.from(XIT.CATALOGUE.map((p) => p.id)),
    ['fixupx', 'twittpr', 'fixvx', 'fxtwitter-direct', 'twitter-thread']);
  // No ID may appear in both, or settings could not tell them apart.
  for (const entry of XIT.CATALOGUE) assert.equal(XIT.PRESETS.some((p) => p.id === entry.id), false, entry.id);
  // U6: an alias has to say what it is an alias of.
  for (const entry of XIT.CATALOGUE) {
    if (!entry.sameAs) continue;
    assert.ok(XIT.PRESETS.some((p) => p.id === entry.sameAs), entry.id + ' points at a bundled redirector');
  }
  assert.equal(XIT.findCatalogue('fixupx').host, 'fixupx.com');
  assert.equal(XIT.findCatalogue('fxtwitter'), null, 'a bundled preset is not in the catalogue');
  assert.equal(XIT.findCatalogue('nope'), null);
});

test('twitter-thread.com replaces Unroll Now', () => {
  const tt = XIT.findCatalogue('twitter-thread');
  assert.equal(XIT.convert('https://x.com/jack/status/20?s=20', tt).url, 'https://twitter-thread.com/t/20');
  assert.equal(XIT.convert('https://x.com/jack', tt).ok, false, 'it needs a tweet, not a profile');
  // And a link already on it can be moved somewhere else.
  assert.equal(XIT.isMirrorHost('twitter-thread.com'), true);
  assert.equal(conv('https://twitter-thread.com/t/20', 'fxtwitter').url, 'https://fxtwitter.com/i/web/status/20');
  assert.equal(XIT.canonical('https://twitter-thread.com/t/20'), 'https://x.com/i/web/status/20');
});

test('the main world vouches for catalogue hosts too, and nothing else', () => {
  for (const entry of XIT.PRESETS.concat(XIT.CATALOGUE)) {
    assert.equal(XIT.isPresetTemplate(entry.template), true, entry.id);
  }
  assert.equal(XIT.isPresetTemplate('https://evil.example/{path}'), false);
  assert.equal(XIT.isPresetTemplate('https://fxtwitter.com.evil.example/{path}'), false);
  assert.equal(XIT.isPresetTemplate('http://fxtwitter.com/{path}'), false, 'https only');
  assert.equal(XIT.isPresetTemplate('https://unrollnow.com/{path}'), false, 'a withdrawn host is not vouched for');
});

test('every redirector with its own path shape can be read back', () => {
  // A thread tool whose paths are not a plain x.com mirror must declare how to
  // recover the status ID, or a link already on it converts to nonsense. This
  // is the check that catches a new entry added without one.
  for (const entry of XIT.PRESETS.concat(XIT.CATALOGUE)) {
    const out = XIT.convert('https://x.com/jack/status/20', entry);
    if (!out.ok) continue;
    const back = XIT.canonical(out.url);
    const plainMirror = out.url === 'https://' + entry.host + '/jack/status/20';
    if (plainMirror) continue;
    assert.equal(back, 'https://x.com/i/web/status/20',
      entry.id + ' publishes ' + out.url + ' but cannot read it back');
  }
});

test('only the hosts xIT ships can be asked about', () => {
  // The manifest's optional_host_permissions is generated from this list, so a
  // template the user typed has no origin to request: permissions.request can
  // only ask for an origin declared in advance, and a wildcard covering
  // anything typed would be a far bigger ask than the check is worth.
  for (const entry of XIT.PRESETS.concat(XIT.CATALOGUE)) {
    assert.equal(XIT.checkOrigin(entry.template), 'https://' + entry.host + '/', entry.id);
  }
  assert.equal(XIT.checkOrigin('https://mine.example/{path}'), null);
  assert.equal(XIT.checkOrigin('https://fxtwitter.com.evil.example/{path}'), null);
  assert.equal(XIT.checkOrigin(''), null);
  assert.deepEqual(Array.from(XIT.CHECK_ORIGINS),
    ['https://fxtwitter.com/', 'https://vxtwitter.com/', 'https://threadreaderapp.com/',
      'https://fixupx.com/', 'https://twittpr.com/', 'https://fixvx.com/',
      'https://d.fxtwitter.com/', 'https://twitter-thread.com/']);
  // Withdrawn hosts are readable but never asked about: nothing sends a user
  // there, so their health is not a question xIT puts to the network.
  assert.equal(XIT.checkOrigin('https://unrollnow.com/{path}'), null);
  assert.equal(XIT.checkOrigin('https://xcancel.com/{path}'), null);
});

// Q4: formats are a presentation layer over a converted link. The markdown
// one has to survive characters that would otherwise break the link.
test('copy formats render a link three ways',()=>{
  const parts={user:'jack',id:'20'};
  const url='https://fxtwitter.com/jack/status/20';
  assert.equal(XIT.formatCopy(url,parts,'url'),url);
  assert.equal(XIT.formatCopy(url,parts,'author'),'@jack '+url);
  assert.equal(XIT.formatCopy(url,parts,'markdown'),'[@jack]('+url+')');
  // An unknown format is a bare link rather than a thrown error, because it
  // reaches here from stored settings.
  assert.equal(XIT.formatCopy(url,parts,'nonsense'),url);
  assert.equal(XIT.formatCopy(url,parts,undefined),url);
});

/*
 * B6: the version of this test that shipped in 1.2.0 built its own `parts`
 * object, `{id:'20'}`, which parse() never produces: for an authorless link it
 * reports user:'i', and 'i' is truthy. So the test passed while every
 * /i/web/status/ link copied as "@i". These go through parse() instead, which
 * is the only shape the formats ever actually see.
 */
test('an authorless link copies as a tweet, not as an account called i',()=>{
  for (const url of ['https://x.com/i/web/status/20','https://x.com/i/status/20']) {
    const parts=XIT.parse(url);
    assert.equal(parts.user,'i','parse still uses its sentinel, which is what made this a trap');
    assert.equal(XIT.handleOf(parts),null,'but nothing treats the sentinel as a handle');
    assert.equal(XIT.formatCopy('https://fx.com/i/web/status/20',parts,'markdown'),
      '[Tweet](https://fx.com/i/web/status/20)',url);
    assert.equal(XIT.formatCopy('https://fx.com/i/web/status/20',parts,'author'),
      'https://fx.com/i/web/status/20','no handle means no prefix at all');
  }
  // A link retargeted from a thread tool goes through the same path, which is
  // why this was a common case and not an edge one.
  const recovered=XIT.convert('https://threadreaderapp.com/thread/20.html',
    XIT.PRESETS.find((r)=>r.id==='fxtwitter'));
  assert.ok(recovered.ok);
  assert.equal(XIT.formatCopy(recovered.url,recovered.parts,'author'),recovered.url);
  // A real handle is still used.
  const real=XIT.parse('https://x.com/jack/status/20');
  assert.equal(XIT.handleOf(real),'jack');
  assert.equal(XIT.formatCopy('https://fx.com/jack/status/20',real,'author'),
    '@jack https://fx.com/jack/status/20');
  // Any other site feature that lands where the account goes is excluded too,
  // since the check is against RESERVED rather than against 'i' alone.
  assert.equal(XIT.handleOf({user:'search'}),null);
  assert.equal(XIT.handleOf({user:'settings'}),null);
  assert.equal(XIT.handleOf(null),null);
  assert.equal(XIT.handleOf({}),null);
});

test('{user} expands to nothing when the link names no account',()=>{
  // Same sentinel, reached through expand() rather than formatCopy: a template
  // of https://host/{user} used to produce https://host/i.
  const parts=XIT.parse('https://x.com/i/web/status/20');
  assert.equal(XIT.expand('https://mine.example/{user}',parts),'https://mine.example/');
  assert.equal(XIT.expand('https://mine.example/{user}',XIT.parse('https://x.com/jack/status/20')),
    'https://mine.example/jack');
});

test('copy formats cope with awkward URLs',()=>{
  // Parentheses would close the markdown destination early.
  const parts={user:'jack'};
  assert.equal(XIT.formatCopy('https://fx.com/a?q=(x)',parts,'markdown'),'[@jack](<https://fx.com/a?q=(x)>)');
  // Angle brackets would close the angle-bracket form early, so percent-encode.
  assert.equal(XIT.formatCopy('https://fx.com/a?q=(x)>y',parts,'markdown'),
    '[@jack](https://fx.com/a?q=%28x%29>y)');
  // A handle cannot contain brackets, but the escape is there if one ever does.
  assert.equal(XIT.formatCopy('https://fx.com/a',{user:'a]b'},'markdown'),'[@a\\]b](https://fx.com/a)');
});

// B7: the other half of the fix. storage.js infers requires:['user'] for a
// template that names {user} without {path}; this is what convert() does with
// it. Before the inference landed this branch was unreachable, and such a
// template silently produced a link pointing at the host root.
test('a redirector that needs an account refuses a link without one',()=>{
  const userOnly={id:'c-u',name:'User only',template:'https://mine.example/{user}',requires:['user']};
  const authorless=XIT.convert('https://x.com/i/web/status/20',userOnly);
  assert.equal(authorless.ok,false,'an authorless tweet is refused, not mangled');
  assert.match(authorless.reason,/account/);
  assert.equal(XIT.convert('https://x.com/search?q=a',userOnly).ok,false,'nor a search page');
  assert.equal(XIT.convert('https://x.com/home',userOnly).ok,false);
  // A link that does name one still converts.
  const real=XIT.convert('https://x.com/jack/status/20',userOnly);
  assert.equal(real.ok,true);
  assert.equal(real.url,'https://mine.example/jack');
  assert.equal(XIT.convert('https://x.com/jack',userOnly).url,'https://mine.example/jack');
});

// S6: a template from a file is rejected rather than truncated, because a
// shortened template is a broken one. The longest xIT ships is 44 characters.
test('an absurdly long template is refused with a reason',()=>{
  const long='https://e.example/'+'a'.repeat(5000)+'/{path}';
  const out=XIT.validateTemplate(long);
  assert.equal(out.ok,false);
  assert.match(out.error,/too long/);
  assert.ok(XIT.MAX_TEMPLATE>Math.max(...XIT.PRESETS.concat(XIT.CATALOGUE).map((r)=>r.template.length))*4,
    'with plenty of room for a real one');
  // At the limit it is still accepted, one past it is not.
  const fill=(n)=>'https://e.example/'+'a'.repeat(n)+'/{path}';
  const head='https://e.example/'.length+'/{path}'.length;
  assert.equal(XIT.validateTemplate(fill(XIT.MAX_TEMPLATE-head)).ok,true,'exactly at the limit');
  assert.equal(XIT.validateTemplate(fill(XIT.MAX_TEMPLATE-head+1)).ok,false,'one character over');
});
