// Workshop: the X2D now and its print history, the touchscreen, and Local AI.
import { api, card, duration, empty, h, settle, when } from "./core.js";
import { band } from "./now.js";
import { printLabUrl, toolUrl } from "./sections.js";
import { firstFew } from "./section-links.js";
import { printErrorCode, printLabText, printSeconds, printWords, weekPill } from "./wording.js";
import { printerButtons } from "./printer-actions.js";

export const every = 15;

export function mount(state) {
  state.band = h("div");
  state.actions = h("div");
  state.cam = h("div");
  state.info = h("div", { class: "now-col-right" });
  state.body = h("div", { class: "cards" });
  
  const leftCol = h("div", { class: "now-col-left" }, state.band, state.actions, state.cam);
  state.root.append(h("div", { class: "now-layout" }, leftCol, state.info), state.body);
  // A new frame every 2 seconds while this page is open and visible.
  state.camTimer = setInterval(() => {
    const img = state.root.querySelector(".cam-img");
    if (img && !document.hidden) img.src = `/api/camera.jpg?t=${Date.now()}`;
  }, 2000);
  if (typeof EventSource !== "undefined") {
    try {
      const es = new EventSource("/api/records/stream");
      state.es = es;
      es.addEventListener("change", (ev) => {
        try {
          const ch = JSON.parse(ev.data);
          if (ch?.id === "printer") load(state);
        } catch {}
      });
    } catch {}
  }
}

export function leave(state) {
  clearInterval(state.camTimer);
  if (state.es) {
    try { state.es.close(); } catch {}
    state.es = null;
  }
}

