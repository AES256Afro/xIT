import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fakeI18n } from './helpers/i18n-stub.mjs';
import { readFileSync } from 'node:fs';

function harness() {
  let data = {};
  let failNext = false;
  let background;
  const changes = [];
  const session = {};
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    runtime: {
      sendMessage(message, cb) {
        background.mutate(copy(message.operation)).then(settings => cb({ok:true,settings:copy(settings)}),error=>cb({ok:false,error:error.message}));
      },
    },
    storage: {
      session: {
        get(key, cb) { setImmediate(() => cb(copy(session))); },
        set(value, cb) { Object.assign(session, copy(value)); setImmediate(cb); },
        // Both browsers take a key or a list of them. This stub took only a
        // key, so a call passing a list deleted nothing and said nothing: a
        // test of one would have passed without the code working.
        remove(key, cb) { for (const k of [].concat(key)) delete session[k]; setImmediate(cb); },
      },
      local: {
        get(key, cb) { const snapshot=copy(data); setImmediate(()=>cb(snapshot)); },
        set(value, cb) {
          setImmediate(()=>{
            if(failNext) { failNext=false;api.runtime.lastError={message:'disk unavailable'};cb();delete api.runtime.lastError;return; }
            Object.assign(data,copy(value));
            changes.forEach(fn=>fn({settings:{newValue:copy(data.settings)}},'local'));
            cb();
          });
        },
        remove(key,cb) { for (const k of [].concat(key)) delete data[k]; setImmediate(cb); },
      },
      onChanged:{addListener:fn=>changes.push(fn)},
    },
  };
  function context() {
    // i18n.js loads alongside the other libraries in every real context, with
    // the shipped catalogue behind it, so a rejection message asserted below
    // is the message a user would actually read.
    const ctx=vm.createContext({chrome:{...api,i18n:fakeI18n()},URL,URLSearchParams,console:{warn(){}}});
    for(const file of ['i18n','redirectors','storage']) vm.runInContext(readFileSync(new URL('../src/lib/'+file+'.js',import.meta.url),'utf8'),ctx);
    return ctx.XITStore;
  }
  background=context();background.startWriter();
  return {background,context,get:()=>copy(data),fail:()=>{failNext=true;},
    seed:value=>{data.settings=copy(value);},
    seedLocal:(key,value)=>{data[key]=copy(value);}};
}

test('writes from separate contexts preserve unrelated changes',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  await Promise.all([a.save({toast:false,copyButton:false}),b.save({stripTracking:false,contextMenu:false})]);
  const s=await a.load();
  assert.equal(s.toast,false);assert.equal(s.copyButton,false);
  assert.equal(s.stripTracking,false);assert.equal(s.contextMenu,false);
});

test('custom entries enable once, remain disabled after reload and import, and do not collide',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  await Promise.all([a.addCustom({name:'Test',template:'https://www.example.com/{path}'}),b.addCustom({name:'Test',template:'https://example.net/{path}'})]);
  let s=await a.load();assert.equal(s.custom.length,2);
  assert.equal(new Set(s.custom.map(c=>c.id)).size,2);
  assert.ok(s.custom.every(c=>s.enabledIds.includes(c.id)));
  const id=s.custom[0].id;await a.setEnabled(id,false);
  s=await b.load();assert.ok(!s.enabledIds.includes(id));
  await a.replace(JSON.parse(JSON.stringify(s)));
  assert.ok(!(await b.load()).enabledIds.includes(id));
  await a.removeCustom(id);assert.equal((await b.load()).custom.length,1);
});

test('concurrent individual enable changes and custom additions do not overwrite lists',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  await Promise.all([a.setEnabled('fixupx',false),b.setEnabled('vxtwitter',false),b.addCustom({name:'New',template:'https://example.com/{path}'})]);
  const s=await a.load();assert.ok(!s.enabledIds.includes('fixupx'));assert.ok(!s.enabledIds.includes('vxtwitter'));
  assert.ok(s.enabledIds.includes(s.custom[0].id));
});

