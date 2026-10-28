// Clear the plate, pause and resume the X2D (one home, step 3): the buttons that fit the printer's state now
// (printer.actions from /api/now and /api/workshop), sent to /api/printer/<action>, which goes through Bambuddy.
import { ensure, h, post, toast } from "./core.js";

export const PRINTER_ACTIONS = {
  clear: { label: "Clear the plate", ask: "Is the plate empty? Bambuddy may start the next print in the queue." },
  pause: { label: "Pause the print", ask: "Pause the print? It waits on the plate until you resume it." },
  resume: { label: "Resume the print", ask: null },
};

export function printerActionList(p) {
  return (p?.actions || []).filter((a) => PRINTER_ACTIONS[a]).map((action) => ({ action, ...PRINTER_ACTIONS[action] }));
}

const DEPS = { confirm: (q) => window.confirm(q), ensure, post, toast };

// One action at a time, for the whole page: a refresh redraws the buttons, so the flag lives here, not on them.
let busy = false;
export const printerBusy = () => busy;

export async function runPrinterAction(action, buttons, onDone, deps = DEPS) {
  if (busy) return;
  const ask = PRINTER_ACTIONS[action]?.ask;
  if (ask && !deps.confirm(ask)) return;
  if (busy) return;  // another action started while the question was open
  busy = true;
  buttons.forEach((b) => { b.disabled = true; });
  try {
    if (!(await deps.ensure("owner"))) return;
    const r = await deps.post(`/api/printer/${action}`);
    deps.toast(r?.say || "Done.", "ok");
  } catch (e) {
    deps.toast(e?.message || "The printer didn't answer.", "bad");
  } finally {
    busy = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
  onDone?.();
}

// The wall's badge: what the printer is doing in a word or two (not "IDLE" whenever it isn't printing).
export function kioskBadge(p) {
  const s = p?.state;
  if (s === "printing") return { label: "PRINTING", tone: "ok" };
  if (s === "paused") return { label: "PAUSED", tone: "warn" };
  if (s === "error") return { label: "NEEDS ATTENTION", tone: "bad" };
  if (s === "stopped") return (p.actions || []).includes("clear") ? { label: "CLEAR THE PLATE", tone: "warn" } : { label: "STOPPED", tone: "text-3" };
  if (s === "finished") return (p.actions || []).includes("clear") ? { label: "CLEAR THE PLATE", tone: "warn" } : { label: "FINISHED", tone: "ok" };
  if (s === "idle") return { label: "IDLE", tone: "text-3" };
  return { label: "NO STATUS", tone: "text-3" };
}

export function printerButtons(p, onDone) {
  const list = printerActionList(p);
  if (!list.length) return null;
  const buttons = list.map((a, i) => h("button", { type: "button", class: i ? "btn ghost" : "btn btn--primary", disabled: busy }, a.label));
  list.forEach((a, i) => buttons[i].addEventListener("click", () => runPrinterAction(a.action, buttons, onDone)));
  return h("div", { class: "printer-actions" }, ...buttons);
}
