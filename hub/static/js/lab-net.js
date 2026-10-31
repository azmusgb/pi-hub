// Network for the /lab page: one fetch helper that signs in when it has to and speaks plainly, and one gentle poller
// for the requests the Mac has yet to pick up. Relative, same-origin /api/lab/... only; Origin is never set.
import { ensure as coreEnsure } from "./core.js";

const deps = {
  fetch: (...a) => globalThis.fetch(...a),
  ensure: (role) => coreEnsure(role),
  hidden: () => Boolean(globalThis.document && globalThis.document.hidden),
};
// Tests inject fetch, ensure and visibility here; nothing else needs a DOM.
export function setDeps(d) { Object.assign(deps, d); }

const PROJECT_GET = /^\/api\/lab\/[^/?#]+$/;

function problem(r, body) {
  const t = (v) => (typeof v === "string" && v.trim() ? v : "");
  return t(body && body.detail) || t(body && body.error) || `HTTP ${r.status}`;
}

export async function labFetch(path, opts = {}, { prompt = true } = {}) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) throw new Error("Lab calls must use a relative path.");
  const method = String(opts.method || "GET").toUpperCase();
  const call = () => deps.fetch(path, { cache: "no-store", ...opts, method });
  let r = await call();
  if (r.status === 401 && prompt) {
    if (await deps.ensure("household")) r = await call();
  }
  if (r.ok) return r.json().catch(() => ({}));
  const body = await r.json().catch(() => ({}));
  if (r.status === 404 && method === "GET" && PROJECT_GET.test(path)) return null;
  // The status travels with the error, so the page can tell "sign in" (401) from everything else.
  const err = new Error(r.status === 403 ? "Kids can't use the lab." : problem(r, body));
  err.status = r.status;
  throw err;
}

export const POLL_FIRST_MS = 1000;
export const POLL_CAP_MS = 10000;
export const POLL_GIVE_UP_MS = 10 * 60 * 1000;
// The Mac's answers that end a request: applied, refused, or duplicate (it had already recorded that very request).
const DONE = ["applied", "refused", "duplicate"];
export const recorded = (status) => status === "applied" || status === "duplicate";

// One setTimeout chain for every pending request id: 1 s, x1.5 up to 10 s, back to 1 s when anything changes, quiet
// while the page is hidden, stopped when nothing is pending or after 10 minutes. Returns stop().
export function watchRequests(project, ids, onUpdate) {
  const pending = new Set(ids);
  const last = new Map(ids.map((id) => [id, "pending|"])); // what we assume until the Mac says otherwise
  const until = Date.now() + POLL_GIVE_UP_MS;
  let delay = POLL_FIRST_MS, timer = null, stopped = false;
  const grow = () => { delay = Math.min(POLL_CAP_MS, Math.round(delay * 1.5)); };

  const schedule = () => { if (!stopped) timer = setTimeout(tick, delay); };
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); timer = null; };

  async function tick() {
    timer = null;
    if (stopped) return;
    if (!pending.size || Date.now() > until) return stop();
    if (deps.hidden()) { grow(); return schedule(); }
    let changed = false;
    try {
      const data = await labFetch(`/api/lab/${encodeURIComponent(project)}/requests`, {}, { prompt: false });
      if (stopped) return;
      for (const item of (data && data.items) || []) {
        if (!pending.has(item.id)) continue;
        const sig = `${item.status}|${item.message || ""}`;
        if (last.get(item.id) !== sig) { last.set(item.id, sig); changed = true; }
        onUpdate(item); // every poll, so the page can age a pending request ("the Mac hasn't picked this up")
        if (DONE.includes(item.status)) pending.delete(item.id);
      }
    } catch { /* offline or signed out: keep waiting, never prompt */ }
    if (stopped) return;
    if (!pending.size) return stop();
    if (changed) delay = POLL_FIRST_MS; else grow();
    schedule();
  }

  schedule();
  return stop;
}
