import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';

function harness(firefox = false) {
  const menus = new Map();
  const errors = [];
  let created = 0;
  const events = {};
  let settings = { contextMenu: true, browseRedirect: false, name: 'first' };
  let changed;
  let rules = [];
  const local = {};
  let rejectRules = false;
  const event = (name) => ({ addListener(fn) { events[name] = fn; } });
  const runtime = { onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') };
  let failRemoval = false;
  let failCreation = false;
  function complete(cb, error) {
    runtime.lastError = error ? { message: error } : undefined;
    cb?.();
    runtime.lastError = undefined;
  }
  const api = {
    runtime,
    contextMenus: {
      onClicked: event('clicked'),
      removeAll(cb) {
        setImmediate(() => {
          if (failRemoval) { failRemoval = false; complete(cb, 'remove failed'); return; }
          menus.clear(); complete(cb);
        });
      },
      create(opts, cb) {
        setImmediate(() => {
          const error = failCreation ? 'create failed' : menus.has(opts.id) ? 'duplicate ' + opts.id : null;
          failCreation = false;
          if (error) errors.push(error);
          else { menus.set(opts.id, opts); created += 1; }
          complete(cb, error);
        });
        return opts.id;
      },
    },
    storage: { local: {
      remove: async (key) => { delete local[key]; },
      set: async (value) => { Object.assign(local, value); },
    } },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      isRegexSupported: async () => ({isSupported:!rejectRules,reason:'memoryLimitExceeded'}),
      updateDynamicRules: async ({removeRuleIds = [], addRules = []}) => {
        rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules);
      },
    },
  };
  if (firefox) {
    api.contextMenus.removeAll = () => new Promise((resolve, reject) => {
      setImmediate(() => {
        if (failRemoval) { failRemoval = false; reject(new Error('remove failed')); return; }
        menus.clear(); resolve();
      });
    });
  }
  const store = {
    startWriter() {},
    browseStatusKey: s => JSON.stringify(s),
    load: async () => ({ ...settings }),
    save: async () => { changed({ ...settings }); },
    onChanged(fn) { changed = fn; },
    enabledRedirectors: (s) => [{id:'example',group:'test',name:s.name}],
    defaultRedirector: (s) => ({name:s.name}),
    findRedirector: () => ({template:'https://example.com/{path}'}),
  };
  const ctx = vm.createContext({ ...(firefox ? { browser: api } : { chrome: api }), console: { warn() {} }, XIT: {
    GROUPS: [{id:'test',label:'Test'}], supportsBrowse:()=>true, guardRules:()=>[],
    compileBrowseRules:()=>[{priority:1,regexFilter:'^https://x.com/(.*)$',regexSubstitution:'https://example.com/\\1'}],
  }, XITStore: store });
  vm.runInContext(readFileSync(new URL('../src/background.js', import.meta.url),'utf8'),ctx);
  async function settle() { for (let i=0;i<150;i++) await tick(); }
  return { menus, errors, events, settle, local, rules:()=>rules, rejectRules:()=>{rejectRules=true;}, createCount: () => created,
    change(patch) { settings={...settings,...patch}; changed({...settings}); },
    failRemove() { failRemoval=true; }, failCreate() { failCreation=true; },
  };
}

test('menu failures cannot prevent removing redirects or clearing old copy data', async () => {
  const h=harness(); await h.settle();
  h.change({browseRedirect:true}); await h.settle();
  assert.equal(h.rules().length,1);
  h.local.lastCopyFailure={text:'synthetic',at:0};
  h.failCreate();h.change({browseRedirect:false});await h.settle();
  assert.equal(h.rules().length,0);
  assert.equal(h.local.dnrStatus.state,'off');
  assert.match(h.local.menuError,/create failed/);
  assert.equal(h.local.lastCopyFailure,undefined);
});

test('native regex rejection clears previous redirects and publishes an error', async () => {
  const h=harness(); await h.settle();
  h.change({browseRedirect:true});await h.settle();
  assert.equal(h.rules().length,1);
  h.rejectRules();h.change({name:'new-target'});await h.settle();
  assert.equal(h.rules().length,0);
  assert.equal(h.local.dnrStatus.state,'error');
  assert.match(h.local.dnrStatus.message,/memoryLimitExceeded/);
});

for (const firefox of [false, true]) {
test(`Firefox=${firefox}: install, startup, storage events and popup messages cannot overlap menu rebuilds`, async () => {
  const h=harness(firefox);
  h.events.installed({reason:'install'});
  h.events.startup();
  h.change({name:'latest'});
  let response;
  h.events.message({type:'xit:settings-changed'}, {}, value=>{response=value;});
  await h.settle();
  assert.deepEqual(h.errors,[]);
  assert.equal(response?.ok,true);
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as latest');
  assert.equal(h.menus.size,11);
  h.change({contextMenu:false});
  await h.settle();
  assert.equal(h.menus.size,0);
  h.change({contextMenu:true,name:'reenabled'});
  await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as reenabled');
  assert.deepEqual(h.errors,[]);
});

test(`Firefox=${firefox}: failed removal stops creation and the next refresh can recover`, async () => {
  const h=harness(firefox); await h.settle();
  h.failRemove(); h.change({name:'failed'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as first');
  assert.deepEqual(h.errors,[]);
  h.change({name:'recovered'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as recovered');
});

test(`Firefox=${firefox}: asynchronous menu errors are reported to the caller and do not break later updates`, async () => {
  const h=harness(firefox); await h.settle(); h.failCreate();
  let response;
  h.events.message({type:'xit:settings-changed'}, {}, value=>{response=value;});
  await h.settle();
  assert.equal(response?.ok,false);
  assert.match(response.error,/create failed/);
  h.change({name:'recovered'}); await h.settle();
  assert.equal(h.menus.get('xit-link-copy-default').title,'Copy as recovered');
});

}

test('a settings write alone rebuilds the menus exactly once', async () => {
  // Nothing sends xit:settings-changed any more: storage.onChanged is the
  // single trigger. If a caller re-adds the message, this rebuilds twice.
  const h = harness(false);
  h.events.installed({ reason: 'startup' });
  await h.settle();

  const menuSize = h.menus.size;
  assert.ok(menuSize > 0, 'expected an initial menu');

  const before = h.createCount();
  h.change({ name: 'second' });
  await h.settle();

  assert.equal(h.createCount() - before, menuSize, 'a settings write should rebuild the menu once');
  assert.equal(h.errors.length, 0, 'rebuilding must not collide with itself');
  assert.equal([...h.menus.values()].some((m) => String(m.title).includes('second')), true,
    'the rebuilt menu should reflect the new settings');
});
