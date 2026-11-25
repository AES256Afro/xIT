/*
 * xIT - writing to the clipboard from a page.
 *
 * Classic script. Exposes globalThis.XITClipboard. Loaded by the content
 * script, the popup and Settings, so the three write the same way and fall
 * back the same way.
 *
 * The background has its own copy, clipboardPayload in background.js, and
 * has to: scripting.executeScript serialises that function into a page that
 * has none of these libraries in it. Keep the two in step.
 */
(function (root) {
  'use strict';

  /**
   * Write text, true if it landed. The async Clipboard API first; then the
   * old selection-and-execCommand route, which some pages and browsers still
   * allow when the API is refused. The textarea is read-only, so a phone does
   * not raise its keyboard, and fixed, invisible and inert, so the page does
   * not scroll or flash.
   */
  async function write(text) {
    try {
      if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to the textarea route */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  root.XITClipboard = { write };
})(typeof globalThis !== 'undefined' ? globalThis : this);
