import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness() {
  let data = {};
  let failNext = false;
  let background;
  const changes = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {
    runtime: {
      sendMessage(message, cb) {
        background.mutate(copy(message.operation)).then(settings => cb({ok:true,settings:copy(settings)}),error=>cb({ok:false,error:error.message}));
      },
    },
    storage: {
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
    status:value=>{data.dnrStatus=copy(value);changes.forEach(fn=>fn({dnrStatus:{newValue:copy(value)}},'local'));}};
}

test('writes from separate contexts preserve unrelated changes and nested scopes',async()=>{
  const h=harness(),a=h.context(),b=h.context();
  await Promise.all([a.save({toast:false,browseScope:{status:false}}),b.save({stripTracking:false,browseScope:{profile:false}})]);
  const s=await a.load();
  assert.equal(s.toast,false);assert.equal(s.stripTracking,false);
  assert.equal(s.browseScope.status,false);assert.equal(s.browseScope.profile,false);
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

test('a delayed initial status read cannot overwrite a newer status event',async()=>{
  const h=harness(),a=h.context(),seen=[];
  h.status({state:'updating'});
  a.watchStatus(value=>seen.push(value.state));
  h.status({state:'active'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen,['active']);
});
