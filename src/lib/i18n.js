/*
 * C10, P3: xIT had no _locales at all, so every string was inline English and
 * both stores reported it as single-locale. The manifest's strings now come
 * from _locales/en; this is the same thing for anything shown at runtime.
 *
 * Mark text in HTML with data-i18n="<key>", and an attribute with
 * data-i18n-<attr>="<key>", for example data-i18n-placeholder. Call
 * XITI18N.apply() once the document is parsed. In JavaScript, use
 * XITI18N.t('key') or XITI18N.t('key', [value]) for a message with $1
 * placeholders.
 *
 * A missing key returns '' from the browser API, which would blank the UI, so
 * t() keeps whatever was there and says so in the console instead. That means
 * an untranslated string degrades to English rather than to nothing.
 */
(function (root) {
  const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const i18n = api && api.i18n;

  /** The message for a key, or fallback if there is no such message. */
  function t(key, subs, fallback) {
    if (!i18n || typeof i18n.getMessage !== 'function') return fallback === undefined ? '' : fallback;
    const text = i18n.getMessage(key, subs);
    if (text) return text;
    if (typeof console !== 'undefined') console.warn('[xit] no message for', key);
    return fallback === undefined ? '' : fallback;
  }

  /**
   * Replace marked text and attributes inside scope. The existing content is
   * the fallback, so a page renders correctly even with no catalogue at all,
   * which is what the tests and a bare file:// open get.
   */
  function apply(scope) {
    const where = scope || (typeof document !== 'undefined' ? document : null);
    if (!where) return;
    for (const node of where.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.dataset.i18n, undefined, node.textContent);
    }
    for (const node of where.querySelectorAll('*')) {
      for (const name of Object.keys(node.dataset || {})) {
        if (!name.startsWith('i18n') || name === 'i18n') continue;
        // data-i18n-aria-label arrives as dataset.i18nAriaLabel.
        const attr = name.slice(4).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '');
        node.setAttribute(attr, t(node.dataset[name], undefined, node.getAttribute(attr) || ''));
      }
    }
  }

  root.XITI18N = { t, apply };
})(typeof globalThis !== 'undefined' ? globalThis : self);
