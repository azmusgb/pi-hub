// The first native task (A34 P2n): what a Mission is doing, as the task page draws it. No DOM here: the page
// (assistant-pages.js) draws a `model` and calls these. Local AI owns the task; Pi Hub keeps only the run id and the goal
// in this browser (the "current task") so leaving the page, a reload or a Pi restart re-reads the run by id.
//
// Every state is Local AI's or the honest absence of it:
//  - a run's status is passed as Local AI says it; one this page doesn't know is `out_of_date`, never guessed;
//  - "N of M steps" counts the mission's workers that are complete; there is no percentage unless a count gives one;
//  - when Local AI or the PC can't be reached the phase is `unreachable` ("the task may still be running"), never `failed`;
//  - cancel is asked once and never retried by itself.
export const KEY = "hub-ai-current-task";
export const POLL_MS = 3000;
export const BACKOFF_MAX_MS = 30_000;
export const GOAL_MAX = 2000;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;

export const validRunId = (v) => typeof v === "string" && RUN_ID.test(v);
export const TERMINAL = new Set(["completed", "failed", "cancelled"]);
// Phases that end polling: the task is over, or there is nothing at that address to follow.
const STOPS = new Set([...TERMINAL, "out_of_date", "refused", "not_found"]);
const PHASE_OF = { queued: "queued", running: "running", streaming: "running", awaiting_approval: "awaiting_approval",
  completed: "completed", failed: "failed", cancelled: "cancelled" };

// ---- the current task, in this browser only ----

export function readCurrent(storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage.getItem(KEY));
    return c && validRunId(c.runId) ? { runId: c.runId, goal: typeof c.goal === "string" ? c.goal.slice(0, GOAL_MAX) : "",
      startedAt: Number(c.startedAt) || 0, lastSeen: Number(c.lastSeen) || 0 } : null;
  } catch { return null; }
}
export function writeCurrent(cur, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify({ runId: cur.runId, goal: String(cur.goal || "").slice(0, GOAL_MAX), startedAt: cur.startedAt || 0, lastSeen: cur.lastSeen || 0 })); } catch { /* private mode: the address still holds the id */ }
}
export function clearCurrent(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch { /* nothing to clear */ }
}

// ---- what the hub answered ----

// The adapter's own answer, whether it came as a 2xx or as a refusal (api() throws on those, with the body on the error).
export function bodyOf(err) {
  const b = err?.body;
  if (b && typeof b === "object" && typeof b.state === "string") return b;
  if (err?.status === 401) return { state: "refused", error: "Sign in as the owner to follow this task." };
  return { state: "unreachable", why: "hub" };
}

// Local AI's word for it, from its workers: how many are complete of how many there are; null without workers.
export function stepsOf(mission) {
  const w = Array.isArray(mission?.workers) ? mission.workers : [];
  return w.length ? { done: w.filter((x) => x?.state === "complete").length, total: w.length } : null;
}

export const stepsText = (s) => (s ? `${s.done} of ${s.total} step${s.total === 1 ? "" : "s"}` : "");

// Submit a goal: {ok, runId} or {ok:false, state, error, installed?}. The goal is kept with the run id for Try again.
export async function submitTask(post, goal, { storage = globalThis.localStorage, now = Date.now } = {}) {
  const text = typeof goal === "string" ? goal.trim() : "";
  if (!text) return { ok: false, state: "refused", error: "Say what the task is." };
  if (text.length > GOAL_MAX) return { ok: false, state: "refused", error: `Keep the task under ${GOAL_MAX.toLocaleString()} characters (${text.length.toLocaleString()} now).` };
  let b;
  try { b = await post("/api/ai/tasks", { goal: text }); } catch (e) { b = bodyOf(e); }
  if (b?.state === "submitted" && validRunId(b.runId)) {
    writeCurrent({ runId: b.runId, goal: text, startedAt: now(), lastSeen: now() }, storage);
    return { ok: true, runId: b.runId };
  }
  return { ok: false, state: b?.state || "unreachable", error: typeof b?.error === "string" ? b.error : "", installed: Array.isArray(b?.installed) ? b.installed : [], why: b?.why };
}

// ---- following one run ----

