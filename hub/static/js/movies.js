// Movies: what's playing, continue watching, recently added, search, and the drive's health.
import { api, card, empty, h, piLink, when } from "./core.js";

export const every = 30;

function plexUrl(machine, key) {
  return machine && key
    ? piLink(32400, `/web/index.html#!/server/${machine}/details?key=${encodeURIComponent(`/library/metadata/${key}`)}`)
    : piLink(32400, "/web");
}

function poster(item, machine) {
  const img = item.thumb
    ? h("img", { src: `/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`, alt: "", loading: "lazy", decoding: "async" })
    : h("div", { class: "poster-blank", "aria-hidden": "true" }, item.title.slice(0, 1));
  return h("li", { class: "poster" },
    h("a", { href: plexUrl(machine, item.key), target: "_blank", rel: "noopener" },
      h("div", { class: "poster-art" }, img, item.progress ? h("span", { class: "poster-bar" }, h("i", { style: `width:${item.progress}%` })) : null),
      h("span", { class: "poster-title" }, item.title),
      h("span", { class: "poster-meta" }, [item.year, item.minutes ? `${item.minutes} min` : null].filter(Boolean).join(", "))));
}

const shelf = (items, machine, none) => items?.length
  ? h("ul", { class: "shelf" }, items.map((i) => poster(i, machine)))
  : empty(none);

export function mount(state) {
  const input = h("input", { type: "search", id: "movie-search", placeholder: "Search movies and shows", autocomplete: "off", enterkeyhint: "search" });
  state.results = h("div", { class: "results", "aria-live": "polite" });
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { state.results.replaceChildren(); return; }
      try {
        const r = await api(`/api/movies/search?q=${encodeURIComponent(q)}`);
        state.results.replaceChildren(r.results.length
          ? h("ul", { class: "shelf" }, r.results.map((i) => poster(i, state.machine)))
          : empty(`Nothing in the library matches “${q}”.`));
      } catch (e) {
        state.results.replaceChildren(empty("Search isn't available while Plex is down."));
      }
    }, 300);
  });
  state.body = h("div", { class: "stack" });
  state.root.append(
    h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() },
      h("label", { for: "movie-search", class: "sr" }, "Search the library"), input),
    state.results, state.body);
}

export async function load(state) {
  const d = await api("/api/movies");
  state.machine = d.machine;
  const drv = d.drive;
  const drops = d.drive_events.filter((e) => e.kind === "dropped").length;
  state.body.replaceChildren(...[
    d.playing?.length ? card("Playing now", {}, h("ul", { class: "playing" }, d.playing.map((s) => h("li", {},
      h("span", { class: "t" }, s.title),
      h("span", { class: "w" }, [[s.who, s.device].filter(Boolean).join(" on "), s.minutes_left != null ? `${s.minutes_left} min left` : ""].filter(Boolean).join(", ")),
      h("span", { class: "bar" }, h("i", { style: `width:${s.progress}%` })))))) : null,
    h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Continue watching"),
      shelf(d.continue, d.machine, "Nothing half-watched.")),
    h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Recently added"),
      shelf(d.recent, d.machine, drv.state === "Connected" ? "Nothing new lately." : "The movies drive is missing, so Plex can't list new movies.")),
    card("Movies drive", { pill: drv.state, tone: drv.state === "Connected" ? (drv.errors ? "warn" : "ok") : "bad" },
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Movies"), h("dd", {}, drv.count ?? "—")),
        h("div", {}, h("dt", {}, "Free space"), h("dd", {}, drv.free || "—")),
        h("div", {}, h("dt", {}, "Dropouts this week"), h("dd", { dataset: { tone: drops ? "bad" : "ok" } }, String(drops))),
        h("div", {}, h("dt", {}, "Errors since the Pi started"), h("dd", {}, String(drv.errors ?? "—")))),
      drops
        ? h("p", { class: "note" }, "This drive keeps dropping out and its filesystem has errors. Replace it soon, and copy the movies across while it still reads.")
        : null,
      d.drive_events.length
        ? h("ul", { class: "timeline" }, d.drive_events.slice(0, 8).map((e) =>
          h("li", { dataset: { tone: e.kind === "dropped" ? "bad" : "ok" } }, h("span", {}, e.kind === "dropped" ? "Dropped out" : "Came back"), h("time", {}, when(e.ts)))))
        : null),
    h("a", { class: "action", href: piLink(32400, "/web"), target: "_blank", rel: "noopener" }, "Open Plex"),
  ].filter(Boolean));
}
