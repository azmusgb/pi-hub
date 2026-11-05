// A small DOM for node tests that render pages with core.js's h(): elements, text, attributes, dataset, classes,
// events, focus and simple selectors (tag, #id, .class, [attr], [attr="v"], descendant and >). Not a browser: enough
// to drive a page's mount() and load() and read what it drew. install() puts it on globalThis; uninstall() takes it off.

class Node {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === globalThis.document?.documentElement;
  }
  remove() {
    const p = this.parentNode;
    if (!p) return;
    if (globalThis.document && this.contains(globalThis.document.activeElement)) globalThis.document.activeElement = globalThis.document.body;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.replaceChildren(String(v ?? "")); }
}

class Text extends Node {
  constructor(data) { super(); this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

const REFLECT = ["hidden", "disabled", "open", "checked"];

class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { cssText: "", setProperty() {} };
    this.listeners = {};
    this.classList = {
      add: (...c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); this.className = [...s].join(" "); },
      remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const has = this.classList.contains(c); const want = on ?? !has; if (want) this.classList.add(c); else this.classList.remove(c); return want; },
    };
  }
  get className() { return this.attributes.get("class") || ""; }
  set className(v) { this.attributes.set("class", String(v)); }
  get id() { return this.attributes.get("id") || ""; }
  set id(v) { this.attributes.set("id", String(v)); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  append(...kids) { for (const k of kids) this.appendChild(k); }
  prepend(...kids) { kids.reverse().forEach((k) => this.insertBefore(k, this.firstChild)); }
  appendChild(k) { return this.insertBefore(k, null); }
  insertBefore(k, ref) {
    const node = k instanceof Node ? k : new Text(k);
    node.remove();
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }
  replaceChildren(...kids) {
    [...this.childNodes].forEach((c) => c.remove());
    this.append(...kids);
  }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); this.remove(); } }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) { ev.target ||= this; for (const fn of this.listeners[ev.type] || []) fn(ev); return true; }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click", preventDefault() {} }); }
  focus() { if (this.isConnected) globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = globalThis.document.body; }
  scrollIntoView() {}
  closest(sel) { for (let n = this; n instanceof Element; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (sel.split(",").some((s) => matches(c, s.trim()))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
for (const name of REFLECT) {
  Object.defineProperty(Element.prototype, name, {
    get() { return this.attributes.has(name); },
    set(v) { if (v) this.attributes.set(name, ""); else this.attributes.delete(name); if (name === "open") this.dispatchEvent({ type: "toggle" }); },
  });
}
for (const name of ["href", "src", "type", "title", "alt", "value", "name"]) {
  Object.defineProperty(Element.prototype, name, {
    get() { return this.attributes.get(name) ?? ""; },
    set(v) { this.attributes.set(name, String(v)); },
  });
}

// One compound selector against one element.
function simple(el, sel) {
  const re = /([#.]?[\w-]+|\[[^\]]+\]|\*)/g;
  for (const part of sel.match(re) || []) {
    if (part === "*") continue;
    if (part[0] === "#") { if (el.id !== part.slice(1)) return false; }
    else if (part[0] === ".") { if (!el.classList.contains(part.slice(1))) return false; }
    else if (part[0] === "[") {
      const m = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(part);
      const data = m[1].startsWith("data-") ? el.dataset[m[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : undefined;
      const val = el.getAttribute(m[1]) ?? data ?? null;
      if (val === null || (m[2] !== undefined && val !== m[2])) return false;
    } else if (el.tagName !== part.toUpperCase()) return false;
  }
  return true;
}

function matches(el, sel) {
  const parts = sel.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
  let i = parts.length - 1;
  if (!simple(el, parts[i])) return false;
  let n = el;
  while (--i >= 0) {
    if (parts[i] === ">") { i--; n = n.parentNode; if (!(n instanceof Element) || !simple(n, parts[i])) return false; continue; }
    do { n = n.parentNode; } while (n instanceof Element && !simple(n, parts[i]));
    if (!(n instanceof Element)) return false;
  }
  return true;
}

// h() sets data-* through dataset; selectors on [data-x] read it back.
export function install({ fetch: routes = {}, confirm = true } = {}) {
  const documentElement = new Element("html");
  const body = new Element("body");
  documentElement.append(body);
  const doc = {
    documentElement, body, activeElement: body, hidden: false,
    createElement: (t) => new Element(t),
    createTextNode: (t) => new Text(t),
    getElementById: (id) => documentElement.querySelector(`#${id}`),
    querySelector: (s) => documentElement.querySelector(s),
    querySelectorAll: (s) => documentElement.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  const saved = { document: globalThis.document, Node: globalThis.Node, fetch: globalThis.fetch, location: globalThis.location, window: globalThis.window,
    ApplianceConfirm: globalThis.ApplianceConfirm };
  // No browser confirm() (A7 P7: a page that still calls it fails here). The kit's inline confirm answers yes unless a
  // test passes `confirm: false` or its own ask.
  globalThis.window = {};
  globalThis.ApplianceConfirm = { ask: typeof confirm === "function" ? confirm : async () => confirm !== false };
  globalThis.document = doc;
  globalThis.Node = Node;
  globalThis.location = { hostname: "hub.test", protocol: "http:", host: "hub.test", pathname: "/", search: "", href: "http://hub.test/" };
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url).split("?")[0];
    const r = typeof routes === "function" ? routes(String(url), opts) : routes[path];
    const body = await (typeof r === "function" ? r(String(url), opts) : r);
    if (body === undefined || body instanceof Error) return new Response(JSON.stringify({ detail: "not here" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return {
    document: doc,
    root() { const r = new Element("div"); body.append(r); return r; },
    uninstall() { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } },
  };
}

export const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
