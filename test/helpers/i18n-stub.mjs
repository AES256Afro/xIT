import { readFileSync } from 'node:fs';
import path from 'node:path';

const CATALOGUE = path.resolve(import.meta.dirname, '../../src/_locales/en/messages.json');

/**
 * chrome.i18n.getMessage, backed by the real English catalogue.
 *
 * The harnesses use this rather than letting every string fall back, so the
 * assertions read what the shipped catalogue actually produces: a message
 * whose wording or placeholders are wrong fails here instead of surviving
 * because the fallback happened to match.
 *
 * Substitution follows the WebExtension rules the extension relies on: a
 * $name$ in the message body is looked up in `placeholders`, whose content is
 * $1..$9 referring to the caller's array.
 */
export function fakeI18n() {
  const messages = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  return {
    getMessage(key, subs) {
      const entry = messages[key];
      if (!entry) return '';
      const list = subs === undefined ? [] : (Array.isArray(subs) ? subs : [subs]);
      return String(entry.message).replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, (whole, name) => {
        const spec = (entry.placeholders || {})[name]
          || (entry.placeholders || {})[name.toLowerCase()];
        if (!spec) return whole;
        const index = /^\$(\d)$/.exec(spec.content);
        if (!index) return spec.content;
        const value = list[Number(index[1]) - 1];
        return value === undefined ? '' : String(value);
      });
    },
  };
}

/** The catalogue itself, for a test that wants to assert against the English. */
export function messages() {
  return JSON.parse(readFileSync(CATALOGUE, 'utf8'));
}
