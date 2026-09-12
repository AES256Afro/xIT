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
      sendMessage: () => Promise.resolve({ ok: true }),
      getURL: (p) => p,
      openOptionsPage: () => {},
      lastError: null,
    },
    storage: {
      local: {
        get: (k, cb) => cb({ settings: store.settings }),
        set: (o, cb) => { store.settings = o.settings; ls.forEach((f) => f({ settings: { newValue: o.settings } }, 'local')); cb && cb(); },
        remove: (k, cb) => { store.settings = undefined; cb && cb(); },
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