test('import removes preset ID collisions, duplicates and unknown settings fields',async()=>{
  const h=harness();const s=await h.context().replace({custom:[
    {id:'fxtwitter',template:'https://example.com/{path}'},
    {id:'c-ok',template:'https://example.com/{path}'},
    {id:'c-ok',template:'https://example.net/{path}'},
  ],enabledIds:['c-ok','c-ok'],unexpected:'discard'});
  assert.equal(s.custom.length,1);assert.equal(s.custom[0].id,'c-ok');
  assert.equal(s.enabledIds.length,1);assert.equal(s.unexpected,undefined);
});

test('a failed storage write is reported and the writer continues afterward',async()=>{
  const h=harness(),a=h.context();h.fail();
  await assert.rejects(a.save({toast:false}),/disk unavailable/);
  await a.save({stripTracking:false});assert.equal((await a.load()).stripTracking,false);
});

test('reset restores defaults through the same writer and rejects invalid imports',async()=>{
  const h=harness(),a=h.context();await a.save({toast:false});await a.reset();
  assert.equal((await a.load()).toast,true);
  await assert.rejects(a.replace([]),/JSON object/);
});

test('reset takes the observations stored outside settings with it',async()=>{
  // C13. Both of these live outside settings on purpose, which is also why
  // neither was cleared: resetting replaces the settings key and nothing
  // else. A reachability badge that outlives a reset reads as a fact about
  // the extension, and carries a timestamp from before the reset.
  //
  // Dropping either key from the remove call makes this fail.
  const h=harness(),a=h.context();
  h.seedLocal('hostChecks',{fxtwitter:{state:'refused',at:1}});
  h.seedLocal('lastCopyFailure',{text:'synthetic',at:1});
  await a.reset();
  assert.equal(h.get().hostChecks,undefined,'reachability results are gone');
  assert.equal(h.get().lastCopyFailure,undefined,'and so is the copy failure');
});

test('pins have a stable shared order, survive reload, and do not change the default',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  await Promise.all([a.setPinned('threadreader',true),b.setPinned('vxtwitter',true)]);
  await b.movePinned('vxtwitter',-1);
  let s=await a.load();
  assert.deepEqual(Array.from(s.pinnedIds),['vxtwitter','threadreader']);
  assert.deepEqual(Array.from(a.enabledRedirectors(s).slice(0,2),r=>r.id),['vxtwitter','threadreader']);
  assert.equal(s.defaultRedirector,'fxtwitter');
  await a.setEnabled('vxtwitter',false);
  s=await b.load();assert.equal(b.enabledRedirectors(s)[0].id,'threadreader');
  await a.replace(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(Array.from((await a.load()).pinnedIds),['vxtwitter','threadreader']);
});

test('editing and duplicating custom entries preserve identity and existing selections',async()=>{
  const h=harness(),a=h.context();
  let s=await a.addCustom({name:'My instance',template:'https://one.example/{path}'});
  const id=s.custom[0].id;
  await a.save({defaultRedirector:id});
  await a.setPinned(id,true);
  s=await a.editCustom(id,{name:'Renamed',template:'https://two.example:8443/{path}'});
  assert.equal(s.custom[0].id,id);assert.equal(s.defaultRedirector,id);
  assert.ok(s.pinnedIds.includes(id));
  await a.setEnabled(id,false);
  s=await a.editCustom(id,{name:'Still disabled',template:'https://three.example/{path}'});
  assert.ok(!s.enabledIds.includes(id));
  s=await a.duplicateCustom(id);
  assert.equal(s.custom.length,2);assert.notEqual(s.custom[1].id,id);
  assert.ok(s.enabledIds.includes(s.custom[1].id));
  await assert.rejects(a.editCustom(id,{name:'Bad',template:'http://example.com/{path}'}),/https/);
});

