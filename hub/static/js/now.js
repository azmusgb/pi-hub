// Now: the one-line answer, the print band, what needs a look, and a card per area.
import { api, card, clockTime, ensure, fix, h, piLink, post, spark, toast } from "./core.js";
import { tile } from "./control.js";

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

function askBox() {
  const input = h("input", { type: "text", id: "ask-input", maxlength: 400, placeholder: "Ask about the house, like “Why did Plex stop?”", autocomplete: "off", enterkeyhint: "send" });
  const answer = h("div", { class: "ask-answer", "aria-live": "polite" });
  const btn = h("button", { type: "submit", class: "primary" }, "Ask");
  return h("form", { class: "ask", role: "search", "aria-label": "Ask Local AI", onsubmit: async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || !(await ensure("household"))) return;
    btn.disabled = true;
    answer.replaceChildren(h("p", { class: "meta" }, "Asking Local AI…"));
    try {
      const r = await post("/api/ask", { question: q });
      answer.replaceChildren(h("p", { class: "ask-q" }, q), h("p", { class: "ask-a" }, r.answer));
      input.value = "";
    } catch (x) { answer.replaceChildren(h("p", { class: "note" }, x.message)); }
    btn.disabled = false;
  } }, h("label", { for: "ask-input", class: "sr" }, "Ask about the house"), h("div", { class: "ask-row" }, input, btn), answer);
}

function outsideLine(o) {
  const bits = [];
  if (o?.weather) {
    const w = o.weather, t = w.days[0];
    bits.push(h("span", { class: "out-weather" }, h("strong", {}, `${w.now.temp}°`), ` ${w.now.sky}, high ${t.high}°${t.rain >= 30 ? `, ${t.rain}% rain` : ""}`));
  }
  const next = o?.calendar?.find((e) => e.all_day || e.start * 1000 > Date.now() - 30 * 60000);
  if (next) bits.push(h("span", { class: "out-next" }, "Next: ", h("strong", {}, next.all_day ? next.title : `${clockTime(next.start)} ${next.title}`)));
  return bits.length ? h("p", { class: "outside" }, ...bits) : "";
}

export function mount(state) {
  state.summary = h("p", { class: "summary", "aria-live": "polite", dataset: { tone: "none" } }, "Checking the house…");
  state.outside = h("div");
  state.band = h("div");
  state.issues = h("div");
  state.ask = document.body.classList.contains("wall") ? "" : askBox();
  state.cards = h("div", { class: "cards" });
  state.root.append(state.summary, state.outside, state.band, state.issues, state.ask, state.cards);
}

function fact(label, value, tone) {
  return h("div", {}, h("dt", {}, label), h("dd", { dataset: tone ? { tone } : {} }, value ?? "—"));
}

