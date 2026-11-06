/**
 * A DOM just large enough to run this extension's two page scripts.
 *
 * The repository has no dependencies and no jsdom, so until now the only tests
 * possible against `options.js` and `popup.js` were static checks on their
 * source text. Twice in this audit such a check passed while the code was
 * wrong, because asserting that a line exists is not asserting what the line
 * does. This is the smallest thing that lets a test press a key and look at
 * what happened: an element tree, the handful of selectors the two files
 * actually use, and a counter for how many elements were made.
 *
 * It is deliberately not a DOM. It has no layout, no CSS, no bubbling and no
 * node ordering beyond insertion. Anything it does not implement throws rather
 * than quietly returning undefined, so a test cannot pass by accident.
 */

class TextNode {
  constructor(doc, text) {
    this.ownerDocument = doc;
    this.nodeType = 3;
    this.text = String(text);
    this.parentNode = null;
  }

  get textContent() { return this.text; }
  set textContent(value) { this.text = String(value); }
}

class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.className = '';
    this.listeners = new Map();
    this.attrs = new Map();
    // Properties the page scripts set and read directly. They are plain
    // fields, not reflected attributes, because nothing selects on them.
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
    this.id = '';
    this.type = '';
    this.label = '';
    this.scrollTop = 0;
    this.open = false;
    this.hidden = false;
  }

  /* ---- tree ---- */

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  appendChild(node) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }

  remove() {
    if (!this.parentNode) return;
    const at = this.parentNode.childNodes.indexOf(this);
    if (at !== -1) this.parentNode.childNodes.splice(at, 1);
    this.parentNode = null;
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(value) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    const text = value === null || value === undefined ? '' : String(value);
    if (text) this.appendChild(new TextNode(this.ownerDocument, text));
  }

  /** Every option under this element, as a <select> reports them. */
  get options() {
    const found = [];
    walk(this, (node) => { if (node.tagName === 'OPTION') found.push(node); });
    return found;
  }

  /* ---- attributes ---- */

  setAttribute(name, value) {
    const text = String(value);
    if (name === 'class') this.className = text;
    else if (name === 'hidden') this.hidden = true;
    else if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = text;
    else this.attrs.set(name, text);
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name.startsWith('data-')) {
      const key = camel(name.slice(5));
      return key in this.dataset ? String(this.dataset[key]) : null;
    }
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  removeAttribute(name) {
    if (name === 'hidden') this.hidden = false;
    else if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
    else this.attrs.delete(name);
  }

  get classList() {
    const owner = this;
    const parts = () => owner.className.split(/\s+/).filter(Boolean);
    return {
      add(...names) { owner.className = [...new Set([...parts(), ...names])].join(' '); },
      remove(...names) {
        const gone = new Set(names);
        owner.className = parts().filter((c) => !gone.has(c)).join(' ');
      },
      contains(name) { return parts().includes(name); },
    };
  }

  /* ---- selectors ---- */

  matches(selector) { return compile(selector)(this); }

  querySelector(selector) { return select(this, selector)[0] || null; }

  querySelectorAll(selector) { return select(this, selector); }

  closest(selector) {
    const pred = compile(selector);
    for (let node = this; node; node = node.parentNode) if (node.nodeType === 1 && pred(node)) return node;
    return null;
  }

  /* ---- events and the rest ---- */

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...(event || {}) };
    for (const handler of this.listeners.get(type) || []) handler(ev);
    return ev;
  }

  click() { return this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  scrollIntoView() {}
  select() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function walk(node, visit) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

/**
 * Compile one compound selector: a tag name, `*`, `.class`, `[attr]`,
 * `[attr="value"]` and `:not(...)`, in any combination. That is the whole set
 * the two page scripts use, and anything else throws.
 */
function compile(selector) {
  const tokens = String(selector).trim().match(/\*|\.[-\w]+|\[[^\]]+\]|:not\([^)]*\)|[-\w]+/g);
  if (!tokens || tokens.join('') !== String(selector).trim()) {
    throw new Error('selector not supported by the test DOM: ' + selector);
  }
  const tests = tokens.map((token) => {
    if (token === '*') return () => true;
    if (token.startsWith('.')) return (el) => el.classList.contains(token.slice(1));
    if (token.startsWith(':not(')) {
      const inner = compile(token.slice(5, -1));
      return (el) => !inner(el);
    }
    if (token.startsWith('[')) {
      const body = token.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq === -1) return (el) => el.getAttribute(body) !== null;
      const name = body.slice(0, eq);
      const want = body.slice(eq + 1).replace(/^["']|["']$/g, '');
      return (el) => el.getAttribute(name) === want;
    }
    const tag = token.toUpperCase();
    return (el) => el.tagName === tag;
  });
  return (el) => tests.every((t) => t(el));
}

/** Split a selector on its top-level spaces, so `:not(...)` stays whole. */
function splitDescendants(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of String(selector)) {
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ' ' && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += c;
  }
  if (current) parts.push(current);
  return parts;
}

function select(root, selector) {
  let current = [root];
  for (const part of splitDescendants(selector)) {
    const pred = compile(part);
    const next = [];
    for (const node of current) walk(node, (el) => { if (pred(el)) next.push(el); });
    current = next;
  }
  return current;
}

/**
 * A document, a window and a CSS, plus `created`, the number of elements made
 * since it was last reset: the measure a render test is really making.
 *
 * getElementById makes an element on first ask rather than parsing the page's
 * markup. The markup is checked elsewhere (the i18n suite reads it directly),
 * and a test that had to list sixty ids would be a test of the harness.
 */
export function makeDom() {
  const byId = new Map();
  const counter = { created: 0 };
  const document = {
    activeElement: null,
    createElement(tag) {
      counter.created += 1;
      return new Element(document, tag);
    },
    createTextNode(text) { return new TextNode(document, text); },
    createRange() { return { selectNodeContents() {} }; },
    getElementById(id) {
      if (!byId.has(id)) {
        const el = new Element(document, id.startsWith('confirm-') || id === 'picker' ? 'dialog' : 'div');
        el.id = id;
        document.documentElement.appendChild(el);
        byId.set(id, el);
      }
      return byId.get(id);
    },
    querySelector(selector) { return select(document.documentElement, selector)[0] || null; },
    querySelectorAll(selector) { return select(document.documentElement, selector); },
  };
  document.documentElement = new Element(document, 'html');
  document.body = document.documentElement.appendChild(new Element(document, 'body'));
  return {
    document,
    window: { close() {}, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    CSS: { escape: (value) => String(value).replace(/["\\]/g, '\\$&') },
    /** Elements created since the last reset. */
    created: () => counter.created,
    reset: () => { counter.created = 0; },
  };
}
