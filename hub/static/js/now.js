// Now: the one-line answer, the print band, what needs a look, and a card per area.
import { api, clockTime, ensure, fix, h, post, spark, weatherIcon, whoami } from "./core.js";
import { issueTopic, splitIssues } from "./experience.js";
import { tile } from "./control.js";

export const every = 15;

const finishAt = (m) => Number.isFinite(m) ? new Date(Date.now() + m * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

function greeting(now = new Date()) {
  const hr = now.getHours();
  if (hr < 5) return "Late night";
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  if (hr < 21) return "Good evening";
  return "Good night";
}

function eyebrowLabel(now = new Date()) {
  const day = now.toLocaleDateString([], { weekday: "long" });
  return `${greeting(now)} · ${day}`;
}

function isWallMode() {
  return document.body.classList.contains("wall") || document.documentElement.dataset.wall === "1";
}

function cachedNarration() {
  const hour = new Date().getHours();
  try {
    const cached = JSON.parse(sessionStorage.getItem("hub-narration-" + hour) || "null");
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.text;
  } catch {}
  return null;
}

async function generateNarration(d, out) {
  try {
    const me = await whoami();
    if (me.role === "none") return null;
  } catch { return null; }
  const hour = new Date().getHours();
  const snapshot = {
    timeOfDay: hour < 6 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night",
    weather: out?.weather ? out.weather.now.temp + " degrees, " + out.weather.now.sky.toLowerCase() : null,
    printer: d.printer.state === "printing" ? "printing" : "idle",
    moviesNow: d.movies.playing ? d.movies.playing.map((s) => s.title) : [],
  };
  const prompt = `You are the voice of a home writing a brief note to its owner. Given this snapshot, write ONE short sentence (occasionally two short ones) in plain, warm English describing how the house is right now. Speak as the house itself, never in the first person. Be specific: mention weather, movies, or the printer only if they are actually notable. Otherwise just be present. Never invent details.

Examples of good output:
- A quiet Sunday afternoon. The workshop windows are shut against the rain.
- The printer is warm from a job that just finished. Everything else is still.
- Evening, cool and clear. Two movies playing in the living room.

Snapshot: ${JSON.stringify(snapshot)}

Your note:`;
  try {
    const r = await post("/api/ask", { question: prompt });
    const text = (r.answer || "").trim().replace(/^["']|["']$/g, "");
    if (text && text.length > 10 && text.length < 200) {
      sessionStorage.setItem("hub-narration-" + hour, JSON.stringify({ text, ts: Date.now() }));
      return text;
    }
  } catch {}
  return null;
}

export function band(p) {
  const pct = p.progress || 0;
  const detail = p.state === "printing" && p.left
    ? ["Done in about ", h("strong", {}, p.left), finishAt(p.minutes_left) ? `, around ${finishAt(p.minutes_left)}` : ""]
    : [p.detail || ""];
  const cls = p.state === "printing" ? "band is-printing" : "band";
  return h("section", { class: cls, dataset: { state: p.state }, "aria-label": "Bambu X2D" },
    h("p", { class: "band-name" }, "Bambu X2D"),
    h("h2", { class: "band-headline" }, p.headline),
    h("div", { class: "line", role: "progressbar", "aria-label": "Print progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct },
      h("div", { class: "line-track" }),
      h("div", { class: "line-bead", style: `width:${pct}%` }),
      h("div", { class: "line-nozzle", style: `left:${pct}%` })),
    h("p", { class: "band-detail" }, ...detail));
}

function askBox() {
  const input = h("input", { type: "text", id: "ask-input", maxlength: 400, placeholder: "Ask about the house…", autocomplete: "off", enterkeyhint: "send" });
  const answer = h("div", { class: "ask-answer", "aria-live": "polite" });
  const btn = h("button", { type: "submit", class: "primary" }, "Ask");
  return h("section", { class: "ask-section" },
    h("h2", { class: "section-title" }, "Ask Pi Hub"),
    h("form", { class: "ask", role: "search", "aria-label": "Ask Local AI", onsubmit: async (e) => {
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
  } }, 
    h("label", { for: "ask-input", class: "sr" }, "Ask about the house"), 
    h("div", { class: "ask-row" }, input, btn), 
    answer,
    h("div", { class: "ask-suggestions" },
      h("button", { type: "button", class: "chip", onclick: () => { input.value = "What’s happening at home?"; input.focus(); } }, "What’s happening at home?"),
      h("button", { type: "button", class: "chip", onclick: () => { input.value = "What's using the Pi?"; input.focus(); } }, "What's using the Pi?"),
      h("button", { type: "button", class: "chip", onclick: () => { input.value = "Any alerts?"; input.focus(); } }, "Any alerts?")
    )
  ));
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
  return bits.length ? h("p", { class: "outside" }, ...bits) : null;
}

export function mount(state) {
  state.summary = h("p", { class: "summary", "aria-live": "polite", dataset: { tone: "none" } }, "Checking the house…");
  state.outside = h("div", { class: "outside-wrap" });
  state.eyebrow = h("p", { class: "hero-eyebrow" }, eyebrowLabel());
  
  state.band = h("div");
  state.issues = h("div");
  state.ask = isWallMode() ? "" : askBox();
  
  // Left column
  state.leftCol = h("div", { class: "now-col-left" }, state.band, state.issues);
  
  // Right column
  state.rightCol = h("div", { class: "now-col-right" });
  
  state.main = h("div", { class: "now-layout" }, state.leftCol, state.rightCol);

  if (isWallMode()) {
    state.root.append(state.summary, state.outside, state.main);
  } else {
    state.hero = h("section", { class: "home-context", "aria-label": "Around the house" }, state.summary, state.outside);
    const tasks = h("nav", { class: "quick-tasks", "aria-label": "Everyday tasks" },
      h("a", { class: "chip", href: "/lists", "data-link": true }, "Shopping list"),
      h("a", { class: "chip", href: "/print", "data-link": true }, "Print a file"),
      h("a", { class: "chip", href: "/pi", "data-link": true }, "Get help"));
    state.root.append(state.issues, tasks, state.band, state.rightCol, state.hero, state.ask);
  }

  if (state._eyebrowTimer) clearInterval(state._eyebrowTimer);
  state._eyebrowTimer = setInterval(() => {
    if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();
  }, 15 * 60 * 1000);
}

export async function load(state) {
  const [d, out, home, wifi] = await Promise.all([
    api("/api/now"),
    api("/api/outside").catch(() => null),
    api("/api/home").catch(() => ({ connected: false, accessories: [], favourites: [] })),
    api("/api/wifi").catch(() => ({ set: false })),
  ]);
  
  state.outside.replaceChildren(...[outsideLine(out), d.setup_left && !isWallMode()
    ? h("a", { class: "setup-hint", href: "/settings", "data-link": true }, `${d.setup_left} setup step${d.setup_left > 1 ? "s" : ""} remaining →`) : null].filter(Boolean));

  const favs = home.accessories.filter((a) => home.favourites.includes(a.id));
  const worst = d.issues.some((i) => i.tone === "bad") ? "bad" : d.issues.length ? "warn" : "ok";
  state.summary.textContent = d.summary;
  state.summary.dataset.tone = worst;
  state.summary.hidden = !isWallMode() && d.issues.length > 0;
  if (state.hero) state.hero.hidden = state.summary.hidden && state.outside.childElementCount === 0;
  if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();

  if (state.ask) state.ask.hidden = !d.status_available || d.workshop.ai === "Down";

  // Progressive enhancement: when the house is quiet, let it write a note.
  if (d.issues.length === 0 && d.workshop.ai !== "Down" && !isWallMode()) {
    const cached = cachedNarration();
    if (cached) {
      state.summary.textContent = cached;
    } else {
      generateNarration(d, out).then((text) => {
        if (text && state.summary.textContent === d.summary) {
          state.summary.textContent = text;
          if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
            state.summary.animate(
              [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }],
              { duration: 400, easing: "cubic-bezier(.16, 1, .3, 1)" }
            );
          }
        }
      });
    }
  }
  
  // Printer band goes above alerts if printing, otherwise hide it
  if (d.printer.state === "printing" || d.printer.state === "paused") {
    state.band.replaceChildren(band(d.printer));
  } else {
    state.band.replaceChildren();
  }

  renderIssues(state, d.issues);

  const m = d.movies;
  const p = d.pi;
  const w = d.workshop;
  const cpu = p.cpu_series?.at(-1);

  // 2x2 House Grid
  const houseCard = (name, href, tone, say, action) => h("a", { class: "house-card", href, "data-link": true },
    h("div", { class: "house-header" },
      h("h3", { class: "house-name" }, name),
      h("span", { class: "dot", dataset: { tone } })
    ),
    h("p", { class: "house-say" }, say),
    h("span", { class: "house-action" }, action)
  );

  const movieReady = d.status_available && m.plex_running && m.drive === "Connected";
  const mSay = !d.status_available ? "Status unavailable" : movieReady ? "Ready to watch" : "Playback needs attention";
  const wSay = !d.status_available ? "Status unavailable" : d.printer.state === "printing" ? `Printing, ${d.printer.progress}%`
    : d.printer.state === "paused" ? "Print paused" : d.printer.state === "error" ? "Printer needs attention" : "Printer and workshop status";
  const hSay = !d.status_available ? "Status unavailable" : !d.home.homebridge_running ? "Controls need attention"
    : !home.connected ? "Connect your smart-home controls" : favs.length ? `${favs.filter(a => a.on).length} of ${favs.length} favourites on` : "Lights, plugs and switches";

  state.rightCol.replaceChildren(...[
    h("section", { class: "house-section" },
      h("h2", { class: "section-title" }, "The house"),
      h("div", { class: "house-grid" },
        houseCard("Movies", movieReady ? "/movies?from=home" : "/pi?help=movies&from=home", m.tone, mSay, movieReady ? "Watch movies" : "Fix movie playback"),
        houseCard("Devices", "/control?from=home", d.home.tone, hSay, "Control devices"),
        houseCard("Workshop", "/workshop?from=home", d.printer.state === "error" ? "bad" : d.status_available && ["printing", "idle"].includes(d.printer.state) ? "ok" : "warn", wSay, "Check the printer"),
        houseCard("Help", "/pi?from=home", "none", "Guides for common household problems", "Solve a problem")
      )
    ),
    favs.length ? h("section", { class: "home-favourites" },
      h("h2", { class: "section-title" }, "Favourite controls"),
      h("div", { class: "tiles" }, favs.map(a => tile(a, state)))) : null,
    wifi.set ? h("section", { class: "wifi-panel" },
      h("div", { class: "wifi-header" }, "Guest Wi-Fi"),
      h("div", { class: "wifi-content" },
        h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 96, height: 96 }),
        h("div", {}, h("p", { class: "wifi-name" }, wifi.ssid), h("p", { class: "meta" }, "Scan to join"))
      )
    ) : null,
  ].filter(Boolean));
}

