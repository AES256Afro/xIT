/*
 * xIT - main world.
 *
 * Runs in the page's own JS context (content_scripts world: MAIN) purely so it
 * can wrap navigator.clipboard. That is what makes X's *own* "Copy link"
 * produce a redirected URL. It holds no extension privileges and talks to the
 * isolated content script over window.postMessage.
 */
(function () {
  'use strict';

  const XIT = globalThis.XIT;
  if (!XIT) return;
  try { delete globalThis.XIT; } catch (_) { /* leave it */ }

  let cfg = { enabled: false, template: null, name: '', requires: [], stripTracking: true };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__xit !== 'config' || !d.payload) return;
    cfg = {
      enabled: !!d.payload.enabled,
      template: d.payload.template || null,
      name: d.payload.name || '',
      requires: d.payload.requires || [],
      stripTracking: d.payload.stripTracking !== false,
    };
    // The isolated script attaches its listener at document_idle, long after
    // our first hello. Answering each config is what it actually hears.
    post('hello');
  }, false);

  function post(type, extra) {
    try {
      window.postMessage(Object.assign({ __xit: type }, extra || {}), location.origin);
    } catch (_) { /* ignore */ }
  }

  function transform(text) {
    if (!cfg.enabled || !cfg.template || typeof text !== 'string') return text;
    const t = text.trim();
    // Only ever touch a lone URL, never prose that happens to contain one.
    if (!/^https?:\/\/\S+$/.test(t)) return text;
    const out = XIT.convert(t, { template: cfg.template, name: cfg.name, requires: cfg.requires },
      { stripTracking: cfg.stripTracking });
    if (!out.ok) return text;
    post('copied', { url: out.url });
    return out.url;
  }

  const clip = navigator.clipboard;

  if (clip && typeof clip.writeText === 'function') {
    const orig = clip.writeText.bind(clip);
    try {
      Object.defineProperty(clip, 'writeText', {
        configurable: true,
        writable: true,
        value: function writeText(text) { return orig(transform(text)); },
      });
    } catch (_) { /* non-configurable: nothing to do */ }
  }

  // Some paths use clipboard.write() with ClipboardItem instead.
  if (clip && typeof clip.write === 'function' && typeof ClipboardItem !== 'undefined') {
    const origWrite = clip.write.bind(clip);
    try {
      Object.defineProperty(clip, 'write', {
        configurable: true,
        writable: true,
        value: function write(items) {
          if (!cfg.enabled) return origWrite(items);
          const list = Array.from(items || []);
          const plain = list.find((i) => i && i.types && i.types.indexOf('text/plain') !== -1);
          if (!plain) return origWrite(items);
          return plain.getType('text/plain')
            .then((b) => b.text())
            .then((text) => {
              const next = transform(text);
              if (next === text) return origWrite(items);
              const rec = {};
              return Promise.all(plain.types.map((ty) => (
                ty === 'text/plain'
                  ? Promise.resolve(new Blob([next], { type: 'text/plain' }))
                  : plain.getType(ty)
              ).then((blob) => { rec[ty] = blob; })))
                .then(() => origWrite(list.map((i) => (i === plain ? new ClipboardItem(rec) : i))));
            })
            .catch(() => origWrite(items));
        },
      });
    } catch (_) { /* ignore */ }
  }

  post('hello');
})();