test('undo restores the removed entry and selections without undoing unrelated changes',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  const s=await a.addCustom({name:'Undo me',template:'https://example.com/{path}'});
  const id=s.custom[0].id;
  await a.save({defaultRedirector:id});await a.setPinned(id,true);
  await a.removeCustom(id);
  assert.equal((await b.getUndo()).entry.id,id);
  await b.save({toast:false});
  const restored=await b.restoreCustom();
  assert.equal(restored.toast,false);assert.equal(restored.defaultRedirector,id);
  assert.ok(restored.pinnedIds.includes(id));assert.ok(restored.enabledIds.includes(id));assert.equal(await a.getUndo(),null);
  await a.removeCustom(id);await b.save({defaultRedirector:'vxtwitter'});
  assert.equal((await a.restoreCustom()).defaultRedirector,'vxtwitter');
  await a.removeCustom(id);await b.reset();assert.equal(await a.getUndo(),null);
});

test('settings saved by 1.0.3 drop page redirecting and fall back from withdrawn front-ends',async()=>{
  const h=harness(),a=h.context();
  h.seed({
    defaultRedirector:'xcancel',
    enabledIds:['xcancel','fxtwitter','nitter-net','vxtwitter','twiiit'],
    pinnedIds:['xcancel','vxtwitter','nitter-poast'],
    toast:false,
    browseRedirect:true,browseRedirectorId:'xcancel',
    browseScope:{status:true,profile:true,other:false},browsePausedUntil:Date.now()+60000,
  });
  const s=await a.load();
  assert.equal(s.defaultRedirector,'fxtwitter','a withdrawn default falls back');
  assert.deepEqual(Array.from(s.enabledIds),['fxtwitter','vxtwitter']);
  assert.deepEqual(Array.from(s.pinnedIds),['vxtwitter']);
  assert.equal(s.toast,false,'unrelated choices survive');
  for(const key of ['browseRedirect','browseRedirectorId','browseScope','browsePausedUntil']) assert.equal(key in s,false,key);
  // normalize() hides the old keys; rewrite removes them from stored data.
  assert.equal(h.get().settings.browseRedirectorId,'xcancel');
  await a.mutate({type:'rewrite'});
  const stored=h.get().settings;
  for(const key of ['browseRedirect','browseRedirectorId','browseScope','browsePausedUntil']) assert.equal(key in stored,false,key);
  assert.equal(JSON.stringify(stored).match(/xcancel|nitter|twiiit/),null,'no withdrawn front-end left in storage');
});

/* -------------------------------------------------------------------- *
 * Milestone 2, the choice model
 * -------------------------------------------------------------------- */

test('install enables three redirectors, not eight',async()=>{
  const h=harness(),a=h.context();
  const s=await a.load();
  assert.deepEqual(Array.from(s.enabledIds),['fxtwitter','vxtwitter','threadreader']);
  assert.equal(s.defaultRedirector,'fxtwitter');
  assert.deepEqual(Array.from(s.custom),[]);
  // The rest are shipped as data, chosen rather than pre-ticked.
  const catalogue=['fixupx','twittpr','fixvx','fxtwitter-direct','twitter-thread'];
  for(const id of catalogue) assert.equal(s.enabledIds.includes(id),false,id);
  // Each one is still a redirector the user can take, by name.
  for(const id of catalogue){
    const taken=await a.setEnabled(id,true);
    assert.ok(taken.custom.some((c)=>c.id===id&&c.catalogue===true),id);
    await a.removeCustom(id);
  }
});

