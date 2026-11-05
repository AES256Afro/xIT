import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
        remove(key, cb) { delete session[key]; setImmediate(cb); },
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
        remove(key,cb) { delete data[key];setImmediate(cb); },
      },
      onChanged:{addListener:fn=>changes.push(fn)},
    },
  };
  function context() {
    const ctx=vm.createContext({chrome:api,URL,URLSearchParams});
    for(const file of ['redirectors','storage']) vm.runInContext(readFileSync(new URL('../src/lib/'+file+'.js',import.meta.url),'utf8'),ctx);
    return ctx.XITStore;
  }
  background=context();background.startWriter();
  return {background,context,get:()=>copy(data),fail:()=>{failNext=true;},
    seed:value=>{data.settings=copy(value);}};
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
