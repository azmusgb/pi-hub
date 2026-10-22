import { mountMovieNight, refreshMovieNight } from "./movie-night.js";
// Movies: what's playing, continue watching, recently added, search, and the drive's health.
import { api, card, empty, ensure, h, piLink, post, toast, when } from "./core.js";

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
  const left = item.minutes && item.progress ? Math.round(item.minutes * (1 - item.progress / 100)) : null;
  return h("li", { class: "poster" },
    h("a", { href: plexUrl(machine, item.key), target: "_blank", rel: "noopener" },
      h("div", { class: "poster-art" },
        img,
        item.progress ? h("span", { class: "poster-bar" }, h("i", { style: `width:${item.progress}%` })) : null,
        left ? h("span", { class: "poster-left" }, `${left}m left`) : null),
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
  state.resume = h("div");
  state.night = mountMovieNight(state);
  state.root.append(
    h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() },
      h("label", { for: "movie-search", class: "sr" }, "Search the library"), input),
    state.results, state.resume, state.night, state.body);
}

function requestsCard(state, requests) {
  const input = h("input", { type: "text", id: "req-new", maxlength: 200, placeholder: "A movie or show to get", autocomplete: "off" });
  const open = requests.filter((r) => !r.done);
  return card("Movie requests", { pill: open.length ? `${open.length} wanted` : null, tone: "warn" },
    h("form", { class: "add", onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try { await post("/api/lists/requests", { text: input.value }); input.value = ""; state.force = true; load(state); }
      catch (x) { toast(x.message, "bad"); }
    } }, h("label", { for: "req-new", class: "sr" }, "Request a movie"), input, h("button", { type: "submit", class: "primary" }, "Request")),
    requests.length ? h("ul", { class: "items" }, requests.map((r) => h("li", { class: `item ${r.done ? "done" : ""}` },
      h("input", { type: "checkbox", id: `req-${r.id}`, checked: !!r.done, "aria-label": `Got ${r.text}`,
        onchange: async () => { await post(`/api/lists/requests/${r.id}/toggle`); state.force = true; load(state); } }),
      h("label", { for: `req-${r.id}` }, r.text),
      h("button", { class: "ghost small", "aria-label": `Remove ${r.text}`, onclick: async () => { await post(`/api/lists/requests/${r.id}/delete`); state.force = true; load(state); } }, "Remove"))))
      : empty("Nothing requested. Anyone can add a movie they'd like."));
}

function watchingNow(w) {
  if (!w) return null;
  const top = Math.max(1, ...w.nights.map((n) => n.count));
  const most = Math.max(1, ...w.people.map((p) => p.count));
  return h("div", { class: "watching" },
    h("p", { class: "watch-sum" }, h("strong", {}, `${w.watched} watched`), ` in the last ${w.days} days, about ${w.hours} hours.`,
      w.busiest ? ` ${w.busiest} are movie night.` : ""),
    h("div", { class: "nights", role: "img", "aria-label": `Watching by day of the week: ${w.nights.map((n) => `${n.day} ${n.count}`).join(", ")}` },
      w.nights.map((n) => h("span", { class: "night" }, h("i", { style: `height:${Math.round((n.count / top) * 100)}%` }), h("b", {}, n.day.slice(0, 2))))),
    w.people.length > 1 ? h("ul", { class: "people-bars" }, w.people.map((p) => h("li", {},
      h("span", {}, p.name), h("span", { class: "meter" }, h("i", { style: `width:${Math.round((p.count / most) * 100)}%`, dataset: { tone: "ok" } })),
      h("span", { class: "meta" }, String(p.count))))) : null,
    w.again.length ? h("p", { class: "meta" }, "Watched more than once: " + w.again.map((a) => `${a.title} (${a.count})`).join(", ") + ".") : null);
}