export async function load(state) {
  const [d, out, home, wifi] = await Promise.all([
    api("/api/now"),
    api("/api/outside").catch(() => null),
    api("/api/home").catch(() => ({ connected: false, accessories: [], favourites: [] })),
    api("/api/wifi").catch(() => ({ set: false })),
  ]);
  state.outside.replaceChildren(outsideLine(out));
  const favs = home.accessories.filter((a) => home.favourites.includes(a.id));
  const worst = d.issues.some((i) => i.tone === "bad") ? "bad" : d.issues.length ? "warn" : "ok";
  state.summary.textContent = d.summary;
  state.summary.dataset.tone = worst;
  state.band.replaceChildren(band(d.printer));

  state.issues.replaceChildren(d.issues.length
    ? h("section", { class: "issues", "aria-label": "Needs a look" },
      h("h2", { class: "section-title" }, "Needs a look"),
      h("ul", {}, d.issues.map((i) => h("li", { class: "issue", dataset: { tone: i.tone } },
        h("span", { class: "dot" }), h("strong", {}, i.what), h("span", { class: "say" }, i.say),
        i.fix ? h("button", { class: "ghost fix-btn", onclick: async () => { if (await fix(i.fix, i.fix_label)) load(state); } }, i.fix_label) : null))))
    : "");

  const m = d.movies;
  const playing = m.playing === null ? [h("li", { class: "empty" }, "Plex isn't answering.")]
    : !m.playing.length ? [h("li", { class: "empty" }, "Nothing playing.")]
      : m.playing.map((s) => h("li", {},
        h("span", { class: "t" }, s.title),
        h("span", { class: "w" }, [s.state === "paused" ? "Paused" : "", [s.who, s.device].filter(Boolean).join(" on "),
          s.minutes_left != null ? `${s.minutes_left} min left` : ""].filter(Boolean).join(", ")),
        h("span", { class: "bar" }, h("i", { style: `width:${s.progress}%` }))));

  if (document.body.classList.contains("wall")) { wallView(state, d, home, wifi, out); return; }

  const p = d.pi;
  const cpu = p.cpu_series?.at(-1);
  const w = d.workshop;

  state.cards.replaceChildren(...[
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
      favs.length
        ? h("div", { class: "tiles compact" }, favs.map((a) => tile(a, state)))
        : [h("p", { class: "big" }, d.home.homebridge_running ? "Homebridge running" : "Homebridge stopped"),
          h("p", { class: "meta" }, home.connected ? "Star lights and plugs on the Control page to see them here." : "Connect Homebridge in Settings to switch lights from here.")],
      h("div", { class: "quick" },
        h("a", { class: "chip", href: "/control", "data-link": true }, "All controls"),
        h("a", { class: "chip", href: "/lists", "data-link": true }, "Shopping list"),
        h("a", { class: "chip", href: "/print", "data-link": true }, "Print something"),
        h("a", { class: "chip", href: piLink(8581), target: "_blank", rel: "noopener" }, "Homebridge"))),
    wifi.set ? card("Guest Wi-Fi", { cls: "wifi-card" },
      h("div", { class: "wifi" },
        h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 168, height: 168 }),
        h("div", {}, h("p", { class: "big" }, wifi.ssid),
          h("p", { class: "meta" }, "Point a phone camera at the code to join."),
          wifi.password ? h("p", { class: "meta" }, "Password: ", h("strong", { class: "secret" }, wifi.password)) : null))) : null,
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
  ].filter(Boolean));
}

function wallView(state, d, home, wifi, out) {
  // The wall: read from across the room. Big time, the day ahead, the printer, and only what needs a person.
  const now = new Date();
  const dim = now.getHours() >= 22 || now.getHours() < 6;
  document.body.classList.toggle("night", dim);
  const w = out?.weather;
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 0);
  const agenda = (out?.calendar || []).filter((e) => e.start * 1000 <= todayEnd.getTime() + 86400000).slice(0, 4);
  state.cards.replaceChildren(h("div", { class: "wall-grid" },
    h("section", { class: "wall-clock" },
      h("p", { class: "wall-time" }, now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })),
      h("p", { class: "wall-date" }, now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })),
      w ? h("p", { class: "wall-weather" }, h("strong", {}, `${w.now.temp}°`), ` ${w.now.sky}. High ${w.days[0].high}°, low ${w.days[0].low}°.`) : null),
    h("section", { class: "wall-agenda" }, h("h2", { class: "section-title" }, "Coming up"),
      agenda.length ? h("ul", {}, agenda.map((e) => h("li", {},
        h("span", { class: "wall-when" }, e.all_day ? "All day" : clockTime(e.start)), h("span", {}, e.title))))
        : h("p", { class: "meta" }, out?.calendar_set ? "Nothing on the calendar today." : "Connect a calendar in Settings to see the day here.")),
    wifi.set ? h("section", { class: "wall-wifi" }, h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr" }),
      h("p", {}, "Guest Wi-Fi: ", h("strong", {}, wifi.ssid))) : null,
  ));
}

export function failed(state) {
  state.summary.textContent = "Can't reach the Pi Hub right now. It will keep trying.";
  state.summary.dataset.tone = "bad";
}
