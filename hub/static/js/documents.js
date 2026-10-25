// Documents: find a paper in Paperless, scan one, print one, and the household lists.
import { ensure, h, whoami } from "./core.js";
import { toolUrl } from "./sections.js";
import { linkGroup } from "./section-links.js";

export const every = 600;

async function documents(q) {
  if ((await whoami())?.role !== "owner") return { signedOut: true };
  const r = await fetch(`/api/documents?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (r.status === 401) return { signedOut: true };
  if (!r.ok) throw new Error(`The hub answered ${r.status}.`);
  return r.json();
}

function results(state, d, q) {
  if (d.signedOut) {
    return [h("p", { class: "meta" }, "Documents are private. Sign in as the owner to search them."),
      h("button", { type: "button", class: "btn", onclick: async () => { if (await ensure("owner")) search(state, q); } }, "Sign in")];
  }
  if (!d.available) return [h("p", { class: "meta" }, "Paperless isn't answering. The PC may be off.")];
  if (!d.results.length) return [h("p", { class: "meta" }, q ? `Nothing matches “${q}”.` : "No documents yet.")];
  return [h("h3", { class: "section-title" }, q ? `Matches for “${q}”` : "Recent documents"),
    h("ul", { class: "more" }, d.results.map((r) => h("li", {},
      h("a", { href: r.link, target: "_blank", rel: "noopener" }, h("strong", {}, r.title), h("span", { class: "meta" }, r.created)))))];
}

async function search(state, q) {
  state.results.setAttribute("aria-busy", "true");
  try {
    state.results.replaceChildren(...results(state, await documents(q), q));
  } catch {
    state.results.replaceChildren(h("p", { class: "meta" }, "Couldn't search just now. Try again."));
  } finally {
    state.results.setAttribute("aria-busy", "false");
  }
}

export function mount(state) {
  state.query = h("input", { type: "search", name: "q", placeholder: "A bill, a statement, a warranty…", autocomplete: "off",
    "aria-label": "Find a document" });
  state.results = h("div", { class: "doc-results", "aria-live": "polite" });
  const form = h("form", { class: "doc-search", role: "search",
    onsubmit: (e) => { e.preventDefault(); search(state, state.query.value.trim()); } },
    state.query, h("button", { type: "submit", class: "btn" }, "Find"));
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Find a document"), form, state.results,
      h("a", { class: "tool-link", href: toolUrl("paperless"), target: "_blank", rel: "noopener" }, "Open Paperless ↗")),
    linkGroup("More with papers", [
      [toolUrl("scan"), "Scan a document ↗", "From the HP or the Epson, straight into Paperless"],
      ["/print", "Print", "Print a file and check the queue"],
      ["/lists", "Lists", "Shopping, to-dos and notes"],
    ]));
}

export async function load(state) {
  if (!state.loaded) { state.loaded = true; await search(state, ""); }
}