function statsCard(d) {
  const s = d.stats;
  if (!s) return null;
  const hist = d.history || [];
  return card("Watching", { pill: `${s.watched} of ${s.movies} watched`, tone: "ok" },
    watchingNow(d.watching),
    h("dl", { class: "facts" },
      h("div", {}, h("dt", {}, "Library size"), h("dd", {}, `${s.total_gb} GB`)),
      h("div", {}, h("dt", {}, "Never watched"), h("dd", {}, `${s.unwatched} movies, ${s.unwatched_gb} GB`))),
    hist.length ? [h("h3", { class: "sub" }, "Recently watched"), h("ul", { class: "log" }, hist.slice(0, 6).map((w) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: "ok" } }), h("span", { class: "log-main" }, h("strong", {}, w.title), w.who ? h("span", { class: "meta" }, w.who) : null),
      h("span", { class: "log-side" }, w.when ? when(w.when) : ""))))] : null,
    s.never_watched_old.length ? [h("h3", { class: "sub" }, "Never watched, added over 6 months ago"),
      h("p", { class: "meta" }, "The biggest first, if you want to free up space."),
      h("ul", { class: "pkg" }, s.never_watched_old.slice(0, 8).map((u) => h("li", {}, h("span", {}, `${u.title}${u.year ? ` (${u.year})` : ""}`), h("span", { class: "meta" }, `${u.gb} GB`))))] : null);
}

// The page's one bold thing: the film you were last watching, full width, ready to resume.
function hero(item, machine) {
  if (!item) return null;
  const art = item.art || item.thumb;
  const left = item.minutes && item.progress ? Math.round(item.minutes * (1 - item.progress / 100)) : null;
  return h("section", { class: "movie-hero", "aria-label": "Pick up where you left off" },
    art ? h("img", { class: "movie-hero-art", src: `/api/plex/thumb?wide=${item.art ? 1 : 0}&path=${encodeURIComponent(art)}`, alt: "", decoding: "async" }) : null,
    h("div", { class: "movie-hero-body" },
      h("p", { class: "movie-hero-kicker" }, "Pick up where you left off"),
      h("h2", { class: "movie-hero-title" }, item.title),
      h("p", { class: "meta" }, [item.year, left != null ? `${left} min left` : null].filter(Boolean).join(", ")),
      item.progress ? h("span", { class: "movie-hero-bar" }, h("i", { style: `width:${item.progress}%` })) : null,
      h("a", { class: "primary movie-hero-go", href: plexUrl(machine, item.key), target: "_blank", rel: "noopener" }, "Resume in Plex")));
}

export async function load(state) {
  refreshMovieNight(state);
  if (!state.force && document.activeElement?.id === "req-new" && document.activeElement.value) return;
  state.force = false;
  const d = await api("/api/movies");
  state.machine = d.machine;
  const drv = d.drive;
  const drops = d.drive_events.filter((e) => e.kind === "dropped").length;
  state.resume.replaceChildren(...[hero(d.continue?.[0], d.machine)].filter(Boolean));
  state.body.replaceChildren(...[
    d.playing?.length ? card("Playing now", {}, h("ul", { class: "playing" }, d.playing.map((s) => h("li", {},
      h("span", { class: "t" }, s.title),
      h("span", { class: "w" }, [[s.who, s.device].filter(Boolean).join(" on "), s.minutes_left != null ? `${s.minutes_left} min left` : ""].filter(Boolean).join(", ")),
      h("span", { class: "bar" }, h("i", { style: `width:${s.progress}%` })))))) : null,
    d.continue?.length > 1 ? h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Also half-watched"),
      shelf(d.continue.slice(1), d.machine, "")) : null,
    h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Recently added"),
      shelf(d.recent, d.machine, drv.state === "Connected" ? "Nothing new lately." : "The movies drive is missing, so Plex can't list new movies.")),
    h("details", { class: "supporting-details", open: state.detailsOpen,
      ontoggle: e => { state.detailsOpen = e.currentTarget.open; } }, h("summary", {}, "Movie requests, library & storage details"),
      requestsCard(state, d.requests), statsCard(d),
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
      h("a", { class: "action", href: "/drives", "data-link": true }, "Check movie storage")),
    h("a", { class: "action", href: piLink(32400, "/web"), target: "_blank", rel: "noopener" }, "Open Plex"),
  ].filter(Boolean));
}