export function createTask({ runId, api, post, now = Date.now, storage = globalThis.localStorage, hidden = () => false }) {
  const cur = readCurrent(storage);
  const m = {
    runId, phase: "reading", run: null, mission: null, missionRead: "none", steps: null, goal: cur?.runId === runId ? cur.goal : "",
    lastSeen: cur?.runId === runId ? cur.lastSeen : 0,  // ms; the last time Local AI answered about this run
    why: "", error: "", note: "", cancelAsked: false,
  };
  const listeners = new Set();
  let busy = false, nextAt = 0, gap = POLL_MS;
  const emit = () => { for (const f of listeners) f(m); };
  const remember = () => {
    const c = readCurrent(storage);
    if (c?.runId === runId) writeCurrent({ ...c, lastSeen: m.lastSeen }, storage);
    else if (!c && !STOPS.has(m.phase)) writeCurrent({ runId, goal: m.goal, startedAt: now(), lastSeen: m.lastSeen }, storage);
  };

  function apply(b) {
    if (b.state === "busy") { gap = Math.min(gap * 2, BACKOFF_MAX_MS); return; }  // nothing was learned: keep what is shown
    if (b.state === "ok" && b.run && PHASE_OF[b.run.status]) {
      m.run = b.run;
      if (!m.goal && typeof b.run.goal === "string") m.goal = b.run.goal;  // a run read on another device still shows what was asked
      m.mission = b.mission || null;
      m.missionRead = b.mission_read || "none";
      m.steps = stepsOf(b.mission);
      m.lastSeen = now();
      m.why = ""; m.error = "";
      const phase = PHASE_OF[b.run.status];
      m.phase = m.cancelAsked && !TERMINAL.has(phase) ? "cancelling" : phase;
      if (TERMINAL.has(phase)) m.cancelAsked = false;
      gap = POLL_MS;
      remember();
    } else if (b.state === "unreachable") {
      m.phase = "unreachable";
      m.why = b.why || "unreachable";
      gap = Math.min(gap * 2, BACKOFF_MAX_MS);
    } else if (["out_of_date", "refused", "not_found"].includes(b.state)) {
      m.phase = b.state;
      m.error = typeof b.error === "string" ? b.error : "";
      if (b.state === "not_found") { const c = readCurrent(storage); if (c?.runId === runId) clearCurrent(storage); }
    } else {
      m.phase = "out_of_date";
      m.error = "";
    }
  }

  async function read() {
    if (busy) return;
    busy = true;
    try {
      let b;
      try { b = await api(`/api/ai/tasks/${encodeURIComponent(runId)}`); } catch (e) { b = bodyOf(e); }
      apply(b);
      nextAt = now() + gap;
      emit();
    } finally { busy = false; }
  }

  return {
    model: m,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    // Read now if the run isn't over, the tab is showing and any backoff has passed. A hidden tab reads nothing.
    async tick({ force = false } = {}) {
      if (STOPS.has(m.phase) || hidden() || busy) return;
      if (!force && now() < nextAt) return;
      await read();
    },
    // Back in view: no waiting out a backoff.
    resume() { nextAt = 0; gap = POLL_MS; },
    // One more read of a finished run (the answer's detail didn't load), at the owner's asking.
    async reload() { await read(); },
    async cancel() {
      if (!m.run?.cancellable || m.cancelAsked || STOPS.has(m.phase)) return null;
      m.cancelAsked = true;
      m.phase = "cancelling";
      m.note = "";
      emit();
      let b;
      try { b = await post(`/api/ai/tasks/${encodeURIComponent(runId)}/cancel`); } catch (e) { b = bodyOf(e); }
      if (b.state === "ok" && b.run && PHASE_OF[b.run.status]) {
        const phase = PHASE_OF[b.run.status];
        m.run = { ...m.run, ...b.run };
        m.lastSeen = now();
        m.cancelAsked = !TERMINAL.has(phase);
        m.phase = TERMINAL.has(phase) ? phase : "cancelling";
        if (TERMINAL.has(phase)) m.note = "";
      } else {
        // Not cancelled, as far as Pi Hub knows: say why, go back to what the run was, and let the owner decide. Never retried.
        m.cancelAsked = false;
        m.phase = PHASE_OF[m.run.status] || "running";
        m.note = b.state === "not_cancellable" ? (b.error || "This task can't be cancelled now.")
          : b.state === "needs_pc" ? "Cancelling needs the PC."
            : b.state === "not_found" ? (b.error || "The Assistant has no task with this id.")
              : "Pi Hub couldn't reach the Assistant, so the task wasn't cancelled as far as it knows. Try again when it answers.";
        if (b.state === "not_cancellable") { nextAt = 0; }
      }
      emit();
      return b;
    },
  };
}
