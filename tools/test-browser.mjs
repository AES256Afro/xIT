import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Playwright is a development tool only; the extension/build has no packages.
const modulePath = process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
// Await the predicate before testing it; some Playwright builds treat a
// returned Promise as a truthy polling result without waiting for its value.
async function waitFor(page, predicate, argument, options = {}) {
  const deadline = Date.now() + (options.timeout || 10000);
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for ' + String(predicate));
}
const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'dist/chrome');
const results = { checks: [] };
const check = (name) => { results.checks.push(name); console.log('PASS ' + name); };
const context = await chromium.launchPersistentContext('', {
  headless: true, channel: 'chromium',
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  results.browser = context.browser().version();
  results.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  const settle = () => worker.evaluate(() => initChain);
  const save = async (patch) => { await worker.evaluate(patch => XITStore.save(patch), patch); await settle(); };
  await settle();
  const unsupported = await worker.evaluate(async () => {
    const compiled = [...XIT.guardRules()];
    for (const r of [...XIT.PRESETS, {template:'https://www.example.com:8443/{path}{query}'}, {template:'https://[::1]:8443/{path}'}]) {
      compiled.push(...XIT.compileBrowseRules(r.template, {status:true,profile:true,other:true}));
    }
    const unique = [...new Map(compiled.map(r=>[JSON.stringify([r.regexFilter,!!r.regexSubstitution]),r])).values()];
    const checked = await Promise.all(unique.map(async r=>({regex:r.regexFilter,...await chrome.declarativeNetRequest.isRegexSupported({regex:r.regexFilter,requireCapturing:!!r.regexSubstitution})})));
    return checked.filter(r=>!r.isSupported);
  });
  assert.deepEqual(unsupported, []);check('All generated patterns fit the native regex compiler');
  await save({browseRedirect:true,browseScope:{status:true,profile:true,other:false}});
  const outcomes = await worker.evaluate(async () => {
    const rules=await chrome.declarativeNetRequest.getDynamicRules();
    const samples = {
      'https://x.com/homegrown':'redirect','https://x.com/topicsmith':'redirect',
      'https://x.com/home':'allow','https://x.com/settings/account':'allow',
      'https://x.com/i/web/status/20':'redirect','https://x.com/jack?xit_bypass=1':'allow',
      'https://x.com/jack?xit_bypass=10':'redirect','https://x.com/abcdefghijklmnop':null,
      'https://mobile.twitter.com/ABCDEFGHIJKLMNO?lang=en':'redirect',
      'http://www.twitter.com/jack':'redirect','https://x.com/jack/followers':null,
      'https://api.x.com/jack':null,'https://example.com/jack':null,
    };
    const out=[];
    for(const [url,expected] of Object.entries(samples)) {
      const {matchedRules}=await chrome.declarativeNetRequest.testMatchOutcome({url,type:'main_frame'});
      out.push({url,expected,actual:rules.find(r=>r.id===matchedRules[0]?.ruleId)?.action.type || null});
    }
    return {out,status:(await chrome.storage.local.get('dnrStatus')).dnrStatus,count:rules.length};
  });
  for(const row of outcomes.out) assert.equal(row.actual,row.expected,row.url);
  assert.equal(outcomes.status.state,'active');results.ruleCount=outcomes.count;check('Native redirect matching protects reserved paths and rejects long profiles');
  for (const template of ['https://www.example.com:8443/{path}{query}', 'https://[::1]:8443/{path}']) {
    const state = await worker.evaluate(async template => {
      const settings = await XITStore.addCustom({name:'Destination check',template});
      await XITStore.save({browseRedirectorId:settings.custom.at(-1).id});
      await init('destination-test');
      return (await chrome.storage.local.get('dnrStatus')).dnrStatus.state;
    },template);
    assert.equal(state,'active',template);
  }
  await save({custom:[],browseRedirectorId:'xcancel'});
  check('Custom www hosts, ports and IPv6 destinations install as native rules');
  const options=await context.newPage();
  const second=await context.newPage();
  for(const page of [options,second]) {await page.goto(`chrome-extension://${id}/options/options.html`);await page.waitForSelector('#en-fxtwitter');}
  await Promise.all([options.evaluate(()=>XITStore.save({toast:false,browseScope:{status:false}})),second.evaluate(()=>XITStore.save({stripTracking:false,browseScope:{profile:false}}))]);
  let settings=await worker.evaluate(()=>XITStore.load());
  assert.equal(settings.toast,false);assert.equal(settings.stripTracking,false);
  assert.equal(settings.browseScope.status,false);assert.equal(settings.browseScope.profile,false);
  check('Concurrent saves from separate extension pages preserve all changes');
  await options.evaluate(()=>XITStore.addCustom({name:'Audit custom',template:'https://www.example.com:8443/{path}'}));
  await options.locator('#en-c-audit-custom').uncheck();
  await waitFor(options, async()=>!(await XITStore.load()).enabledIds.includes('c-audit-custom'));
  await options.reload();await options.waitForSelector('#en-c-audit-custom');
  assert.equal(await options.locator('#en-c-audit-custom').isChecked(),false);
  await options.evaluate(async()=>XITStore.replace(JSON.parse(JSON.stringify(await XITStore.load()))));
  assert.equal((await worker.evaluate(()=>XITStore.load())).enabledIds.includes('c-audit-custom'),false);
  check('Custom disable survives UI interaction, reload and import');
  await save({browseRedirect:false});
  await options.evaluate(()=>{chrome.permissions.request=()=>new Promise(resolve=>{window.resolvePermission=resolve;});});
  await options.locator('#t-browse').check();
  await options.waitForFunction(()=>!!window.resolvePermission);
  await second.evaluate(()=>XITStore.save({toast:true}));
  await options.waitForFunction(()=>document.getElementById('t-toast').checked);
  await options.evaluate(()=>resolvePermission(true));
  await waitFor(options, async()=>(await XITStore.load()).browseRedirect);
  await options.evaluate(()=>{window.resolvePermission=null;});
  await options.locator('#browse-select').selectOption('fxtwitter');
  await options.waitForFunction(()=>!!window.resolvePermission);
  await second.evaluate(()=>XITStore.save({toast:false}));
  await options.waitForFunction(()=>!document.getElementById('t-toast').checked);
  await options.evaluate(()=>resolvePermission(true));
  await waitFor(options, async()=>(await XITStore.load()).browseRedirectorId==='fxtwitter');
  check('Permission prompts preserve the selected control value during other settings updates');
  await save({custom:[],enabledIds:['fxtwitter'],browseRedirect:false});
  await options.evaluate(()=>{
    window.probeLog=[];window.permissionLog=[];window.probeActive=0;window.probePeak=0;
    chrome.permissions.request=async options=>{permissionLog.push(options.origins);return true;};
    chrome.permissions.contains=async()=>true;
    window.fetch=async(url,options)=>{
      probeLog.push({url,credentials:options.credentials,redirect:options.redirect});
      probePeak=Math.max(probePeak,++probeActive);
      await new Promise(r=>setTimeout(r,30));probeActive--;return {ok:true};
    };
  });
  const probe = async () => {
    await options.click('#test-all');
    await options.waitForFunction(()=>!document.getElementById('test-all').disabled);
  };
  await probe();
  let log=await options.evaluate(()=>({requests:probeLog,permissions:permissionLog,peak:probePeak}));
  assert.equal(log.requests.length,1);assert.equal(log.requests[0].url,'https://fxtwitter.com/');
  assert.deepEqual(log.permissions,[['https://fxtwitter.com/*']]);
  assert.equal(log.requests[0].credentials,'omit');assert.equal(log.requests[0].redirect,'manual');
  await worker.evaluate(()=>XITStore.save({enabledIds:XITStore.DEFAULTS.enabledIds}));await settle();
  await options.evaluate(()=>{probeLog=[];permissionLog=[];probePeak=0;});
  await options.click('#test-all');
  await options.evaluate(()=>document.getElementById('test-all').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await options.waitForFunction(()=>!document.getElementById('test-all').disabled);
  log=await options.evaluate(()=>({requests:probeLog,permissions:permissionLog,peak:probePeak}));
  assert.equal(log.requests.length,13);assert.equal(log.permissions.length,1);assert.equal(log.peak,3);
  check('Reachability respects enabled hosts, limits concurrency to three, and prevents overlapping runs');
  await options.evaluate(()=>{probeLog=[];chrome.permissions.request=async()=>false;chrome.permissions.contains=async()=>false;});
  await probe();assert.equal(await options.evaluate(()=>probeLog.length),0);
  check('Denied host access prevents reachability requests');
  await save({browseRedirect:true,browseScope:{status:true,profile:true,other:false}});
  await worker.evaluate(async()=>{
    const create=chrome.contextMenus.create;
    chrome.contextMenus.create=()=>{throw new Error('Synthetic menu failure');};
    await XITStore.save({browseRedirect:false});
    try{await init('failure-test');}catch{}finally{chrome.contextMenus.create=create;}
  });
  assert.equal((await worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())).length,0);
  check('A failed menu rebuild cannot prevent disabling redirects');
  await worker.evaluate(async()=>{
    const update=chrome.declarativeNetRequest.updateDynamicRules;
    chrome.declarativeNetRequest.updateDynamicRules=async change=>{if(change.addRules?.length)throw new Error('Synthetic redirect failure');return update(change);};
    await XITStore.save({browseRedirect:true});
    try{await init('failure-test');}catch{}finally{chrome.declarativeNetRequest.updateDynamicRules=update;}
  });
  await options.waitForFunction(()=>document.getElementById('browse-warn').textContent.includes('Synthetic redirect failure'));
  assert.equal((await worker.evaluate(()=>chrome.declarativeNetRequest.getDynamicRules())).length,0);
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(()=>document.getElementById('browse-note').textContent.includes('Synthetic redirect failure'));
  check('Redirect errors appear in Settings and popup and leave no old rules');
  await save({browseRedirect:false,toast:false,stripTracking:true});
  await worker.evaluate(async()=>{
    await chrome.storage.local.set({lastCopyFailure:{text:'synthetic',at:0}});
    await init('migration-test');
    await copyInTab(2147483647,'https://x.com/jack/status/20?synthetic=1',false);
  });
  assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get('lastCopyFailure')),{});
  check('Old failed-copy data is deleted and failed copies do not recreate it');
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const mock=(await readFile(path.join(root,'tools/store-assets/mock-x.html'),'utf8')).replace(/<script[\s\S]*$/,'</body></html>');
  await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:mock}));
  await page.goto('https://x.com/home');await page.waitForSelector('.xit-btn-caret');
  const cdp=await context.newCDPSession(page);const worlds=[];
  cdp.on('Runtime.executionContextCreated',({context})=>worlds.push(context));await cdp.send('Runtime.enable');
  const isolated=worlds.find(w=>w.name===id||w.origin===`chrome-extension://${id}`);
  assert.ok(isolated,'Content script must have an isolated execution world');
  const evaluate=async expression=>{
    const result=await cdp.send('Runtime.evaluate',{contextId:isolated.id,expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  await evaluate(`globalThis.testCopies=[];globalThis.testMessages=[];
    Object.defineProperty(navigator.clipboard,'writeText',{value:async text=>testCopies.push(text),configurable:true});
    const originalMessage=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=(message,...args)=>{
      if(message.type==='xit:mutate-settings')return originalMessage(message,...args);
      testMessages.push(message);return Promise.resolve({ok:true});
    };`);
  const openMenu=async()=>{await page.bringToFront();await page.locator('.xit-btn-caret').first().click();};
  await openMenu();await page.locator('.xit-menu').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.locator('.xit-menu').evaluate(el=>el.hidden),false);
  assert.ok(await page.locator('.xit-menu').evaluate(el=>el.scrollTop>0));
  await page.locator('[data-foot="options"]').focus();await page.keyboard.press('Enter');
  assert.deepEqual(await evaluate('testCopies'),[]);assert.equal((await evaluate('testMessages')).at(-1).type,'xit:open-options');
  await openMenu();await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.className),'xit-btn xit-btn-caret');
  assert.equal(await page.locator('.xit-menu').evaluate(el=>el.hidden),true);
  await openMenu();await page.locator('[data-foot="original"]').focus();await page.keyboard.press('Space');
  assert.equal((await evaluate('testCopies')).at(-1),'https://x.com/jack/status/20');
  await openMenu();await page.locator('[data-id="vxtwitter"] [data-act="open"]').focus();await page.keyboard.press('Enter');
  assert.equal((await evaluate('testMessages')).at(-1).url,'https://vxtwitter.com/jack/status/20');
  await openMenu();await page.locator('[data-id="vxtwitter"] [data-act="default"]').focus();await page.keyboard.press('Space');
  await waitFor(options, async()=>(await XITStore.load()).defaultRedirector==='vxtwitter');
  assert.equal((await evaluate('testCopies')).length,1);
  check('Dropdown scroll, Settings, clean copy, Open, default selection, and Escape use the focused control');
  await evaluate(`globalThis.testScans=0;const originalQuery=Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll=function(selector){if(selector==='article [role="group"]')testScans++;return originalQuery.call(this,selector);};`);
  results.performance=[];
  for(const count of [50,200,1000]) {
    await page.evaluate(count=>{
      const article=document.querySelector('article').cloneNode(true);
      article.querySelectorAll('.xit-wrap').forEach(el=>el.remove());
      article.querySelectorAll('[data-xit]').forEach(el=>el.removeAttribute('data-xit'));
      document.querySelectorAll('article').forEach(el=>el.remove());
      const fragment=document.createDocumentFragment();for(let i=0;i<count;i++)fragment.append(article.cloneNode(true));document.body.append(fragment);
    },count);
    await page.waitForFunction(count=>document.querySelectorAll('.xit-wrap').length===count,count);
    await evaluate('testScans=0');
    await page.evaluate(()=>new Promise(resolve=>{
      const outside=document.createElement('span');document.body.append(outside);let n=0;
      const tick=()=>{outside.textContent=String(n++);if(n<60)requestAnimationFrame(tick);else requestAnimationFrame(()=>{outside.remove();resolve();});};requestAnimationFrame(tick);
    }));
    const scans=await evaluate('testScans');assert.equal(scans,0);
    results.performance.push({articles:count,unrelatedMutations:60,fullDocumentScans:scans});
  }
  await page.evaluate(()=>document.querySelector('.xit-wrap').remove());
  await page.waitForFunction(()=>document.querySelectorAll('.xit-wrap').length===1000);
  await save({copyButton:false});await page.waitForFunction(()=>document.querySelectorAll('.xit-wrap').length===0);
  await save({copyButton:true});await page.waitForFunction(()=>document.querySelectorAll('.xit-wrap').length===1000);
  assert.deepEqual(errors,[]);check('Article additions, removed-button recovery and toggling work without unrelated full scans');
  await mkdir(path.join(root,'.harness'),{recursive:true});
  await writeFile(path.join(root,'.harness/browser-results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally {await context.close();}