test('an upgrader keeps the catalogue redirectors they had chosen',async()=>{
  // Five presets became catalogue entries in 1.1.0. Dropping them would have
  // silently moved anybody whose default was FixupX back to FxTwitter.
  const h=harness(),a=h.context();
  h.seed({
    defaultRedirector:'fixupx',
    enabledIds:['fxtwitter','fixupx','twittpr','threadreader'],
    pinnedIds:['fxtwitter-direct'],
    toast:false,
  });
  const s=await a.load();
  assert.equal(s.defaultRedirector,'fixupx','their default survives');
  assert.deepEqual(Array.from(s.custom.map((c)=>c.id)),['fixupx','twittpr','fxtwitter-direct']);
  assert.deepEqual(Array.from(s.enabledIds),['fxtwitter','fixupx','twittpr','threadreader']);
  assert.deepEqual(Array.from(s.pinnedIds),['fxtwitter-direct']);
  assert.equal(s.toast,false);
  for(const entry of s.custom){
    assert.equal(entry.catalogue,true,entry.id);
    assert.equal(entry.custom,undefined,'a catalogue entry is not something the user typed');
  }
  // It keeps the catalogue's own definition, so a corrected template reaches
  // somebody who already took it.
  assert.equal(s.custom[0].template,'https://fixupx.com/{path}{query}');
  assert.equal(s.custom[0].group,'embed','and stays with its own kind, not under Custom');
  assert.equal(s.custom[0].sameAs,'fxtwitter','and says what it is really an alias of');
});

test('a catalogue entry is taken by enabling it, and can be dropped again',async()=>{
  const h=harness(),a=h.context();
  const added=await a.setEnabled('twitter-thread',true);
  assert.ok(added.enabledIds.includes('twitter-thread'));
  assert.deepEqual(Array.from(added.custom.map((c)=>c.id)),['twitter-thread']);
  assert.equal(added.custom[0].requires.includes('id'),true);
  // Unticking leaves it in the list, the way an unticked preset stays.
  const off=await a.setEnabled('twitter-thread',false);
  assert.equal(off.enabledIds.includes('twitter-thread'),false);
  assert.deepEqual(Array.from(off.custom.map((c)=>c.id)),['twitter-thread']);
  const gone=await a.removeCustom('twitter-thread');
  assert.deepEqual(Array.from(gone.custom),[]);
});

test('a template the user typed is stored verbatim, a catalogue one is not',async()=>{
  const h=harness(),a=h.context();
  const s=await a.addCustom({name:'My instance',template:'https://mine.example/{path}'});
  const own=s.custom.find((c)=>c.template==='https://mine.example/{path}');
  assert.equal(own.custom,true);
  assert.equal(own.group,'custom');
  assert.equal(own.name,'My instance');
});

test('the right-click menu is capped at the default and the pins',async()=>{
  const h=harness(),a=h.context();
  let s=await a.load();
  assert.deepEqual(Array.from(a.menuRedirectors(s).map((r)=>r.id)),['fxtwitter'],
    'the default alone, until something is pinned');
  s=await a.setPinned('threadreader',true);
  assert.deepEqual(Array.from(a.menuRedirectors(s).map((r)=>r.id)),['fxtwitter','threadreader']);
  // A pin that is not enabled is not offered.
  s=await a.setEnabled('threadreader',false);
  assert.deepEqual(Array.from(a.menuRedirectors(s).map((r)=>r.id)),['fxtwitter']);
  s=await a.save({enabledIds:['fxtwitter','vxtwitter','threadreader'],contextMenuAll:true});
  assert.deepEqual(Array.from(a.menuRedirectors(s).map((r)=>r.id)),
    ['threadreader','fxtwitter','vxtwitter'],'asking for everything gets everything');
});

test('only a change the menu is built from changes its signature',async()=>{
  const h=harness(),a=h.context();
  const base=await a.load();
  const sig=(s)=>a.menuSignature(s);
  assert.equal(sig(await a.save({toast:false})),sig(base),'the toast is not in the menu');
  assert.equal(sig(await a.save({stripTracking:false})),sig(base));
  assert.notEqual(sig(await a.setPinned('vxtwitter',true)),sig(base),'a pin is');
  assert.notEqual(sig(await a.save({contextMenuAll:true})),sig(base));
  assert.equal(sig(await a.save({contextMenu:false})),'off');
});

