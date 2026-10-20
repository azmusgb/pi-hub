// Workshop: the X2D now and its print history, the touchscreen, and Local AI.
import { api, card, duration, empty, h, when } from "./core.js";
import { band } from "./now.js";

export const every = 15;

const OUTCOME = { finished: ["Finished", "ok"], stopped: ["Stopped", "warn"], failed: ["Failed", "bad"] };

export function mount(state) {
  state.band = h("div");
  state.cam = h("div");
  state.body = h("div", { class: "cards" });
  state.root.append(state.band, state.cam, state.body);
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
  return card("Camera", { cls: "wide", pill: src, tone: c.source === "Pi" ? "ok" : "warn" },
    h("img", { class: "cam-img", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera, updated every 2 seconds", width: 384, height: 216 }));
}

export async function load(state) {
  const [d, cam] = await Promise.all([api("/api/workshop"), api("/api/camera").catch(() => ({ ok: false }))]);
  state.band.replaceChildren(band(d.printer));
  if (state.camOk !== cam.ok || state.camSource !== cam.source) {
    state.cam.replaceChildren(camera(cam));
    state.camOk = cam.ok; state.camSource = cam.source;
  }
  const prints = d.prints.map((p) => {
    const [label, tone] = p.ended ? (OUTCOME[p.outcome] || ["Ended", "warn"]) : ["Printing", "ok"];
    return h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone } }),
      h("span", { class: "log-main" }, h("strong", {}, label), h("span", { class: "meta" }, when(p.started))),
      h("span", { class: "log-side" }, p.ended ? duration(p.ended - p.started) : `${p.progress}% so far`));
  });
  state.body.replaceChildren(
    card("Print history", { pill: `${d.week.finished} finished this week`, tone: "ok", cls: "wide" },
      prints.length ? h("ul", { class: "log" }, prints) : empty("Prints show up here once the hub has seen one start."),
      h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.`)),
    card("Workshop display", { pill: d.display.state, tone: d.display.state === "Online" ? "ok" : "bad" },
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Firmware"), h("dd", {}, d.display.firmware || "—"))),
      h("a", { class: "action", href: "http://10.0.0.124", target: "_blank", rel: "noopener" }, "Open the display's page")),
    card("Local AI", { pill: d.ai.state, tone: d.ai.state === "Down" ? "bad" : "ok" },
      d.ai.state === "Down"
        ? h("p", { class: "meta" }, "The Windows PC isn't answering. It may be off, or the room's breaker tripped.")
        : h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, "Models loaded"), h("dd", {}, d.ai.models.length ? d.ai.models.join(", ") : "None")),
          h("div", {}, h("dt", {}, "Jobs waiting"), h("dd", {}, String(d.ai.waiting ?? 0)))),
      h("a", { class: "action", href: "https://10.0.0.21", target: "_blank", rel: "noopener" }, "Open Local AI")),
  );
}
