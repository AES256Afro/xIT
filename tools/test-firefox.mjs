import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
const root=path.resolve(import.meta.dirname,'..');
const executable=[process.env.FIREFOX_PATH,'/Applications/Firefox.app/Contents/MacOS/firefox','/usr/bin/firefox'].filter(Boolean).find(existsSync);
if(!executable)throw new Error('Firefox not found. Set FIREFOX_PATH to its executable.');
const results={checks:[]};
const check=name=>{results.checks.push(name);console.log('PASS '+name);};
const profile=await mkdtemp(path.join(os.tmpdir(),'xit-firefox-'));
const uuid=randomUUID();
await writeFile(path.join(profile,'user.js'),`user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({'xit@aes256afro.github.io':uuid}))});\nuser_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\n`);
let ws;
// System access lets BiDi inspect this disposable profile's extension page.
const child=spawn(executable,['--headless','--remote-allow-system-access','--new-instance','--profile',profile,'--remote-debugging-port','0','about:blank'],{stdio:['ignore','ignore','pipe']});
try {
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Firefox startup timeout')),15000);
    child.stderr.on('data',chunk=>{const m=String(chunk).match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]+'/session');}});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('Firefox exited '+code));});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
  });
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=event=>{const data=JSON.parse(event.data),p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);if(data.type==='error')p.reject(new Error(JSON.stringify(data)));else p.resolve(data.result);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error('Timed out '+method));},15000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const session=await call('session.new',{capabilities:{alwaysMatch:{}}});
  results.browser=session.capabilities.browserVersion;
  const installed=await call('webExtension.install',{extensionData:{type:'path',path:path.join(root,'dist/firefox')}});
  assert.equal(installed.extension,'xit@aes256afro.github.io');
  const {context}=await call('browsingContext.create',{type:'tab'});
  await call('browsingContext.navigate',{context,url:`moz-extension://${uuid}/options/options.html`,wait:'complete'});
  const evaluate=async expression=>{
    const result=await call('script.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,target:{context},awaitPromise:true});
    if(result.type==='exception')throw new Error(JSON.stringify(result));
    return JSON.parse(result.result.value);
  };
  results.version=await evaluate('browser.runtime.getManifest().version');
  assert.equal((await evaluate('XITStore.load()')).defaultRedirector,'fxtwitter');
  check('Built Firefox extension installs and loads Settings');
  const saved=await evaluate('(async()=>{await Promise.all([XITStore.save({toast:false}),XITStore.save({stripTracking:false})]);return XITStore.load()})()');
  assert.equal(saved.toast,false);assert.equal(saved.stripTracking,false);
  check('Concurrent settings mutations persist through the native Firefox message API');
  const redirect=await evaluate('(async()=>{await XITStore.save({browseRedirect:true});await browser.runtime.sendMessage({type:"xit:settings-changed"});return {local:await browser.storage.local.get(["dnrStatus","menuError"]),rules:(await browser.declarativeNetRequest.getDynamicRules()).length}})()');
  assert.equal(redirect.local.menuError,undefined);
  assert.equal(redirect.local.dnrStatus.state,'active');
  assert.equal(redirect.rules,40);results.ruleCount=redirect.rules;
  check('Firefox installs all 40 redirect rules and creates the context menus');
  const ui=await evaluate('({saved:document.getElementById("saved").textContent,status:document.getElementById("browse-warn").textContent,state:document.getElementById("browse-warn").dataset.state,rows:document.querySelectorAll("[data-probe]").length})');
  assert.equal(ui.saved,'');assert.equal(ui.status,'Page redirect is active.');assert.equal(ui.state,'normal');assert.equal(ui.rows,13);
  check('Settings displays successful redirect installation without a warning');
  assert.equal(await evaluate('(async()=>{await XITStore.save({browseRedirect:false});await browser.runtime.sendMessage({type:"xit:settings-changed"});return (await browser.declarativeNetRequest.getDynamicRules()).length})()'),0);
  check('Turning redirects off removes the native rules');
  await mkdir(path.join(root,'.harness'),{recursive:true});
  await writeFile(path.join(root,'.harness/firefox-results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
  await call('session.end');
} finally {
  ws?.close();
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  await rm(profile,{recursive:true,force:true});
}
