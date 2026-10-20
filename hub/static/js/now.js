// Now: the one-line answer, the print band, what needs a look, and a card per area.
import { api, clockTime, ensure, fix, h, post, spark, weatherIcon } from "./core.js";
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
    bits.push(h("a", { class: "out-weather", href: "/weather", "data-link": true }, weatherIcon(w.now.icon, w.now.sky),
      h("strong", {}, `${w.now.temp}°`), ` ${w.now.sky}, high ${t.high}°`));
    if (w.alerts?.length) bits.push(h("a", { class: "out-alert", href: "/weather", "data-link": true }, w.alerts[0].event));
    else if (w.soon) bits.push(h("span", { class: "out-soon" }, w.soon));
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
  state.cards = h("div", { class: "now-side" });
  state.root.append(state.summary, state.outside, state.band, state.issues, state.ask, state.cards);
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

  // The house: one quiet panel, a row per area. The whole row opens its page; status is a dot plus words.
  const row = (name, href, tone, say, extra) => h("li", { class: "house-item" },
    h("a", { class: "house-row", href, "data-link": true },
      h("span", { class: "house-name" }, name),
      h("span", { class: "dot", dataset: { tone } }),
      h("span", { class: "house-say" }, say),
      h("span", { class: "chev", "aria-hidden": "true" }, "›")),
    extra || null);
  const mSay = !m.plex_running ? "Plex has stopped"
    : m.drive === "Connected" ? `${m.count ?? "Your"} movies, ${m.free} free` : "The movies drive is missing";
  const wSay = [w.display === "Online" ? "Display online" : `Display ${String(w.display).toLowerCase()}`,
    w.ai === "Down" ? "Local AI down" : `Local AI ${w.ai.toLowerCase()}`].join(", ");
  const hSay = !d.home.homebridge_running ? "Homebridge has stopped"
    : favs.length ? `${favs.filter((a) => a.on).length} of ${favs.length} favourites on`
      : home.connected ? "Star lights and plugs on Control to see them here" : "Connect Homebridge in Settings to switch lights here";
  const pSay = [p.temp != null ? `${Math.round(p.temp)} °C` : null, cpu != null ? `${Math.round(cpu)}% busy` : null,
    p.power === "Good" ? "power good" : p.power ? `power: ${p.power.toLowerCase()}` : null,
    p.updates ? `${p.updates} updates waiting` : null].filter(Boolean).join(", ");
  const playingNow = m.playing?.length ? h("ul", { class: "playing house-extra" }, playing) : null;

  state.cards.replaceChildren(...[
    h("section", { class: "house", "aria-labelledby": "house-title" },
      h("h2", { class: "section-title", id: "house-title" }, "The house"),
      h("ul", { class: "house-list" },
        row("Movies", "/movies", m.tone, mSay, playingNow),
        row("Workshop", "/workshop", w.display === "Online" && w.ai !== "Down" ? "ok" : "warn", wSay),
        row("Home", "/control", d.home.tone, hSay, favs.length ? h("div", { class: "tiles compact house-extra" }, favs.map((a) => tile(a, state))) : null),
        row("Raspberry Pi", "/pi", p.tone, pSay, h("div", { class: "house-extra house-spark", "aria-hidden": "true" }, spark(p.temp_series, { max: 90 }))))),
    wifi.set ? h("section", { class: "wifi-panel", "aria-label": "Guest Wi-Fi" },
      h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 132, height: 132 }),
      h("div", {}, h("p", { class: "wifi-name" }, wifi.ssid), h("p", { class: "meta" }, "Guests: point a phone camera at the code to join."),
        wifi.password ? h("p", { class: "meta" }, "Password ", h("strong", { class: "secret" }, wifi.password)) : null)) : null,
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
      w ? h("div", { class: "wall-weather" }, weatherIcon(w.now.icon, w.now.sky),
        h("p", {}, h("strong", {}, `${w.now.temp}°`), ` ${w.now.sky}. High ${w.days[0].high}°, low ${w.days[0].low}°.`),
        w.alerts?.length ? h("p", { class: "out-alert" }, w.alerts[0].event) : w.soon ? h("p", { class: "meta" }, w.soon) : null,
        h("ol", { class: "wall-hours" }, w.hours.slice(1, 7).map((x) => h("li", {}, h("span", {}, x.label), weatherIcon(x.icon), h("strong", {}, `${x.temp}°`))))) : null),
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
