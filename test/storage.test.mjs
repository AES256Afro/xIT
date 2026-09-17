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
  await Promise.all([a.setPinned('unrollnow',true),b.setPinned('vxtwitter',true)]);
  await b.movePinned('vxtwitter',-1);
  let s=await a.load();
  assert.deepEqual(Array.from(s.pinnedIds),['vxtwitter','unrollnow']);
  assert.deepEqual(Array.from(a.enabledRedirectors(s).slice(0,2),r=>r.id),['vxtwitter','unrollnow']);
  assert.equal(s.defaultRedirector,'fxtwitter');
  await a.setEnabled('vxtwitter',false);
  s=await b.load();assert.equal(b.enabledRedirectors(s)[0].id,'unrollnow');
  await a.replace(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(Array.from((await a.load()).pinnedIds),['vxtwitter','unrollnow']);
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
