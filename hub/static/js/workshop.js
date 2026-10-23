import { mountProjects, refreshProjects } from "./project-board.js";
// Workshop: the X2D now and its print history, the touchscreen, and Local AI.
import { api, card, duration, empty, ensure, h, post, toast, when } from "./core.js";
import { band } from "./now.js";

export const every = 15;

const OUTCOME = { finished: ["Finished", "ok"], stopped: ["Stopped", "warn"], failed: ["Failed", "bad"] };

export function mount(state) {
  state.band = h("div");
  state.cam = h("div");
  state.info = h("div", { class: "now-col-right" });
  state.body = h("div", { class: "cards" });
  
  const leftCol = h("div", { class: "now-col-left" }, state.band, state.cam);
  state.projects = mountProjects(state);
  state.root.append(h("div", { class: "now-layout" }, leftCol, state.info), state.projects, state.body);
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
function printRow(p, spools, reload) {
  const [label, tone] = p.ended ? (OUTCOME[p.outcome] || ["Ended", "warn"]) : ["Printing", "ok"];
  const used = p.grams ? `${p.grams} g of ${p.colour || "filament"} ${p.material || ""}`.trim() + (p.cost ? `, $${p.cost.toFixed(2)}` : "") : null;
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
  if (p.ended && spools.length) {
    const pick = h("select", { "aria-label": "Spool used" }, spools.map((s) => h("option", { value: s.id, selected: s.id === p.spool_id }, `${s.colour} ${s.material}`)));
    const grams = h("input", { type: "number", min: 1, max: 5000, inputmode: "numeric", placeholder: "grams", value: p.grams || "", "aria-label": "Grams used" });
    const form = h("form", { class: "use-form", hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!(await ensure("household"))) return;
      try {
        const r = await post(`/api/prints/${p.id}/filament`, { spool_id: Number(pick.value), grams: Number(grams.value) });
        toast(r.cost != null ? `Logged. That print cost about $${r.cost.toFixed(2)}.` : "Logged.");
        reload();
      } catch (x) { toast(x.message, "bad"); }
    } }, pick, grams, h("button", { type: "submit", class: "primary small-btn" }, "Save"));
    row.append(h("button", { class: "ghost small use-btn", onclick: () => { form.hidden = !form.hidden; if (!form.hidden) grams.focus(); } },
      p.grams ? "Change filament" : "Add filament used"), form);
  }
  return row;
}

function shelf(d, reload) {
  const low = d.spools.filter((s) => s.low);
  const spools = d.spools.map((s) => {
    const pct = s.grams_total ? Math.round((s.grams_left / s.grams_total) * 100) : 0;
    const left = h("input", { type: "number", min: 0, max: s.grams_total, value: s.grams_left, inputmode: "numeric", "aria-label": `Grams left on ${s.colour} ${s.material}` });
    left.addEventListener("change", async () => {
      if (!(await ensure("household"))) return;
      try { await post(`/api/filament/${s.id}`, { grams_left: Number(left.value) }); reload(); } catch (x) { toast(x.message, "bad"); }
    });
    return h("li", { class: "spool", dataset: { low: String(s.low) } },
      h("span", { class: "swatch", style: `background:${s.hex || "#888"}`, "aria-hidden": "true" }),
      h("span", { class: "spool-main" }, h("strong", {}, s.colour), h("span", { class: "meta" }, [s.material, s.brand].filter(Boolean).join(", "))),
      h("span", { class: "spool-left" }, h("span", { class: "meter" }, h("i", { style: `width:${pct}%`, dataset: { tone: s.low ? "bad" : pct < 35 ? "warn" : "ok" } })),
        h("label", { class: "grams" }, left, "g")),
      h("button", { class: "ghost small", "aria-label": `${s.colour} ${s.material} is used up`, onclick: async () => {
        if (!(await ensure("household"))) return;
        if (!confirm(`Mark ${s.colour} ${s.material} as used up?`)) return;
        await post(`/api/filament/${s.id}`, { finished: true }); toast("Spool marked as used up."); reload();
      } }, "Used up"));
  });
  const f = h("form", { class: "spool-form", onsubmit: async (e) => {
    e.preventDefault();
    if (!(await ensure("household"))) return;
    const v = Object.fromEntries(new FormData(f));
    try { await post("/api/filament", v); toast(`Added ${v.colour} ${v.material}.`); f.reset(); reload(); }
    catch (x) { toast(x.message, "bad"); }
  } },
  h("label", { class: "field" }, h("span", {}, "Material"), h("select", { name: "material" }, d.materials.map((m) => h("option", { value: m }, m)))),
  h("label", { class: "field" }, h("span", {}, "Colour name"), h("input", { name: "colour", required: true, maxlength: 40, placeholder: "Jade white" })),
  h("label", { class: "field colour-pick" }, h("span", {}, "Colour"), h("input", { name: "hex", type: "color", value: "#d9d9d9" })),
  h("label", { class: "field" }, h("span", {}, "Brand"), h("input", { name: "brand", maxlength: 40, placeholder: "Bambu" })),
  h("label", { class: "field" }, h("span", {}, "Spool size (g)"), h("input", { name: "grams_total", type: "number", value: 1000, min: 100, max: 10000, inputmode: "numeric" })),
  h("label", { class: "field" }, h("span", {}, "Price ($)"), h("input", { name: "price", type: "number", step: "0.01", min: 0, inputmode: "decimal", placeholder: "19.99" })),
  h("button", { type: "submit", class: "primary" }, "Add spool"));
  return card("Filament shelf", { cls: "wide", pill: low.length ? `${low.length} running low` : d.spools.length ? `${d.spools.length} spools` : null, tone: low.length ? "bad" : "ok" },
    spools.length ? h("ul", { class: "spools" }, spools) : empty("No spools yet. Add the ones on your shelf to track what's left and what prints cost."),
    h("p", { class: "meta" }, `A spool counts as low under ${d.low_at} g, and you get a phone alert when one gets there.`),
    h("details", { class: "add-spool" }, h("summary", {}, "Add a spool"), f));
}