// O3 replaced a find-per-pinned-id and an includes-per-entry with two indexes.
// The indexes are what could go wrong, so this pins the behaviour they carry:
// pinned order, no entry in two groups at once, and a pin that is not enabled
// being dropped rather than appearing as a hole.
test('grouping follows pinned order and never lists an entry twice',async()=>{
  const h=harness(),a=h.context();
  let s=await a.save({enabledIds:['fxtwitter','vxtwitter','threadreader']});
  s=await a.setPinned('threadreader',true);
  s=await a.setPinned('fxtwitter',true);
  const groups=a.redirectorGroups(s);
  assert.deepEqual(Array.from(groups[0].entries.map((r)=>r.id)),['threadreader','fxtwitter'],
    'the pinned group is in pin order, not preset order');
  const seen=Array.from(groups.flatMap((g)=>g.entries.map((r)=>r.id)));
  assert.deepEqual(Array.from(seen).sort(),['fxtwitter','threadreader','vxtwitter'],
    'every enabled entry appears exactly once');
  assert.deepEqual(Array.from(groups.slice(1).flatMap((g)=>g.entries.map((r)=>r.id))),['vxtwitter'],
    'a pinned entry is not repeated under its own group');
  // A pin whose entry is disabled is dropped, not carried through as a gap.
  s=await a.setEnabled('threadreader',false);
  assert.deepEqual(Array.from(a.redirectorGroups(s)[0].entries.map((r)=>r.id)),['fxtwitter']);
  // Asking for the full list includes the disabled entry, still only once.
  const all=Array.from(a.redirectorGroups(s,false).flatMap((g)=>g.entries.map((r)=>r.id)));
  assert.equal(all.length,new Set(all).size,'no duplicates when disabled entries are shown');
  assert.ok(all.includes('threadreader'));
});

// Q2: a merge takes their redirectors and leaves their choices behind.
test('import can merge somebody else\'s redirectors without their choices',async()=>{
  const h=harness(),a=h.context();
  let s=await a.addCustom({name:'Mine',template:'https://mine.example/{path}'});
  s=await a.save({defaultRedirector:'vxtwitter'});
  s=await a.setPinned('vxtwitter',true);
  s=await a.merge({
    defaultRedirector:'threadreader',
    pinnedIds:['threadreader'],
    stripTracking:false,
    custom:[
      {id:'c-theirs',name:'Theirs',template:'https://theirs.example/{path}'},
      {id:'c-mine',name:'Mine renamed',template:'https://mine.example/{path}'},
      {id:'c-broken',name:'Broken',template:'not a url'},
    ],
  });
  assert.equal(s.defaultRedirector,'vxtwitter','their default does not cross over');
  assert.deepEqual(Array.from(s.pinnedIds),['vxtwitter'],'nor their pins');
  assert.equal(s.stripTracking,true,'nor their switches');
  const templates=Array.from(s.custom.map((c)=>c.template));
  assert.deepEqual(templates,['https://mine.example/{path}','https://theirs.example/{path}'],
    'the one I already have is not duplicated, and the invalid one is skipped');
  assert.ok(Array.from(s.enabledIds).includes('c-theirs'),'what arrives is usable straight away');
});

