// Workshop: the X2D now and its print history, the touchscreen, and Local AI.
import { api, card, duration, empty, h, settle, when } from "./core.js";
import { band } from "./now.js";
import { toolUrl } from "./sections.js";
import { firstFew } from "./section-links.js";
import { printOutcome } from "./wording.js";

export const every = 15;

const OUTCOME = { finished: ["Finished", "ok"], stopped: ["Stopped", "warn"], failed: ["Failed", "bad"] };

export function mount(state) {
  state.band = h("div");
  state.cam = h("div");
  state.info = h("div", { class: "now-col-right" });
  state.body = h("div", { class: "cards" });
  
  const leftCol = h("div", { class: "now-col-left" }, state.band, state.cam);
  state.root.append(h("div", { class: "now-layout" }, leftCol, state.info), state.body);
  // A new frame every 2 seconds while this page is open and visible.
  state.camTimer = setInterval(() => {
    const img = state.root.querySelector(".cam-img");
    if (img && !document.hidden) img.src = `/api/camera.jpg?t=${Date.now()}`;
  }, 2000);
}

export function leave(state) { clearInterval(state.camTimer); }

function camera(c) {
  const src = c.source === "Pi" ? "From the Pi" : c.source === "MacBook" ? "From the MacBook (backup)" : null;
  if (!c.ok) {
    const tips = [];
    if (c.sources?.Pi && !c.sources.Pi.up) tips.push("the Pi's camera link isn't set up yet");
    if (c.sources?.MacBook && !c.sources.MacBook.fresh) tips.push("the MacBook is asleep or Bambu Studio's live view is closed");
    return card("Camera", { cls: "wide", pill: "No picture", tone: "warn" },
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
  const [label, tone] = printOutcome(p) || (p.ended ? (OUTCOME[p.outcome] || ["Ended", "warn"]) : ["Printing", "ok"]);
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
      h("span", { class: "meta" }, when(p.started)),
      p.error ? h("a", { class: "meta", href: `https://e.bambulab.com/query.php?lang=en&e=${encodeURIComponent(p.error.replace(/^HMS_/, ""))}`, target: "_blank", rel: "noopener" }, `What ${p.error} means`) : null,
      used ? h("span", { class: "meta" }, used) : null),
    h("span", { class: "log-side" }, photo, p.ended ? duration(p.ended - p.started) : `${p.progress}% so far`));
  return row;
}

// Bambuddy (port 8000 on the Pi) holds the spools and projects and takes each print's filament off by itself;
// the hub only shows them and links there to change anything.
const bambuddyUrl = (path) => `http://${location.hostname}:8000${path}`;

function shelf(spools) {
  if (spools === null) {
    return card("Filament", { cls: "wide", pill: "No answer", tone: "warn" },
      h("p", { class: "meta" }, "Bambuddy isn't answering, so the spools can't be shown right now."),
      h("a", { class: "action", href: bambuddyUrl("/inventory"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"));
  }
  const low = spools.filter((s) => s.low);
  const rows = spools.map((s) => {
    const pct = s.grams_total ? Math.round((s.grams_left / s.grams_total) * 100) : 0;
    return h("li", { class: "spool", dataset: { low: String(s.low) } },
      h("span", { class: "swatch", style: `background:${s.hex || "#888"}`, "aria-hidden": "true" }),
      h("span", { class: "spool-main" }, h("strong", {}, s.colour), h("span", { class: "meta" }, [s.material, s.brand].filter(Boolean).join(", "))),
      h("span", { class: "spool-left" }, h("span", { class: "meter" }, h("i", { style: `width:${pct}%`, dataset: { tone: s.low ? "bad" : pct < 35 ? "warn" : "ok" } })),
        h("span", { class: "grams" }, s.measured ? `${s.grams_left} g` : "not weighed")));
  });
  return card("Filament", { cls: "wide", pill: low.length ? `${low.length} running low` : spools.length ? `${spools.length} spools` : null, tone: low.length ? "bad" : "ok" },
    rows.length ? h("ul", { class: "spools" }, rows) : empty("No spools in Bambuddy yet."),
    h("p", { class: "meta" }, "From Bambuddy, which takes each print's filament off its spool. You get a phone alert when one runs low."),
    h("a", { class: "action", href: bambuddyUrl("/inventory"), target: "_blank", rel: "noopener" }, "Add or change spools in Bambuddy ↗"));
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
  if (state.camOk !== cam.ok || state.camSource !== cam.source) {
    state.cam.replaceChildren(camera(cam));
    state.camOk = cam.ok; state.camSource = cam.source;
  }
  const prints = d.prints.map((p) => printRow(p));
  const m = d.filament_month;
  state.info.replaceChildren(
    card("Filament and projects", { pill: "Bambuddy", tone: "ok" },
      h("p", { class: "meta" }, "Spools, projects and the print queue live in Bambuddy."),
      h("div", { style: "display: flex; gap: .5rem; margin-top: .5rem; flex-wrap: wrap;" },
        h("a", { class: "action", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"),
        h("a", { class: "action ghost", href: `${toolUrl("assistant")}#projects`, target: "_blank", rel: "noopener" }, "Print lab ↗"))),
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
    card("Print history", { pill: `${d.week.finished} finished this week`, tone: "ok", cls: "wide" },
      ...(prints.length ? firstFew(prints, { n: 5, noun: "prints" }) : [empty("Prints show up here once the hub has seen one start.")]),
      h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.` +
        (m.prints_logged ? ` Last 30 days: ${(m.grams / 1000).toFixed(2)} kg of filament${m.cost ? `, about $${m.cost.toFixed(2)}` : ""}.` : ""))),
    projectsCard(pr.available ? pr.projects : null),
    shelf(d.spools),
  ].filter(Boolean));
}
