// Print: send a file to the HP DeskJet from any device, watch the queue, check the ink. A7 P1: the printer is the
// faceplate (its state, ink and Scan); printing a file and the queue are sections.
import { api, empty, h, post, toast } from "./core.js";
import { faceplate, faceplateLoading, fillNeedsHere, lampRows, needsHere, section } from "./page-parts.js";
import { toolUrl } from "./sections.js";

export const every = 10;

export function mount(state) {
  const file = h("input", { type: "file", id: "print-file", "aria-label": "Choose a file to print", "aria-describedby": "print-chosen", accept: ".pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain", required: true });
  const copies = h("input", { type: "number", id: "print-copies", min: 1, max: 20, value: 1, inputmode: "numeric" });
  const mono = h("input", { type: "checkbox", id: "print-mono" });
  const chosen = h("p", { class: "meta", id: "print-chosen" }, "PDF, photo (JPG or PNG) or text file, up to 25 MB.");
  const button = h("button", { type: "submit", class: "primary", disabled: true, "aria-describedby": "print-help" }, "Print");
  state.ready = false;
  state.sending = false;
  const help = h("p", { id: "print-help", class: "meta", role: "status" }, "Checking the printer…");
  state.updateButton = () => {
    const f = file.files?.[0];
    const valid = f && f.size > 0 && f.size <= 25 * 1024 * 1024 && /\.(pdf|jpe?g|png|txt)$/i.test(f.name);
    button.disabled = state.sending || !state.ready || !valid;
    if (!state.ready) help.textContent = "Printer unavailable. Check that the HP DeskJet is on and connected to your home network.";
    else if (!f) help.textContent = "Choose a PDF, photo or text file to enable Print.";
    else if (!valid) help.textContent = "Choose a non-empty PDF, JPG, PNG or text file up to 25 MB.";
    else help.textContent = state.sending ? "Sending your file…" : "Ready to print your selected file.";
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    chosen.textContent = f ? `${f.name}, ${(f.size / 1e6).toFixed(1)} MB` : "PDF, photo (JPG or PNG) or text file, up to 25 MB.";
    state.updateButton();
  });
  const form = h("form", { class: "print-form", onsubmit: async (e) => {
    e.preventDefault();
    const f = file.files?.[0];
    if (button.disabled) return;
    if (!f) { toast("Choose a file to print first.", "warn"); return; }
    state.sending = true;
    state.updateButton();
    button.textContent = "Sending…";
    try {
      const q = new URLSearchParams({ filename: f.name, copies: copies.value || 1, mono: mono.checked });
      const r = await api(`/api/print?${q}`, { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
      toast(`Sent ${r.title} to the printer${r.copies > 1 ? `, ${r.copies} copies` : ""}.`);
      form.reset();
      chosen.textContent = "PDF, photo (JPG or PNG) or text file, up to 25 MB.";
      await load(state);
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      state.sending = false;
      state.updateButton();
      button.textContent = "Print";
    }
  } },
  h("label", { class: "drop", for: "print-file" },
    h("span", { class: "drop-title" }, "Choose a file"), chosen, file),
  h("div", { class: "print-options" },
    h("label", { for: "print-copies" }, "Copies", copies),
    h("label", { class: "check", for: "print-mono" }, mono, "Black and white")),
  help, button);
  // On a computer, a file can also be dragged onto the drop area.
  const drop = form.querySelector(".drop");
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    file.files = e.dataTransfer.files;
    file.dispatchEvent(new Event("change"));
  });
  if (matchMedia("(hover: hover)").matches) drop.querySelector(".drop-title").textContent = "Choose a file, or drop one here";
  state.printer = h("div", {}, faceplateLoading("HP DeskJet 4200"));
  state.needs = needsHere();
  state.status = h("div");
  state.queue = h("details", { class: "ui-section print-queue" }, h("summary", {}, h("h2", {}, "Print queue and recent jobs")), state.status);
  state.root.append(state.printer, state.needs, section("Print something", form), state.queue);
}

// A waiting job can be cancelled; a printed one only says so. Waiting is neutral work, not a warning (DESIGN.md).
function job(j, cancellable, state) {
  return { title: `Job ${j.number}`, detail: j.when, ...(cancellable ? { value: "Waiting" } : { tone: "ok", word: "Printed" }),
    action: cancellable ? h("button", { type: "button", class: "ui-btn", onclick: async () => {
      try { await post(`/api/print/${encodeURIComponent(j.id)}/cancel`); toast(`Cancelled job ${j.number}.`); load(state); }
      catch (e) { toast(e.message, "bad"); }
    } }, "Cancel") : null };
}

const INK_NAME = { "Colour": "Tri-color", "Color": "Tri-color", "Black": "Black" };

// The faceplate from /api/print, pure so it is tested without a page. No answer is unknown, never ready.
export function printerPlate(d) {
  const scan = h("a", { class: "ui-btn", href: toolUrl("scan"), target: "_blank", rel: "noopener" }, "Scan a document ↗");
  if (!d?.printer) {
    return faceplate({ name: "HP DeskJet 4200", lamp: ["unknown", "Not answering"], readout: "—",
      caption: "The hub can't reach the printer just now. Check that the HP DeskJet is on and connected to your home network.", actions: [scan] });
  }
  const st = d.printer.state || "Unknown";
  const ready = st === "Ready" || st === "Printing";
  const ink = Array.isArray(d.ink) ? d.ink : [];
  const waiting = d.jobs?.waiting?.length || 0;
  const meters = ink.length ? h("div", { class: "ink" }, ink.map((i) => h("div", { class: "ink-row" },
    h("span", {}, INK_NAME[i.name] || i.name),
    h("span", { class: "ink-bar", role: "meter", "aria-label": `${INK_NAME[i.name] || i.name} ink`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": i.level },
      h("i", { style: `width:${i.level}%`, dataset: { tone: i.level < 15 ? "bad" : i.level < 30 ? "warn" : "ok", ink: String(i.name).toLowerCase() } })),
    h("span", { class: "ink-pct" }, `${i.level}%`)))) : null;
  return faceplate({
    name: "HP DeskJet 4200",
    lamp: ready ? ["ok", st, st === "Printing"] : ["bad", st],
    readout: String(waiting), unit: "waiting to print", size: "md",
    caption: ink.some((i) => i.level < 15) ? "Ink is low. Order a cartridge soon."
      : ink.length ? null : "Ink levels show once the printer answers.",
    extra: [meters],
    actions: [scan],
  });
}

export async function load(state) {
  const [d] = await Promise.all([api("/api/print"), fillNeedsHere(state.needs, "/print")]);
  if (!state.hadWaiting && d.jobs.waiting.length) state.queue.open = true;
  state.hadWaiting = d.jobs.waiting.length > 0;
  state.ready = ["Ready", "Printing"].includes(d.printer.state);
  state.updateButton();
  state.sources = [{ name: "The printer", tone: "ok" }];
  state.printer.replaceChildren(printerPlate(d));
  state.status.replaceChildren(...[
    d.jobs.waiting.length ? lampRows(d.jobs.waiting.map((j) => job(j, true, state))) : empty("Nothing waiting to print."),
    ...(d.jobs.done.length ? [h("h3", { class: "sub" }, "Recently printed"), lampRows(d.jobs.done.map((j) => job(j, false, state)))] : []),
  ].filter(Boolean));
}

export function failed(state) {
  state.ready = false;
  state.updateButton();
  state.sources = [{ name: "The printer", tone: "bad", word: "isn't answering" }];
  state.printer.replaceChildren(printerPlate(null));
}