test('a merge gives a colliding id a fresh one and keeps catalogue entries ours',async()=>{
  const h=harness(),a=h.context();
  // Same id, different redirector: mine must survive untouched.
  let s=await a.addCustom({name:'Shared name',template:'https://first.example/{path}'});
  const mineId=Array.from(s.custom.map((c)=>c.id))[0];
  s=await a.merge({custom:[
    {id:mineId,name:'Shared name',template:'https://second.example/{path}'},
    // A catalogue entry they had taken, sent with a name they invented.
    {id:'fixupx',name:'Their silly label',template:'https://fixupx.com/{path}{query}'},
  ]});
  assert.equal(s.custom.length,3);
  const byId=new Map(Array.from(s.custom.map((c)=>[c.id,c])));
  assert.equal(byId.get(mineId).template,'https://first.example/{path}','mine is not overwritten');
  assert.ok(Array.from(byId.keys()).some((id)=>id!==mineId&&id.startsWith('c-shared-name')),
    'theirs lands on a derived id');
  assert.ok(byId.has('fixupx'),'a catalogue id is kept, not renamed');
  // normalize() fills a catalogue id in from our own CATALOGUE, so the name
  // that comes back is ours and their label is discarded.
  assert.equal(byId.get('fixupx').name,'FixupX','our definition wins, not their label');
  assert.equal(byId.get('fixupx').catalogue,true,'and it is still a catalogue entry, not a custom one');
});

// U7: ordering applies to unpinned entries only, in every list.
test('list ordering sorts the unpinned entries and leaves pins alone',async()=>{
  const h=harness(),a=h.context();
  let s=await a.save({enabledIds:['fxtwitter','vxtwitter','threadreader']});
  // Pins in deliberate reverse-alphabetical order, to prove they survive it.
  s=await a.setPinned('vxtwitter',true);
  s=await a.setPinned('fxtwitter',true);
  const names=(st)=>a.redirectorGroups(st,false).map((g)=>Array.from(g.entries.map((r)=>r.name)));
  const asGrouped=names(s);
  s=await a.save({listSort:'name'});
  const byName=names(s);
  assert.deepEqual(asGrouped[0],['vxTwitter','FxTwitter'],'pin order is the order they were pinned');
  assert.deepEqual(byName[0],['vxTwitter','FxTwitter'],'and sorting does not touch it');
  // Every unpinned group is alphabetical once sorted.
  for (const group of byName.slice(1)) {
    assert.deepEqual(group,Array.from(group).slice().sort((x,y)=>x.localeCompare(y)),
      'unpinned entries are alphabetical: '+group.join(', '));
  }
  // And the same set of entries either way, just reordered.
  assert.deepEqual(asGrouped.flat().slice().sort(),byName.flat().slice().sort());
});

test('an unknown copy format or sort order falls back to the default',async()=>{
  const h=harness(),a=h.context();
  let s=await a.save({copyFormat:'telepathy',listSort:'vibes'});
  assert.equal(s.copyFormat,'url');
  assert.equal(s.listSort,'group');
  s=await a.save({copyFormat:'markdown',listSort:'name'});
  assert.equal(s.copyFormat,'markdown','a real one is kept');
  assert.equal(s.listSort,'name');
});

// B7: {path} carries the account and the status id for any link that has
// them, so a template using it needs nothing in particular. One naming {id}
// or {user} on its own does, and only {id} was ever inferred, which left
// convert()'s requires-'user' branch unreachable.
test('a template is told what it cannot do without',async()=>{
  const h=harness(),a=h.context();
  let s=await a.addCustom({name:'User only',template:'https://mine.example/{user}'});
  s=await a.addCustom({name:'Id only',template:'https://mine.example/{id}'});
  s=await a.addCustom({name:'Both',template:'https://mine.example/{user}/s/{id}'});
  s=await a.addCustom({name:'Path',template:'https://mine.example/{path}{query}'});
  const req=(name)=>Array.from(s.custom.find((c)=>c.name===name).requires);
  assert.deepEqual(req('User only'),['user']);
  assert.deepEqual(req('Id only'),['id']);
  assert.deepEqual(req('Both'),['id','user']);
  assert.deepEqual(req('Path'),[],'{path} needs nothing in particular');
  // What convert() then does with that is asserted in convert.test.mjs, which
  // is where the library under test actually lives.
});

