// Print: send a file to the HP DeskJet from any device, watch the queue, check the ink.
import { api, card, empty, h, post, toast } from "./core.js";

export const every = 10;

export function mount(state) {
  const file = h("input", { type: "file", id: "print-file", accept: ".pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain", required: true });
  const copies = h("input", { type: "number", id: "print-copies", min: 1, max: 20, value: 1, inputmode: "numeric" });
  const mono = h("input", { type: "checkbox", id: "print-mono" });
  const chosen = h("p", { class: "meta", id: "print-chosen" }, "PDF, photo (JPG or PNG) or text file, up to 25 MB.");
  const button = h("button", { type: "submit", class: "primary" }, "Print");
  file.addEventListener("change", () => {
    const f = file.files[0];
    chosen.textContent = f ? `${f.name}, ${(f.size / 1e6).toFixed(1)} MB` : "PDF, photo (JPG or PNG) or text file, up to 25 MB.";
  });
  const form = h("form", { class: "print-form", onsubmit: async (e) => {
    e.preventDefault();
    const f = file.files[0];
    if (!f) { toast("Choose a file to print first.", "warn"); return; }
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      const q = new URLSearchParams({ filename: f.name, copies: copies.value || 1, mono: mono.checked });
      const r = await api(`/api/print?${q}`, { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
      toast(`Sent ${r.title} to the printer${r.copies > 1 ? `, ${r.copies} copies` : ""}.`);
      form.reset();
      chosen.textContent = "PDF, photo (JPG or PNG) or text file, up to 25 MB.";
      load(state);
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      button.disabled = false;
      button.textContent = "Print";
    }
  } },
  h("label", { class: "drop", for: "print-file" },
    h("span", { class: "drop-title" }, "Choose a file"), chosen, file),
  h("div", { class: "print-options" },
    h("label", { for: "print-copies" }, "Copies", copies),
    h("label", { class: "check", for: "print-mono" }, mono, "Black and white")),
  button);
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
  state.status = h("div", { class: "cards" });
  state.root.append(card("Print something", { cls: "wide" }, form), state.status);
}

function job(j, cancellable, state) {
  return h("li", { class: "log-row" },
    h("span", { class: "dot", dataset: { tone: cancellable ? "warn" : "ok" } }),
    h("span", { class: "log-main" }, h("strong", {}, `Job ${j.number}`), h("span", { class: "meta" }, j.when)),
    cancellable
      ? h("button", { class: "ghost", onclick: async () => {
        try { await post(`/api/print/${encodeURIComponent(j.id)}/cancel`); toast(`Cancelled job ${j.number}.`); load(state); }
        catch (e) { toast(e.message, "bad"); }
      } }, "Cancel")
      : h("span", { class: "log-side" }, "Printed"));
}

export async function load(state) {
  const d = await api("/api/print");
  const ink = d.ink || [];
  state.status.replaceChildren(
    card("HP DeskJet 4200", { pill: d.printer.state, tone: d.printer.state === "Ready" || d.printer.state === "Printing" ? "ok" : "bad" },
      ink.length
        ? h("div", { class: "ink" }, ink.map((i) => h("div", { class: "ink-row" },
          h("span", {}, i.name),
          h("span", { class: "ink-bar", role: "meter", "aria-label": `${i.name} ink`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": i.level },
            h("i", { style: `width:${i.level}%`, dataset: { tone: i.level < 15 ? "bad" : i.level < 30 ? "warn" : "ok", ink: i.name.toLowerCase() } })),
          h("span", { class: "ink-pct" }, `${i.level}%`))))
        : h("p", { class: "meta" }, "Ink levels show once the printer answers."),
      ink.some((i) => i.level < 15) ? h("p", { class: "note" }, "Ink is low. Order a cartridge soon.") : null),
    card("Queue", { pill: d.jobs.waiting.length ? `${d.jobs.waiting.length} waiting` : "Empty", tone: d.jobs.waiting.length ? "warn" : "ok" },
      d.jobs.waiting.length ? h("ul", { class: "log" }, d.jobs.waiting.map((j) => job(j, true, state))) : empty("Nothing waiting to print."),
      d.jobs.done.length ? [h("h3", { class: "sub" }, "Recently printed"), h("ul", { class: "log" }, d.jobs.done.map((j) => job(j, false, state)))] : null),
  );
}