function camera(c) {
  const src = c.source === "Pi" ? "From the Pi" : c.source === "MacBook" ? "From the MacBook (backup)" : null;
  if (!c.ok) {
    // The printer's own state says the most: its video switched off (common after it restarts) or not answering at all.
    const why = c.reason === "liveview_off"
      ? ["The X2D isn't sharing its camera on the network. On the printer's screen, turn on ", h("strong", {}, "LAN Only Liveview"),
        " (Settings › Network). The picture comes back here within a minute."]
      : c.reason === "printer_unreachable" ? ["The printer isn't answering on the network. It may be off or restarting."]
      : null;
    const tips = [];
    if (c.sources?.Pi && !c.sources.Pi.up) tips.push("the Pi's camera link isn't getting pictures");
    if (c.sources?.MacBook && !c.sources.MacBook.fresh) tips.push("the MacBook is asleep or Bambu Studio's live view is closed");
    return card("Camera", { cls: "wide", pill: "No picture", tone: "warn" },
      why ? h("p", {}, ...why) : null,
      h("p", { class: "meta" }, tips.length ? `No picture: ${tips.join(", and ")}.` : "No picture from the printer right now."));
  }
  const hint = c.source === "MacBook"
    ? h("p", { class: "meta", style: "margin-top: .5rem;" }, "Streaming via MacBook bridge. For direct streaming without the Mac, enable LAN Only Liveview on the printer screen.")
    : null;
  return card("Camera", { cls: "wide", pill: src, tone: c.source === "Pi" ? "ok" : "warn" },
    h("img", { class: "cam-img", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera, updated every 2 seconds", width: 384, height: 216 }),
    hint);
}

// One row per print: outcome, length, the printer's error code with a help link, and the filament it used.
function printRow(p) {
  const [label, tone] = printWords(p);
  const used = p.grams ? `${Math.round(p.grams)} g of filament` + (p.cost ? `, $${p.cost.toFixed(2)}` : "") : null;
  const photo = p.has_photo ? h("a", {
    href: `/api/prints/${p.id}/photo.jpg`,
    target: "_blank",
    rel: "noopener",
    class: "print-photo-link",
    title: "View completed print photo"
  },
    h("img", {
      src: `/api/prints/${p.id}/photo.jpg`,
      class: "print-photo-thumb",
      alt: "Completed print photo",
      width: 48,
      height: 27,
      loading: "lazy"
    })
  ) : null;
  const row = h("li", { class: "log-row print-row" },
    h("span", { class: "dot", dataset: { tone } }),
    h("span", { class: "log-main" }, h("strong", {}, label),
      h("span", { class: "meta" }, p.name),
      h("span", { class: "meta" }, when(p.started)),
      p.lab ? h("a", { class: "meta", href: printLabUrl(p.lab.exp), "data-link": true }, printLabText(p))
        : h("span", { class: "meta" }, printLabText(p)),
      !p.error ? null : printErrorCode(p.error)
        ? h("a", { class: "meta", href: `https://e.bambulab.com/query.php?lang=en&e=${encodeURIComponent(printErrorCode(p.error))}`, target: "_blank", rel: "noopener" }, `What ${p.error} means`)
        : h("span", { class: "meta" }, p.error),
      used ? h("span", { class: "meta" }, used) : null),
    h("span", { class: "log-side" }, photo, p.status === "printing" ? "Printing now" : printSeconds(p) ? duration(printSeconds(p)) : ""));
  return row;
}

// Bambuddy (port 8000 on the Pi) holds the spools and projects and takes each print's filament off by itself;
// the hub only shows them and links there to change anything.
const bambuddyUrl = (path) => `http://${location.hostname}:8000${path}`;

function shelf(spools, amsTrays = [], printer = null) {
  if (spools === null) {
    return card("Filament", { cls: "wide", pill: "No answer", tone: "warn" },
      h("p", { class: "meta" }, "Bambuddy isn't answering, so the spools can't be shown right now."),
      h("a", { class: "action", href: bambuddyUrl("/inventory"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"));
  }
  const trays = Array.isArray(amsTrays) ? amsTrays : [];
  const low = spools.filter((s) => s.low);
  const activePrint = printer && ["printing", "paused"].includes(printer.state);
  const shortfallBanner = low.length
    ? h("div", { class: "callout callout--warn", style: "margin-bottom: .75rem;" },
      h("span", {}, activePrint
        ? `Spool shortfall check: ${low.map((s) => `${s.colour} (${s.grams_left} g)`).join(", ")} running low while the X2D is active.`
        : `Low filament warning: ${low.map((s) => `${s.colour} (${s.grams_left} g left)`).join(", ")}.`))
    : null;
  const amsRow = trays.length
    ? h("div", { class: "ws-ams-strip", style: "display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: .75rem;" },
      trays.map((t) => h("span", { class: "pill", style: "display: inline-flex; align-items: center; gap: .35rem;" },
        h("span", { class: "swatch", style: `width: 10px; height: 10px; border-radius: 50%; background:${t.color || "#888"}`, "aria-hidden": "true" }),
        `AMS ${t.slot}: ${t.type}${Number.isFinite(t.remain) && t.remain >= 0 ? ` (${t.remain}%)` : ""}`)))
    : null;
  const rows = spools.map((s) => {
    const pct = s.grams_total ? Math.round((s.grams_left / s.grams_total) * 100) : 0;
    return h("li", { class: "spool", dataset: { low: String(s.low) } },
      h("span", { class: "swatch", style: `background:${s.hex || "#888"}`, "aria-hidden": "true" }),
      h("span", { class: "spool-main" }, h("strong", {}, s.colour), h("span", { class: "meta" }, [s.material, s.brand].filter(Boolean).join(", "))),
      // An unweighed spool's amount is unknown: no bar rather than a full green one.
      h("span", { class: "spool-left" }, s.measured ? h("span", { class: "meter" }, h("i", { style: `width:${pct}%`, dataset: { tone: s.low ? "bad" : pct < 35 ? "warn" : "ok" } })) : null,
        h("span", { class: "grams" }, s.measured ? `${s.grams_left} g` : "not weighed")));
  });
  return card("Filament", { cls: "wide", pill: low.length ? `${low.length} running low` : spools.length ? `${spools.length} spools` : null, tone: low.length ? "bad" : "ok" },
    shortfallBanner,
    amsRow,
    rows.length ? h("ul", { class: "spools" }, rows) : empty("No spools in Bambuddy yet."),
    h("p", { class: "meta" }, "From Bambuddy, which takes each print's filament off its spool. You get a phone alert when one runs low."),
    h("a", { class: "action", href: bambuddyUrl("/inventory"), target: "_blank", rel: "noopener" }, "Add or change spools in Bambuddy ↗"));
}

function labWorkshopCard(labData) {
  if (!labData) {
    return card("Print lab & queue", { pill: "Bambuddy", tone: "ok" },
      h("p", { class: "meta" }, "Spools, projects and the print queue live in Bambuddy; coupon experiments live in Print lab."),
      h("div", { style: "display: flex; gap: .5rem; margin-top: .5rem; flex-wrap: wrap;" },
        h("a", { class: "action", href: "/lab", "data-link": true }, "Open Print lab"),
        h("a", { class: "action ghost", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗")));
  }
  const needs = Array.isArray(labData.needs) ? labData.needs : [];
  const active = Array.isArray(labData.active) ? labData.active : [];
  const questions = Array.isArray(labData.questions) ? labData.questions : [];
  const pill = needs.length ? `${needs.length} need${needs.length === 1 ? "s" : ""} you`
    : active.length ? `${active.length} active` : "Ready";
  const tone = needs.length ? "warn" : "ok";

  return card("Print lab & queue", { pill, tone },
    needs.length
      ? h("ul", { class: "log", style: "margin-bottom: .5rem;" },
        needs.slice(0, 3).map((n) => h("li", { class: "log-row" },
          h("span", { class: "dot", dataset: { tone: "warn" }, "aria-hidden": "true" }),
          h("span", { class: "log-main" },
            h("strong", {}, `${n.id}: ${n.action}`),
            n.question_text ? h("span", { class: "meta" }, n.question_text) : null,
            n.judge_on ? h("span", { class: "meta" }, `Look at: ${n.judge_on}`) : null),
          h("span", { class: "log-side" },
            h("a", { class: "btn btn--primary", href: n.href || `/lab?e=${n.id}`, "data-link": true },
              n.action === "Judge the print" ? `Judge ${n.id}` : "Open")))))
      : active.length
        ? h("ul", { class: "log", style: "margin-bottom: .5rem;" },
          active.slice(0, 2).map((e) => h("li", { class: "log-row" },
            h("span", { class: "dot", dataset: { tone: "ok" }, "aria-hidden": "true" }),
            h("span", { class: "log-main" },
              h("strong", {}, `${e.id} · ${e.status}`),
              e.question_text ? h("span", { class: "meta" }, e.question_text) : null))))
        : questions.length
          ? h("p", { class: "meta" }, `${questions[0].id}: ${questions[0].question} (${questions[0].answered}/${questions[0].total} answered)`)
          : h("p", { class: "meta" }, "All Print lab experiments are up to date on the Pi."),
    h("div", { style: "display: flex; gap: .5rem; margin-top: .5rem; flex-wrap: wrap;" },
      h("a", { class: "action", href: "/lab", "data-link": true }, "Print lab"),
      h("a", { class: "action ghost", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗")));
}

function projectsCard(projects) {
  if (projects === null) return null;
  return card("Projects", { cls: "wide", pill: projects.length ? `${projects.length} active` : null, tone: "ok" },
    projects.length
      ? h("ul", { class: "log" }, projects.map((p) => h("li", { class: "log-row" },
        h("span", { class: "dot", dataset: { tone: "ok" } }),
        h("span", { class: "log-main" },
          h("a", { href: bambuddyUrl(`/projects/${p.id}`), target: "_blank", rel: "noopener" }, h("strong", {}, p.name)),
          p.description ? h("span", { class: "meta" }, p.description) : null),
        h("span", { class: "log-side" }, p.prints ? `${p.prints} print${p.prints === 1 ? "" : "s"}` : "No prints yet"))))
      : empty("No projects in Bambuddy yet."),
    h("a", { class: "action", href: bambuddyUrl("/projects"), target: "_blank", rel: "noopener" }, "Plan projects in Bambuddy ↗"));
}

export async function load(state) {
  // Only the workshop status is required; the camera and Bambuddy's projects get 6 s each.
  const [d, cam, pr] = await Promise.all([api("/api/workshop"), settle(api("/api/camera"), 6000, { ok: false }),
    settle(api("/api/projects"), 6000, { available: false })]);
  state.band.replaceChildren(band(d.printer));
  state.facts = d.printer.headline;
  state.actions.replaceChildren(...[printerButtons(d.printer, () => load(state))].filter(Boolean));
  if (state.camOk !== cam.ok || state.camSource !== cam.source || state.camReason !== cam.reason) {
    state.cam.replaceChildren(camera(cam));
    state.camOk = cam.ok; state.camSource = cam.source; state.camReason = cam.reason;
  }
  const prints = d.prints.map((p) => printRow(p));
  const m = d.filament_month;
  state.info.replaceChildren(
    labWorkshopCard(d.lab),
    card("Workshop display", { pill: d.display.state, tone: d.display.state === "Online" ? "ok" : d.display.state === "Unknown" ? "warn" : "bad" },
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Firmware"), h("dd", {}, d.display.firmware || "—"))),
      h("a", { class: "action", href: "http://10.0.0.124", target: "_blank", rel: "noopener" }, "Open the display's page ↗")),
    card("Local AI", { pill: d.ai.state, tone: d.ai.state === "Down" ? "bad" : d.ai.state === "Unknown" ? "warn" : "ok" },
      d.ai.state === "Unknown" ? h("p", { class: "meta" }, "The hub couldn’t check Local AI. Its current state is unconfirmed.")
      : d.ai.state === "Down"
        ? h("p", { class: "meta" }, "The Windows PC isn't answering. It may be off, or the room's breaker tripped.")
        : h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, "Models loaded"), h("dd", {}, d.ai.models.length ? d.ai.models.join(", ") : "None")),
          h("div", {}, h("dt", {}, "Jobs waiting"), h("dd", {}, String(d.ai.waiting ?? 0)))),
      h("a", { class: "action", href: toolUrl("assistant"), target: "_blank", rel: "noopener" }, "Open Local AI ↗"))
  );
  state.body.replaceChildren(...[
    card("Print history", { ...weekPill(d.week), cls: "wide" },
      ...(d.prints_available === false ? [h("p", { class: "meta" }, "Bambuddy isn't answering, so the print history can't be shown right now.")]
        : prints.length ? firstFew(prints, { n: 5, noun: "prints" }) : [empty("Prints show up here once Bambuddy has logged one.")]),
      d.week ? h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.` +
        (m.prints_logged ? ` Last 30 days: ${(m.grams / 1000).toFixed(2)} kg of filament${m.cost ? `, about $${m.cost.toFixed(2)}` : ""}.` : "")) : null),
    projectsCard(pr.available ? pr.projects : null),
    shelf(d.spools, d.ams_trays, d.printer),
  ].filter(Boolean));
}