// B8: "do I already have this?" was keyed on the user's own entries only, so
// a file carrying FxTwitter as an entry of its own added a second one.
test('a merge does not add a redirector xIT already bundles',async()=>{
  const h=harness(),a=h.context();
  let s=await a.load();
  const before=s.custom.length;
  s=await a.merge({custom:[
    {id:'c-theirs',name:'Their FxTwitter',template:'https://fxtwitter.com/{path}{query}'},
    {id:'c-thread',name:'Their thread reader',template:'https://threadreaderapp.com/thread/{id}.html'},
    {id:'c-new',name:'Something new',template:'https://new.example/{path}'},
  ]});
  const templates=Array.from(s.custom.map((c)=>c.template));
  assert.deepEqual(templates,['https://new.example/{path}'],
    'only the one that is not already available crosses over');
  assert.equal(s.custom.length,before+1);
});

// B9: a taken id was replaced and an invalid one was not, so an entry whose
// id merely had a space in it was added and then dropped by normalize.
test('a merge keeps an entry whose id would not survive normalize',async()=>{
  const h=harness(),a=h.context();
  let s=await a.merge({custom:[
    {id:'has a space',name:'Spaced',template:'https://sp.example/{path}'},
    {id:'',name:'No id at all',template:'https://noid.example/{path}'},
    {id:'way-too-long-'.repeat(20),name:'Long id',template:'https://long.example/{path}'},
  ]});
  const names=Array.from(s.custom.map((c)=>c.name)).sort();
  assert.deepEqual(names,['Long id','No id at all','Spaced'],'all three survive');
  for (const c of s.custom) {
    assert.match(c.id,/^[a-zA-Z0-9_-]{1,80}$/,c.name+' got a usable id: '+c.id);
    assert.match(c.id,/^c-/,'derived from the name, like any other new entry');
  }
});

// S6: a redirector from a file was bounded in every field but the ones a
// person reads. Nothing here is injection, since both are rendered as
// textContent; an unbounded one is a file that puts 100 KB into storage, into
// the list, into the popup and into a context-menu title.
test('a redirector from a file cannot carry an unbounded name or note',async()=>{
  const h=harness(),a=h.context();
  const long='x'.repeat(5000);
  // The route a hand-edited or shared file takes.
  let s=await a.replace({custom:[{id:'c-long',name:long,note:long,template:'https://long.example/{path}'}],
    enabledIds:['c-long'],defaultRedirector:'c-long'});
  const entry=s.custom.find((c)=>c.id==='c-long');
  assert.equal(entry.name.length,a.MAX_NAME,'the name is capped');
  assert.equal(entry.note.length,a.MAX_NOTE,'and so is the note');
  assert.ok(a.MAX_NAME<100&&a.MAX_NOTE<400,'to something a label can actually be');
  // And the merge route, which reads the name before normalize ever sees it.
  const g=harness(),b=g.context();
  let t=await b.merge({custom:[{id:'c-m',name:long,template:'https://m.example/{path}'}]});
  assert.equal(t.custom.find((c)=>c.template==='https://m.example/{path}').name.length,b.MAX_NAME);
  // A name that fits is untouched.
  let u=await b.addCustom({name:'My instance',template:'https://ok.example/{path}'});
  assert.equal(u.custom.find((c)=>c.template==='https://ok.example/{path}').name,'My instance');
});

// The same limit is written in the markup as maxlength. JavaScript does not
// reapply it, so only this keeps the two in step.
test('the form agrees with the stored name limit',()=>{
  const h=harness(),a=h.context();
  const html=readFileSync(new URL('../src/options/options.html',import.meta.url),'utf8');
  const caps=Array.from(html.matchAll(/maxlength="(\d+)"/g),(m)=>Number(m[1]));
  assert.ok(caps.length>=2,'both name fields still declare one');
  for (const cap of caps) assert.equal(cap,a.MAX_NAME,'maxlength matches XITStore.MAX_NAME');
});
