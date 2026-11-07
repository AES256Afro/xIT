/* Extension API stubs so the real UI runs inside a plain page. */
(function () {
  const params = new URLSearchParams(location.search);
  const seed = {};
  if (params.get('custom') === '1') {
    seed.custom = [{ id: 'c-my-instance', name: 'My instance', group: 'custom', template: 'https://links.example.net/{path}{query}', requires: [], note: '' }];
  }
  // The first-run picker opens itself on a fresh profile. A store image is
  // of the page behind it, so this profile has been through it already.
  seed.pickerDone = true;
  let store = { settings: seed };

  // The shipped catalogue, read synchronously because getMessage is. The
  // staging root is a copy of src/, so this is the same file the build packs.
  // Without it every string built in JavaScript would come out empty, and the
  // content script's button and menu are nothing but such strings.
  const catalogue = (() => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '_locales/en/messages.json', false);
      xhr.send();
      return xhr.status === 200 ? JSON.parse(xhr.responseText) : {};
    } catch (_) { return {}; }
  })();
  function getMessage(key, subs) {
    const entry = catalogue[key];
    if (!entry) return '';
    const list = subs == null ? [] : [].concat(subs);
    const numbered = (text) => text.replace(/\$(\d+)/g, (_, n) => list[Number(n) - 1] == null ? '' : String(list[Number(n) - 1]));
    let text = entry.message;
    for (const [name, ph] of Object.entries(entry.placeholders || {})) {
      text = text.split(new RegExp('\\$' + name + '\\$', 'gi')).join(numbered(ph.content || ''));
    }
    return numbered(text).replace(/\$\$/g, '$');
  }
  const ls = [];
  const session = {};
  window.chrome = {
    i18n: { getMessage },
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
      session: {
        get: (key, cb) => { const value = { [key]: session[key] }; if (cb) cb(value); return Promise.resolve(value); },
        set: (value, cb) => { Object.assign(session, value); if (cb) cb(); return Promise.resolve(); },
        remove: (key, cb) => { delete session[key]; if (cb) cb(); return Promise.resolve(); },
      },
      local: {
        get: (k, cb) => {
          if (store.settings && store.settings.custom && !store.settings.enabledIds) {
            store.settings.enabledIds = window.XITStore.DEFAULTS.enabledIds.concat(store.settings.custom.map(c => c.id));
          }
          const result = typeof k === 'string' ? {[k]:store[k]} : { ...store };
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
      name.value = 'My instance';
      tpl.value = 'https://links.example.net/{path}{query}';
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
