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
 * A sentence with markup inside it, such as a <code> sample mid-phrase, uses
 * data-i18n-parts="<key>" instead. Its message refers to the element's own
 * children as {1}, {2} and so on, in the order they appear in the markup, and
 * they are moved into place rather than re-created. Splitting such a sentence
 * into one message per fragment would be easier to implement and impossible
 * to translate, because word order is not ours to assume.
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
    for (const node of where.querySelectorAll('[data-i18n-parts]')) {
      applyParts(node, node.dataset.i18nParts);
    }
    for (const node of where.querySelectorAll('*')) {
      for (const name of Object.keys(node.dataset || {})) {
        if (!name.startsWith('i18n') || name === 'i18n' || name === 'i18nParts') continue;
        // data-i18n-aria-label arrives as dataset.i18nAriaLabel.
        const attr = name.slice(4).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '');
        node.setAttribute(attr, t(node.dataset[name], undefined, node.getAttribute(attr) || ''));
      }
    }
  }

  /**
   * Rebuild a sentence that has markup inside it. The element's own children
   * are reused in whatever order the message puts them, so a <code> sample
   * keeps its content and styling and a translator can move it. With no
   * message the markup is left exactly as the page author wrote it.
   */
  function applyParts(node, key) {
    const template = t(key, undefined, null);
    if (!template) return;
    const parts = [];
    for (let i = 0; i < node.children.length; i++) parts.push(node.children[i]);
    const doc = node.ownerDocument;
    const pieces = String(template).split(/\{(\d+)\}/);
    node.textContent = '';
    for (let i = 0; i < pieces.length; i++) {
      if (i % 2 === 0) {
        if (pieces[i]) node.appendChild(doc.createTextNode(pieces[i]));
      } else {
        // A message naming a child that no longer exists drops it rather than
        // inserting the word "undefined" into the page.
        const child = parts[Number(pieces[i]) - 1];
        if (child) node.appendChild(child);
      }
    }
  }

  /**
   * A message belonging to one of the library's own data families, such as a
   * redirector's note or a group heading.
   *
   * lib/redirectors.js holds that text and must stay free of browser APIs:
   * tools/build.mjs evaluates it in a bare context to read the host lists, and
   * the unit tests load it on its own. So its strings are not fetched there;
   * they are looked up here, at the point of display, keyed by the entry's own
   * id, with the library's English as the fallback.
   */
  function of(family, id, fallback) {
    if (!id) return fallback === undefined ? '' : fallback;
    // A message name may hold only letters, digits and underscores, so an id
    // like "fxtwitter-direct" has to be folded. Without this the browser
    // rejects the catalogue entry and the string silently falls back.
    const name = family + '_' + String(id).replace(/[^A-Za-z0-9_]/g, '_');
    return t(name, undefined, fallback);
  }

  root.XITI18N = { t, of, apply };
})(typeof globalThis !== 'undefined' ? globalThis : self);
