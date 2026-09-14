import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness({ writeText = async () => {}, write = async () => {} } = {}) {
  const messages=[],listeners=[];
  const window={addEventListener(type,fn){if(type==='message')listeners.push(fn);},postMessage(data){messages.push(data);}};
  class Item {
    constructor(data) { this.data=data;this.types=Object.keys(data); }
    getType(type) { return Promise.resolve(this.data[type]); }
  }
  const clipboard={writeText,write};
  const ctx=vm.createContext({window,navigator:{clipboard},location:{origin:'https://x.com'},URL,URLSearchParams,Blob,ClipboardItem:Item});
  for(const file of ['lib/redirectors.js','content/main-world.js'])vm.runInContext(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),ctx);
  const configure=payload=>listeners.forEach(fn=>fn({source:window,data:{__xit:'config',payload}}));
  configure({enabled:true,template:'https://fxtwitter.com/{path}{query}'});
  return {clipboard,Item,configure,copied:()=>messages.filter(m=>m.__xit==='copied')};
}

test('writeText announces success only after the original writer resolves',async()=>{
  let resolve,actual;
  const h=harness({writeText:text=>{actual=text;return new Promise(r=>{resolve=r;});}});
  const pending=h.clipboard.writeText('https://x.com/jack/status/20?s=20');
  assert.equal(actual,'https://fxtwitter.com/jack/status/20');assert.equal(h.copied().length,0);
  resolve();await pending;assert.equal(h.copied().length,1);
});

test('failed writes do not announce success or retry',async()=>{
  let calls=0;const error=new Error('denied');
  const reject=async()=>{calls++;throw error;};
  const h=harness({writeText:reject,write:reject});
  await assert.rejects(h.clipboard.writeText('https://x.com/jack/status/20'),e=>e===error);
  await assert.rejects(h.clipboard.write([new h.Item({'text/plain':new Blob(['https://x.com/jack/status/20'])})]),e=>e===error);
  assert.equal(calls,2);assert.equal(h.copied().length,0);
});

test('ClipboardItem conversion preserves other formats and items',async()=>{
  let actual;const h=harness({write:async items=>{actual=items;}});
  const html=new Blob(['<b>Original</b>'],{type:'text/html'});
  const other=new h.Item({'image/png':new Blob(['image'])});
  await h.clipboard.write([new h.Item({'text/plain':new Blob(['https://x.com/jack/status/20']),'text/html':html}),other]);
  assert.equal(await (await actual[0].getType('text/plain')).text(),'https://fxtwitter.com/jack/status/20');
  assert.equal(await actual[0].getType('text/html'),html);assert.equal(actual[1],other);
  assert.equal(h.copied().length,1);
});

test('preparation failure forwards original items once without a success event',async()=>{
  let actual,calls=0;const h=harness({write:async items=>{actual=items;calls++;}});
  const broken={types:['text/plain'],getType:()=>Promise.reject(new Error('unreadable'))};
  const items=[broken];await h.clipboard.write(items);
  assert.equal(actual,items);assert.equal(calls,1);assert.equal(h.copied().length,0);
});

test('prose, disabled configuration, and malformed configuration pass through',async()=>{
  const values=[];const h=harness({writeText:async text=>values.push(text)});
  const text='Read https://x.com/jack/status/20';await h.clipboard.writeText(text);
  h.configure({enabled:false,template:'https://fxtwitter.com/{path}'});
  await h.clipboard.writeText('https://x.com/jack/status/20');
  h.configure({enabled:true,template:{bad:'value'},requires:42});
  await h.clipboard.writeText('https://x.com/jack/status/20');
  assert.deepEqual(values,[text,'https://x.com/jack/status/20','https://x.com/jack/status/20']);
  assert.equal(h.copied().length,0);
});
