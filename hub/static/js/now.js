// Now: the one-line answer, the print band, what needs a look, and a card per area.
import { api, card, h, piLink, spark } from "./core.js";

export const every = 15;

const finishAt = (m) => Number.isFinite(m) ? new Date(Date.now() + m * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

export function band(p) {
  const pct = p.progress || 0;
  const detail = p.state === "printing" && p.left
    ? ["Done in about ", h("strong", {}, p.left), finishAt(p.minutes_left) ? `, around ${finishAt(p.minutes_left)}` : ""]
    : [p.detail || ""];
  return h("section", { class: "band", dataset: { state: p.state }, "aria-label": "Bambu X2D" },
    h("p", { class: "band-name" }, "Bambu X2D"),
    h("h2", { class: "band-headline" }, p.headline),
    h("div", { class: "line", role: "progressbar", "aria-label": "Print progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct },
      h("div", { class: "line-track" }),
      h("div", { class: "line-bead", style: `width:${pct}%` }),
      h("div", { class: "line-nozzle", style: `left:${pct}%` })),
    h("p", { class: "band-detail" }, ...detail));
}

export function mount(state) {
  state.summary = h("p", { class: "summary", "aria-live": "polite", dataset: { tone: "none" } }, "Checking the house…");
  state.band = h("div");
  state.issues = h("div");
  state.cards = h("div", { class: "cards" });
  state.root.append(state.summary, state.band, state.issues, state.cards);
}

function fact(label, value, tone) {
  return h("div", {}, h("dt", {}, label), h("dd", { dataset: tone ? { tone } : {} }, value ?? "—"));
}

export async function load(state) {
  const d = await api("/api/now");
  const worst = d.issues.some((i) => i.tone === "bad") ? "bad" : d.issues.length ? "warn" : "ok";
  state.summary.textContent = d.summary;
  state.summary.dataset.tone = worst;
  state.band.replaceChildren(band(d.printer));

  state.issues.replaceChildren(d.issues.length
    ? h("section", { class: "issues", "aria-label": "Needs a look" },
      h("h2", { class: "section-title" }, "Needs a look"),
      h("ul", {}, d.issues.map((i) => h("li", { class: "issue", dataset: { tone: i.tone } },
        h("span", { class: "dot" }), h("strong", {}, i.what), h("span", { class: "say" }, i.say)))))
    : "");

  const m = d.movies;
  const playing = m.playing === null ? [h("li", { class: "empty" }, "Plex isn't answering.")]
    : !m.playing.length ? [h("li", { class: "empty" }, "Nothing playing.")]
      : m.playing.map((s) => h("li", {},
        h("span", { class: "t" }, s.title),
        h("span", { class: "w" }, [s.state === "paused" ? "Paused" : "", [s.who, s.device].filter(Boolean).join(" on "),
          s.minutes_left != null ? `${s.minutes_left} min left` : ""].filter(Boolean).join(", ")),
        h("span", { class: "bar" }, h("i", { style: `width:${s.progress}%` }))));

  const p = d.pi;
  const cpu = p.cpu_series?.at(-1);
  const w = d.workshop;

  state.cards.replaceChildren(
    card("Movies", { pill: !m.plex_running ? "Plex stopped" : m.drive === "Connected" ? "Ready" : "No movies", tone: m.tone },
      h("p", { class: "big" }, m.count != null ? `${m.count} movies` : m.drive === "Connected" ? "Movies" : "Drive missing"),
      h("p", { class: "meta" }, m.drive === "Connected" ? `Movies drive connected, ${m.free} free` : "Waiting for the movies drive."),
      h("h3", { class: "sub" }, "Playing now"),
      h("ul", { class: "playing" }, playing),
      h("a", { class: "action", href: "/movies", "data-link": true }, "Browse movies")),
    card("Workshop", {},
      h("dl", { class: "facts" },
        fact("Bambu X2D", d.printer.headline),
        fact("Workshop display", w.display === "Online" ? `Online, ${w.display_firmware}` : w.display,
          w.display === "Online" ? "ok" : w.display === "Offline" ? "bad" : null),
        fact("Local AI", w.ai, w.ai === "Down" ? "bad" : "ok"),
        fact("Models loaded", w.ai === "Down" ? "—" : String(w.ai_models ?? 0))),
      h("a", { class: "action", href: "/workshop", "data-link": true }, "Print history")),
    card("Home", { pill: d.home.homebridge_running ? "Running" : "Stopped", tone: d.home.tone },
      h("p", { class: "big" }, d.home.homebridge_running ? "Homebridge running" : "Homebridge stopped"),
      h("p", { class: "meta" }, "Light, plug and scene controls will appear here."),
      h("div", { class: "quick" },
        h("a", { class: "chip", href: "/lists", "data-link": true }, "Shopping list"),
        h("a", { class: "chip", href: "/print", "data-link": true }, "Print something"),
        h("a", { class: "chip", href: piLink(8581), target: "_blank", rel: "noopener" }, "Homebridge"))),
    card("Raspberry Pi", { pill: p.tone === "ok" ? "Healthy" : "Check", tone: p.tone },
      h("div", { class: "gauges" },
        h("figure", { class: "gauge" }, h("figcaption", {}, "Temperature"),
          h("p", { class: "gauge-value" }, p.temp != null ? `${Math.round(p.temp)} °C` : "—"), spark(p.temp_series, { max: 90 })),
        h("figure", { class: "gauge" }, h("figcaption", {}, "Processor"),
          h("p", { class: "gauge-value" }, cpu != null ? `${Math.round(cpu)}%` : "—"), spark(p.cpu_series, { max: 100 })),
        h("figure", { class: "gauge" }, h("figcaption", {}, "Memory free"),
          h("p", { class: "gauge-value" }, p.mem_free_gb != null ? `${p.mem_free_gb} GB` : "—"), spark(p.mem_series, { max: 100 }))),
      h("dl", { class: "facts" },
        fact("Power", p.power ?? "—", p.power === "Good" ? "ok" : p.power ? "bad" : null),
        fact("Free space", p.disk_free_gb != null ? `${p.disk_free_gb} GB` : "—"),
        fact("Updates waiting", p.updates == null ? "—" : String(p.updates))),
      h("a", { class: "action", href: "/pi", "data-link": true }, "Pi details")),
  );
}

export function failed(state) {
  state.summary.textContent = "Can't reach the Pi Hub right now. It will keep trying.";
  state.summary.dataset.tone = "bad";
}
