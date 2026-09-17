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
  const options=await context.newPage();
  const second=await context.newPage();
  for(const page of [options,second]) {await page.goto(`chrome-extension://${id}/options/options.html`);await page.waitForSelector('#en-fxtwitter');}
  await Promise.all([options.evaluate(()=>XITStore.save({toast:false,copyButton:false})),second.evaluate(()=>XITStore.save({stripTracking:false,contextMenu:false}))]);
  let settings=await worker.evaluate(()=>XITStore.load());
  assert.equal(settings.toast,false);assert.equal(settings.stripTracking,false);
  assert.equal(settings.copyButton,false);assert.equal(settings.contextMenu,false);
  await save({copyButton:true,contextMenu:true});
  check('Concurrent saves from separate extension pages preserve all changes');
  await options.evaluate(()=>XITStore.addCustom({name:'Audit custom',template:'https://www.example.com:8443/{path}'}));
  await options.locator('#en-c-audit-custom').uncheck();
  await waitFor(options, async()=>!(await XITStore.load()).enabledIds.includes('c-audit-custom'));
  await options.reload();await options.waitForSelector('#en-c-audit-custom');
  assert.equal(await options.locator('#en-c-audit-custom').isChecked(),false);
  await options.evaluate(async()=>XITStore.replace(JSON.parse(JSON.stringify(await XITStore.load()))));
  assert.equal((await worker.evaluate(()=>XITStore.load())).enabledIds.includes('c-audit-custom'),false);
  check('Custom disable survives UI interaction, reload and import');
  // What 1.0.3 left on the machine of a user redirecting page loads to xcancel.
  const leftover = await worker.evaluate(async()=>{
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[],addRules:[
      {id:1000,priority:3,action:{type:'allow'},condition:{regexFilter:'^https?://(?:www\\.)?x\\.com/home(?:[/?#]|$)',resourceTypes:['main_frame']}},
      {id:1001,priority:4,action:{type:'redirect',redirect:{regexSubstitution:'https://xcancel.com/\\1'}},
        condition:{regexFilter:'^https?://(?:www\\.)?x\\.com/([^/?#]+/status/\\d+.*)$',resourceTypes:['main_frame']}},
    ]});
    const {settings}=await chrome.storage.local.get('settings');
    await chrome.storage.local.set({settings:{...settings,browseRedirect:true,browseRedirectorId:'xcancel',
      browseScope:{status:true,profile:true,other:false},browsePausedUntil:0}});
    const {matchedRules}=await chrome.declarativeNetRequest.testMatchOutcome({url:'https://x.com/jack/status/20',type:'main_frame'});
    return {rules:(await chrome.declarativeNetRequest.getDynamicRules()).length,matched:matchedRules.length};
  });
  assert.equal(leftover.rules,2);assert.equal(leftover.matched,1,'the seeded rule must really redirect before cleanup');
  // A menu failure must not stop the cleanup.
  await worker.evaluate(async()=>{
    const create=chrome.contextMenus.create;
    chrome.contextMenus.create=()=>{throw new Error('Synthetic menu failure');};
    try{await init('migration-test');}catch{}finally{chrome.contextMenus.create=create;}
  });
  const cleaned = await worker.evaluate(async()=>{
    const {matchedRules}=await chrome.declarativeNetRequest.testMatchOutcome({url:'https://x.com/jack/status/20',type:'main_frame'});
    const {settings}=await chrome.storage.local.get('settings');
    return {rules:(await chrome.declarativeNetRequest.getDynamicRules()).length,matched:matchedRules.length,stored:JSON.stringify(settings)};
  });
  assert.equal(cleaned.rules,0);
  assert.equal(cleaned.matched,0,'Chrome must no longer redirect x.com links');
  assert.equal(/browse|xcancel/.test(cleaned.stored),false,'stored settings must not name a withdrawn front-end');
  check('Rules and settings left by 1.0.3 are removed on start, even when the menu rebuild fails');
  await save({toast:false,stripTracking:true});
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