export function failed(state) {
  state.summary.textContent = "Can't reach the Pi Hub right now. It will keep trying.";
  state.summary.dataset.tone = "bad";
}

function renderIssues(state, issues) {
  const key = JSON.stringify(issues);
  if (state.issueKey !== key) { state.issueKey = key; state.issuesExpanded = false; }
  if (!issues.length) { state.issues.replaceChildren(); return; }
  const { shown, remaining } = splitIssues(issues);
  const item = i => h("li", { class: "alert-item", dataset: { tone: i.tone } },
    h("strong", { class: "alert-title" }, i.what), h("p", { class: "alert-desc" }, i.say),
    h("a", { class: "action", href: `/pi?help=${issueTopic(i)}&from=home`, "data-link": true }, "Get help"));
  const more = remaining ? h("details", { class: "issue-overflow", open: state.issuesExpanded,
    ontoggle: e => { state.issuesExpanded = e.currentTarget.open; } },
    h("summary", {}, `View all ${issues.length} issues`), h("ul", {}, issues.slice(shown.length).map(item))) : null;
  state.issues.replaceChildren(h("section", { class: `alerts-panel ${issues.some(i => i.tone === "bad") ? "is-critical" : ""}`, "aria-label": "Needs attention" },
    h("h2", { class: "section-title" }, `${issues.length} ${issues.length === 1 ? "thing needs" : "things need"} attention`),
    h("ul", {}, shown.map(item)), more));
}

export function leave(state) { clearInterval(state._eyebrowTimer); }
