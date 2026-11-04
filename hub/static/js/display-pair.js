// Workshop display card (System › Settings, workshop flow W.1): pair the display with a 6-digit code, and show when it was paired.
import { api, card, h, post, toast } from "./core.js";

export function minutesText(m) {
  return m < 1 ? "Under a minute left" : `${m} min left`;
}

export function pairError(err) {
  if (err && (err.status === 401 || err.status === 403)) return "Only the owner can pair the display. Sign in as the owner.";
  const why = err?.message ? ` ${err.message}` : "";
  return `Couldn't start pairing.${why}`;
}

// status: GET /api/display/pair/status; shown: {code, expires} from pair/start (the hub never returns the code again); now in seconds.
export function pairState(status, shown, now) {
  if (shown && status?.code_open && shown.expires > now) {
    const minutesLeft = Math.ceil((shown.expires - now) / 60);
    return { kind: "code", code: shown.code, minutesLeft, label: `Type this on the display · ${minutesText(minutesLeft)}` };
  }
  if (status?.paired) {
    const d = status.paired_at ? new Date(status.paired_at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
    return { kind: "paired", label: d ? `Paired ${d}` : "Paired" };
  }
  return { kind: "idle", label: "Not paired" };
}

export function displayCard() {
  const body = h("div", { class: "display-pair" });
  const el = card("Workshop display", {}, body);
  let shown = null;
  let status = null;
  let timer = null;

  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  async function start() {
    try {
      shown = await post("/api/display/pair/start");
      status = { ...(status || {}), code_open: true };
      render();
      poll();
    } catch (e) { toast(pairError(e), "bad"); }
  }
  async function refresh() {
    try { status = await api("/api/display/pair/status"); } catch { /* keep what we had */ }
    render();
  }
  function poll() {
    stop();
    timer = setInterval(() => {
      if (!el.isConnected) return stop();
      refresh().then(() => { if (pairState(status, shown, Date.now() / 1000).kind !== "code") stop(); });
    }, 5000);
  }
  function render() {
    const s = pairState(status, shown, Date.now() / 1000);
    const kids = [];
    if (s.kind === "code") {
      kids.push(h("p", { class: "display-pair-code", style: "font-size:2.6rem;letter-spacing:.3em;font-weight:700;margin:.2em 0", "aria-hidden": "true" }, s.code));
      kids.push(h("p", { class: "meta", role: "status", "aria-live": "polite" }, `Code ${s.code.split("").join(" ")}. ${s.label}`));
    } else {
      kids.push(h("p", { class: "meta", role: "status", "aria-live": "polite" }, s.label));
    }
    kids.push(h("button", { type: "button", class: "btn btn-ghost", onclick: start }, s.kind === "idle" ? "Pair display" : s.kind === "code" ? "New code" : "Pair again"));
    body.replaceChildren(...kids);
  }

  render();
  refresh();
  return el;
}