export async function load(state) {
  refreshProjects(state);
  const [d, cam] = await Promise.all([api("/api/workshop"), api("/api/camera").catch(() => ({ ok: false }))]);
  state.band.replaceChildren(band(d.printer));
  if (state.camOk !== cam.ok || state.camSource !== cam.source) {
    state.cam.replaceChildren(camera(cam));
    state.camOk = cam.ok; state.camSource = cam.source;
  }
  if (!state.force && state.root.contains(document.activeElement) && ["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
  state.force = false;
  const reload = () => { state.force = true; return load(state); };
  const prints = d.prints.map((p) => printRow(p, d.spools, reload));
  const m = d.filament_month;
  state.info.replaceChildren(
    card("Bambuddy", { pill: "Self-hosted", tone: "ok" },
      h("p", { class: "meta" }, "Local control plane: queueing, automatic 3MF archiving, and cost tracking."),
      h("a", { class: "action", href: "http://10.0.0.30:8000", target: "_blank", rel: "noopener" }, "Open Bambuddy")),
    card("Workshop display", { pill: d.display.state, tone: d.display.state === "Online" ? "ok" : d.display.state === "Unknown" ? "warn" : "bad" },
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Firmware"), h("dd", {}, d.display.firmware || "—"))),
      h("a", { class: "action", href: "http://10.0.0.124", target: "_blank", rel: "noopener" }, "Open the display's page")),
    card("Local AI", { pill: d.ai.state, tone: d.ai.state === "Down" ? "bad" : d.ai.state === "Unknown" ? "warn" : "ok" },
      d.ai.state === "Unknown" ? h("p", { class: "meta" }, "The hub couldn’t check Local AI. Its current state is unconfirmed.")
      : d.ai.state === "Down"
        ? h("p", { class: "meta" }, "The Windows PC isn't answering. It may be off, or the room's breaker tripped.")
        : h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, "Models loaded"), h("dd", {}, d.ai.models.length ? d.ai.models.join(", ") : "None")),
          h("div", {}, h("dt", {}, "Jobs waiting"), h("dd", {}, String(d.ai.waiting ?? 0)))),
      h("a", { class: "action", href: "https://10.0.0.21", target: "_blank", rel: "noopener" }, "Open Local AI"))
  );
  state.body.replaceChildren(
    card("Print history", { pill: `${d.week.finished} finished this week`, tone: "ok", cls: "wide" },
      prints.length ? h("ul", { class: "log" }, prints) : empty("Prints show up here once the hub has seen one start."),
      h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.` +
        (m.prints_logged ? ` Last 30 days: ${(m.grams / 1000).toFixed(2)} kg of filament${m.cost ? `, about $${m.cost.toFixed(2)}` : ""}.` : ""))),
    shelf(d, reload)
  );
}
