// Documents: find a paper in Paperless, scan one, print one, and the household lists. A7 P1: the faceplate says whether
// Paperless answers; "Find a document" is the page's form, kept as a section.
import { ensure, h, whoami } from "./core.js";
import { resolveLink } from "./sections.js";
import { openInRow } from "./section-links.js";
import { faceplate, faceplateLoading, section } from "./page-parts.js";

export const every = 600;

const NAME = "Paperless, on the PC";

async function documents(q) {
  if ((await whoami())?.role !== "owner") return { signedOut: true };
  const r = await fetch(`/api/documents?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (r.status === 401) return { signedOut: true };
  if (!r.ok) throw new Error(`The hub answered ${r.status}.`);
  return r.json();
}

// The faceplate and sources line for one answer from /api/documents (or none, when the search failed). Signed out is
// "unknown", never "answering": the hub can't see Paperless for this viewer.
export function documentsPlate(d) {
  if (!d) {
    return { sources: [{ name: "Paperless", tone: "unknown", word: "couldn't check" }],
      plate: faceplate({ name: NAME, lamp: ["unknown", "Unknown"], caption: "Couldn't reach the hub's search just now." }) };
  }
  if (d.signedOut) {
    return { sources: [{ name: "Paperless", tone: "unknown", word: "sign in to check" }],
      plate: faceplate({ name: NAME, lamp: ["unknown", "Private"], caption: "Documents are private. Sign in as the owner to search them." }) };
  }
  if (!d.available) {
    return { sources: [{ name: "Paperless", tone: "bad", word: "isn't answering" }],
      plate: faceplate({ name: NAME, lamp: ["bad", "Not answering"], caption: "Paperless isn't answering. The PC may be off." }) };
  }
  return { sources: [{ name: "Paperless", tone: "ok" }],
    plate: faceplate({ name: NAME, lamp: ["ok", "Answering"], caption: "Search titles and text of every scanned paper." }) };
}

function results(state, d, q) {
  if (d.signedOut) {
    return [h("button", { type: "button", class: "ui-btn", onclick: async () => { if (await ensure("owner")) search(state, q); } }, "Sign in")];
  }
  if (!d.available) return [h("p", { class: "meta" }, "Search returns when Paperless answers.")];
  if (!d.results.length && q) return [h("p", { class: "meta" }, `Nothing matches “${q}”.`)];
  // Zero from Paperless can mean an empty library or papers the hub's view-only login can't see: say both, and the
  // next step (iPad, 1 Nov: a flat "No documents yet").
  if (!d.results.length) {
    return [h("p", { class: "meta" }, "Paperless shows the hub no documents. Scan a paper to add one, or, if Paperless " +
      "already has some, give the hub's view-only user permission to see them.")];
  }
  return [h("h3", { class: "section-title" }, q ? `Matches for “${q}”` : "Recent documents"),
    h("ul", { class: "ui-rows" }, d.results.map((r) => h("li", { class: "ui-row" },
      h("div", {}, h("a", { class: "ui-row__title", href: resolveLink(r.link), target: "_blank", rel: "noopener" }, `${r.title} ↗`),
        h("span", { class: "ui-row__detail" }, r.created)))))];
}

async function search(state, q) {
  state.results.setAttribute("aria-busy", "true");
  let d = null;
  try {
    d = await documents(q);
    state.results.replaceChildren(...results(state, d, q));
  } catch {
    state.results.replaceChildren(h("p", { class: "meta" }, "Couldn't search just now. Try again."));
  } finally {
    state.results.setAttribute("aria-busy", "false");
  }
  const v = documentsPlate(d);
  state.sources = v.sources;
  state.plate.replaceChildren(v.plate);
}

export function mount(state) {
  state.plate = h("div", {}, faceplateLoading(NAME));
  state.query = h("input", { type: "search", name: "q", placeholder: "A bill, a statement, a warranty…", autocomplete: "off",
    "aria-label": "Find a document" });
  state.results = h("div", { class: "doc-results", "aria-live": "polite" });
  const form = h("form", { class: "doc-search", role: "search",
    onsubmit: (e) => { e.preventDefault(); search(state, state.query.value.trim()); } },
    state.query, h("button", { type: "submit", class: "ui-btn ui-btn--primary" }, "Find"));
  state.root.append(state.plate, section("Find a document", [form, state.results]), openInRow("papers"));
}

export async function load(state) {
  if (!state.loaded) { state.loaded = true; await search(state, ""); }
}
