/* Extension API stubs so the real UI runs inside a plain page. */
(function () {
  const params = new URLSearchParams(location.search);
  const seed = {};
  if (params.get('browse') === '1') { seed.browseRedirect = true; seed.browseRedirectorId = 'xcancel'; }
  if (params.get('custom') === '1') {
    seed.custom = [{ id: 'c-my-nitter', name: 'My Nitter', group: 'custom', template: 'https://nitter.example.net/{path}{query}', requires: [], note: '' }];
  }
  let store = { settings: Object.keys(seed).length ? seed : undefined };
  const ls = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: (message, cb) => {
        let result;
        if (message.type === 'xit:mutate-settings') {
          window.XITStore.startWriter();
          result = window.XITStore.mutate(message.operation).then(settings => ({ok:true,settings}));
        } else result = Promise.resolve({ok:true});
        if (cb) result.then(cb);
        return result;
      },
      getURL: (p) => p,
      openOptionsPage: () => {},
      lastError: null,
    },
    storage: {
      local: {
        get: (k, cb) => {
          if (store.settings && store.settings.custom && !store.settings.enabledIds) {
            store.settings.enabledIds = window.XITStore.DEFAULTS.enabledIds.concat(store.settings.custom.map(c => c.id));
          }
          const s = window.XITStore && window.XITStore.normalize(store.settings);
          const data = { ...store, dnrStatus: s && {key:window.XITStore.browseStatusKey(s),state:s.browseRedirect?'active':'off'} };
          const result = typeof k === 'string' ? {[k]:data[k]} : data;
          if(cb) cb(result);
          return Promise.resolve(result);
        },
        set: (o, cb) => {
          Object.assign(store, o);
          const changes = Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{newValue:v}]));
          ls.forEach(f => f(changes, 'local'));
          if(cb) cb();
          return Promise.resolve();
        },
        remove: (k, cb) => { delete store[k]; if(cb) cb(); return Promise.resolve(); },
      },
      onChanged: { addListener: (f) => ls.push(f) },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, index: 0, url: 'https://x.com/jack/status/20?s=20&t=abc' }]),
      create: () => Promise.resolve(),
    },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: () => Promise.resolve() },
  });

  // Enlarge the real UI inside the screenshot frame. zoom re-runs layout, so
  // text stays crisp - unlike transform: scale(), which would resample it.
  // Prefill the custom-template form so the live preview is visible.
  if (params.get('fill') === '1') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
      const name = document.getElementById('c-name');
      const tpl = document.getElementById('c-template');
      if (!name || !tpl) return;
      name.value = 'My Nitter';
      tpl.value = 'https://nitter.example.net/{path}{query}';
      tpl.dispatchEvent(new Event('input', { bubbles: true }));
    }, 260));
  }

  const z = parseFloat(params.get('zoom'));
  if (z > 0) {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.zoom = String(z);
    });
  }
})();
