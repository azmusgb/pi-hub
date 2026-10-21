// Print: send a file to the HP DeskJet from any device, watch the queue, check the ink.
import { api, card, empty, h, post, toast } from "./core.js";

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
    const f = file.files[0];
    const valid = f && f.size > 0 && f.size <= 25 * 1024 * 1024 && /\.(pdf|jpe?g|png|txt)$/i.test(f.name);
    button.disabled = state.sending || !state.ready || !valid;
    if (!state.ready) help.textContent = "Printer unavailable. Check that the HP DeskJet is on and connected to your home network.";
    else if (!f) help.textContent = "Choose a PDF, photo or text file to enable Print.";
    else if (!valid) help.textContent = "Choose a non-empty PDF, JPG, PNG or text file up to 25 MB.";
    else help.textContent = state.sending ? "Sending your file…" : "Ready to print your selected file.";
  };
  file.addEventListener("change", () => {
    const f = file.files[0];
    chosen.textContent = f ? `${f.name}, ${(f.size / 1e6).toFixed(1)} MB` : "PDF, photo (JPG or PNG) or text file, up to 25 MB.";
    state.updateButton();
  });
  const form = h("form", { class: "print-form", onsubmit: async (e) => {
    e.preventDefault();
    const f = file.files[0];
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
  state.printer = h("div", { class: "cards" });
  state.status = h("div", { class: "cards" });
  state.root.append(state.printer, card("Print something", { cls: "wide" }, form), state.status);
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
  state.ready = ["Ready", "Printing"].includes(d.printer.state);
  state.updateButton();
  state.printer.replaceChildren(
    card("HP DeskJet 4200", { pill: d.printer.state, tone: d.printer.state === "Ready" || d.printer.state === "Printing" ? "ok" : "bad" },
      ink.length
        ? h("div", { class: "ink" }, ink.map((i) => h("div", { class: "ink-row" },
          h("span", {}, ({ "Colour": "Tri-color", "Color": "Tri-color", "Black": "Black" })[i.name] || i.name),
          h("span", { class: "ink-bar", role: "meter", "aria-label": `${i.name} ink`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": i.level },
            h("i", { style: `width:${i.level}%`, dataset: { tone: i.level < 15 ? "bad" : i.level < 30 ? "warn" : "ok", ink: i.name.toLowerCase() } })),
          h("span", { class: "ink-pct" }, `${i.level}%`))))
        : h("p", { class: "meta" }, "Ink levels show once the printer answers."),
      ink.some((i) => i.level < 15) ? h("p", { class: "note" }, "Ink is low. Order a cartridge soon.") : null));
  state.status.replaceChildren(
    card("Queue", { pill: d.jobs.waiting.length ? `${d.jobs.waiting.length} waiting` : "Empty", tone: d.jobs.waiting.length ? "warn" : "ok" },
      d.jobs.waiting.length ? h("ul", { class: "log" }, d.jobs.waiting.map((j) => job(j, true, state))) : empty("Nothing waiting to print."),
      d.jobs.done.length ? [h("h3", { class: "sub" }, "Recently printed"), h("ul", { class: "log" }, d.jobs.done.map((j) => job(j, false, state)))] : null),
  );
}

export function failed(state) {
  state.ready = false;
  state.updateButton();
}
