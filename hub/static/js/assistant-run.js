// /assistant/run/<id>: one task, drawn natively (A34 P2n), and the "Start a task" form the Assistant page carries.
// The state machine is assistant-task.js; this draws its model with the kit's parts. Everything from Local AI (the goal,
// steps, the answer, errors) is set as text, never as markup.
//  - Polls every 3 s while the tab shows (main.js's timer calls load; a hidden tab reads nothing and a return reads at once).
//  - The status sentence is one polite live region that keeps its place; the rest redraws only when something changed, and
//    a redraw puts focus back where it was, or on the outcome when the phase changed under the owner's focus.
import { api, askFirst, clockTime, h, post, when } from "./core.js";
import { navigateSpa } from "./control-room.js";
import { faceplate, faceplateLoading, lampRows, section } from "./page-parts.js";
import { PAGES as KIT_PAGES } from "../ui/pages.js";
import { createTask, GOAL_MAX, readCurrent, stepsText, submitTask, TERMINAL, validRunId } from "./assistant-task.js";

export const every = 3;
const RUN_PATH = /^\/assistant\/run\/([^/]+)\/?$/;
const kitRow = (id) => KIT_PAGES.find((p) => p.id === id) || {};
export const TITLE = kitRow("run").label;
export const PURPOSE = "What this task is doing, and what it found";

const TONES = {
  reading: ["unknown", "Reading"], queued: ["unknown", "Queued"], running: ["ok", "Running", true], awaiting_approval: ["warn", "Waiting for you"],
  cancelling: ["unknown", "Cancelling"], completed: ["ok", "Done"], failed: ["bad", "Failed"], cancelled: ["unknown", "Cancelled"],
  unreachable: ["unknown", "Can't reach it"], out_of_date: ["warn", "Out of date"], refused: ["bad", "Refused"], not_found: ["unknown", "Not found"],
};
const WORKER_TONE = { complete: ["ok", "Done"], running: ["ok", "Running"], pending: ["unknown", "Waiting"],
  error: ["bad", "Failed"], blocked: ["unknown", "Skipped"] };
// Phases whose sentence only repeats what the plate or the outcome already shows: the live region still says it, out of sight.
export const QUIET = new Set(["reading", "queued", "running", "completed", "failed"]);
const isoSeconds = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t / 1000 : null; };
const text = (v, n) => { const s = String(v ?? ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// What the faceplate says for a model: the lamp, the readout and the one status sentence. Pure, so it is tested alone.
export function phaseView(m) {
  const lamp = TONES[m.phase] || TONES.out_of_date;
  const steps = stepsText(m.steps);
  const seen = m.lastSeen ? `last seen ${clockTime(m.lastSeen / 1000)}` : "not seen from this browser yet";
  const when_ = m.run?.finishedAt ? when(isoSeconds(m.run.finishedAt)) : "";
  const say = {
    reading: "Reading the task from the Assistant.",
    queued: "Waiting to start.",
    running: steps ? `${steps} done.` : "Working on it. The Assistant hasn't reported its steps yet.",
    awaiting_approval: "Waiting for your approval before it carries on.",
    cancelling: "Asked the Assistant to stop. Waiting for it to confirm.",
    completed: when_ ? `Finished ${when_}.` : "Finished.",
    failed: "Stopped with an error.",
    cancelled: "Stopped at your request. Work a step had already finished is kept.",
    unreachable: m.why === "hub"
      ? `Pi Hub isn't answering. The task may still be running; ${seen}. Trying again.`
      : `Can't reach the Assistant${m.why === "pc_off" ? ": the PC is asleep" : ""}. The task may still be running; ${seen}. Trying again.`,
    out_of_date: "The Assistant is older than this page needs, or sent a state it doesn't know.",
    refused: m.error || "The Assistant refused to show this task.",
    not_found: "The Assistant has no task with this id. It may have been cleared.",
  };
  const readout = ["running", "queued", "cancelling", "awaiting_approval"].includes(m.phase) && steps ? steps : lamp[1];
  return { lamp, readout, caption: say[m.phase] || say.out_of_date };
}

// Names the model's parts that change what is drawn: when none do, the poll doesn't redraw (focus and selection stay).
export const signature = (m) => JSON.stringify([m.phase, m.why, m.error, m.note, m.steps, m.missionRead, m.run?.status, m.run?.cancellable,
  m.run?.error, m.run?.summary, m.mission?.answer, m.mission?.workers, m.run?.finishedAt, Math.floor((m.lastSeen || 0) / 60_000)]);

const meter = (s) => (s && s.total > 1 ? h("span", { class: "ui-meter", role: "meter", "aria-label": "Steps done", "aria-valuemin": 0, "aria-valuemax": s.total,
  "aria-valuenow": s.done, "aria-valuetext": stepsText(s) }, h("i", { style: `width:${Math.round(100 * s.done / s.total)}%` })) : null);

const workerRows = (workers) => lampRows(workers.map((w) => {
  const [tone, word] = WORKER_TONE[w.state] || (w.error ? ["bad", w.state || "Failed"] : ["unknown", w.state || "Not reported"]);
  return { title: w.name || "Step", detail: [w.model, w.error].filter(Boolean).join(" · "), tone, word };
}));

function steps(m) {
  const workers = m.mission?.workers || [];
  const failed = m.missionRead === "failed";
  if (!workers.length && !failed) return null;
  return section("Steps", [
    failed ? h("p", { class: "ui-notice ui-notice--warn", role: "status" },
      workers.length ? "The steps couldn't be refreshed just now; these are the last ones read." : "The Assistant's steps couldn't be read just now.") : null,
    workers.length ? workerRows(workers) : null], { id: "run-steps" });
}

// The reason, once: the plate says Failed, this says why.
function failure(m) {
  const reason = m.run?.error || "The Assistant gave no reason.";
  return h("section", { class: "ui-notice ui-notice--bad assistant-run__failure", "aria-labelledby": "run-outcome" },
    h("h2", { id: "run-outcome", tabindex: "-1" }, "Why it stopped"), h("p", { class: "assistant-answer" }, reason));
}

function answer(m, ctl) {
  const full = m.mission?.answer;
  const body = full || m.run?.summary || "The Assistant gave no answer.";
  return section("Answer", [
    h("p", { class: "assistant-answer", id: "run-answer" }, body),
    !full && m.missionRead === "failed" ? h("p", { class: "ui-notice ui-notice--warn", role: "status" },
      "This is the Assistant's short summary. The full answer couldn't be read.", " ",
      h("button", { class: "ui-btn ui-btn--ghost", type: "button", dataset: { focus: "reload" }, onclick: () => ctl.reload() }, "Load the full answer")) : null,
  ], { id: "run-outcome" });
}

const isOpen = (m) => ["queued", "running", "awaiting_approval"].includes(m.phase);

// Cancel is shown while `cancellable` is true, asks first and says what it stops. Never retried by itself.
function cancelButton(m, ctl) {
  if (m.phase === "cancelling") return h("button", { class: "ui-btn", type: "button", "aria-disabled": "true", dataset: { focus: "cancel" } }, "Cancelling…");
  if (!isOpen(m) || m.run?.cancellable !== true) return null;
  const b = h("button", { class: "ui-btn ui-btn--danger", type: "button", dataset: { focus: "cancel" } }, "Cancel the task");
  b.addEventListener("click", async () => {
    const yes = await askFirst(b, "The Assistant stops this task and the model requests it has open on the PC. Steps already finished are kept.",
      { confirm: "Cancel the task", danger: true });
    if (yes) ctl.cancel();
  });
  return b;
}

function actions(m, ctl, ui) {
  const out = [cancelButton(m, ctl)];
  if (m.phase === "awaiting_approval") out.push(h("a", { class: "ui-btn ui-btn--primary", href: "/assistant?to=inbox", "data-link": true }, "Open Decisions"));
  if (m.phase === "failed") {
    out.push(m.goal ? h("button", { class: "ui-btn ui-btn--primary", type: "button", dataset: { focus: "retry" }, onclick: () => ui.retry(m.goal) }, "Try again")
      : h("a", { class: "ui-btn ui-btn--primary", href: "/assistant", "data-link": true }, "Start a new task"));
  }
  if (["completed", "cancelled"].includes(m.phase)) out.push(h("a", { class: "ui-btn", href: "/assistant", "data-link": true }, "Start another task"));
  return out.filter(Boolean);
}

function readings(m) {
  const r = m.run || {};
  const t = (iso) => (iso ? when(isoSeconds(iso)) : null);
  const gone = m.phase === "unreachable";
  return [["Started", t(r.startedAt || r.createdAt)], gone ? null : ["Updated", t(r.updatedAt)],
    gone && m.steps ? ["Steps when last seen", stepsText(m.steps)] : null, ["Last seen", gone && m.lastSeen ? when(m.lastSeen / 1000) : null]].filter(Boolean);
}

// The whole body for a model, below the live sentence.
export function body(m, ctl, ui = {}) {
  if (m.phase === "reading") return [faceplateLoading("Task")];
  const v = phaseView(m);
  const plate = faceplate({ name: "Task", lamp: v.lamp, readout: v.readout, size: "md", caption: m.goal ? text(m.goal, 300) : null, readings: readings(m),
    extra: [m.note ? h("p", { class: "ui-notice ui-notice--warn", role: "status" }, m.note) : null,
      ["running", "cancelling", "awaiting_approval"].includes(m.phase) ? meter(m.steps) : null],
    actions: actions(m, ctl, ui) });
  return [plate, m.phase === "failed" ? failure(m) : null, m.phase === "completed" ? answer(m, ctl) : null, steps(m),
    h("details", { class: "ui-disclosure assistant-run__details" }, h("summary", { class: "ui-disclosure__summary" }, "Details"),
      h("div", { class: "ui-disclosure__body" }, h("p", {}, "Task id: ", h("code", {}, m.runId)),
        m.run?.outcome ? h("p", {}, `Outcome: ${m.run.outcome}`) : null))];
}

// ---- the page ----

export function mount(state) {
  const id = RUN_PATH.exec(location.pathname)?.[1] || "";
  state.runId = decodeURIComponent(id);
  state.left = false;
  state.live = h("p", { class: "assistant-run__live visually-hidden", role: "status", "aria-live": "polite" });
  state.body = h("div", { class: "assistant-run__body" });
  state.root.append(h("nav", { class: "page-trail", "aria-label": "Breadcrumb" }, h("a", { href: "/assistant", "data-link": true }, "Assistant"),
    h("span", { "aria-hidden": "true" }, " / "), h("span", { "aria-current": "page" }, TITLE)), state.live, state.body);
  if (!validRunId(state.runId)) {
    state.model = { phase: "refused", error: "That isn't a task id.", runId: state.runId, goal: "", lastSeen: 0 };
    draw(state);
    return;
  }
  state.ctl = createTask({ runId: state.runId, api, post, hidden: () => document.hidden });
  state.model = state.ctl.model;
  state.ui = { retry: (goal) => retry(state, goal) };
  state.unsubscribe = state.ctl.subscribe(() => draw(state));
  state.onVisible = () => { if (!document.hidden) { state.ctl.resume(); state.ctl.tick(); } };
  document.addEventListener("visibilitychange", state.onVisible);
  draw(state);
}

async function retry(state, goal) {
  const r = await submitTask(post, goal);
  if (r.ok) (state.goto || navigateSpa)(`/assistant/run/${r.runId}`);
  else { state.model.note = r.error || "The Assistant couldn't start the task."; state.last = ""; draw(state); }
}

// Redraw when the signature changed. Focus: an element the owner was on (data-focus) is found again; if the phase changed
// under their focus, it goes to the outcome or the status sentence; if focus was elsewhere (the rail), it is left alone.
function draw(state) {
  const m = state.model;
  const sig = signature(m);
  state.live.textContent = phaseView(m).caption;
  state.live.classList.toggle("visually-hidden", QUIET.has(m.phase));
  if (sig === state.last) return;
  const at = document.activeElement;
  const inside = at && state.body.contains(at);
  const key = inside ? at.dataset?.focus : null;
  const changed = state.last !== undefined && JSON.parse(state.last || "[]")[0] !== m.phase;
  state.last = sig;
  state.body.replaceChildren(...body(m, state.ctl, state.ui).filter(Boolean));
  const nowhere = !at || at === document.body;  // nothing focused: an outcome may take it; the rail's focus is the owner's
  const target = (key && state.body.querySelector(`[data-focus="${key}"]`))
    || (inside || (changed && TERMINAL.has(m.phase) && nowhere) ? state.body.querySelector("#run-outcome") || state.body.querySelector(".ui-faceplate") : null);
  if (target) { if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT)$/.test(target.tagName)) target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
}

export async function load(state) {
  await state.ctl?.tick();
}

export function leave(state) {
  state.left = true;
  state.unsubscribe?.();
  if (state.onVisible) document.removeEventListener("visibilitychange", state.onVisible);
}

// ---- Start a task (on the Assistant page) ----

// A clearly separated action above the frame: closed it is one line, "Start a task"; open it is a goal box and one button.
// `availability({disabled, phrase})` is the Assistant page's own check (pc_off, assistant_down): the form stays, disabled
// (D13: refused while the PC sleeps, not queued). The reason is the frame's notice below, said once; the form adds none.
export function startTask({ goto = navigateSpa, storage = globalThis.localStorage } = {}) {
  const goal = h("textarea", { id: "assistant-task-goal", class: "ui-field assistant-task__goal", rows: 3, maxlength: GOAL_MAX, autocomplete: "off",
    "aria-describedby": "assistant-task-note" });
  const note = h("p", { id: "assistant-task-note", class: "assistant-task__note", role: "status" });
  const go = h("button", { class: "ui-btn ui-btn--primary", type: "submit" }, "Start the task");
  const form = h("form", { class: "assistant-task__form" },
    h("label", { for: "assistant-task-goal" }, "What should the Assistant work on?"), goal,
    h("div", { class: "assistant-task__row" }, go, note));
  let off = null;
  const current = h("p", { class: "assistant-task__current" });
  const showCurrent = () => {
    const c = readCurrent(storage);
    current.replaceChildren(...(c ? ["Your current task: ", h("a", { href: `/assistant/run/${c.runId}`, "data-link": true }, c.goal ? text(c.goal, 80) : "Open it")] : []));
    current.hidden = !c;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (off || go.getAttribute("aria-disabled") === "true") return;
    go.setAttribute("aria-disabled", "true");
    go.textContent = "Starting…";
    note.textContent = "";
    const r = await submitTask(post, goal.value, { storage });
    go.removeAttribute("aria-disabled");
    go.textContent = "Start the task";
    if (r.ok) { goto(`/assistant/run/${r.runId}`); return; }
    // A refused or failed submit keeps what was typed and says what went wrong.
    goal.setAttribute("aria-invalid", "true");
    note.textContent = r.state === "needs_pc" ? "Starting a task needs the PC. It is asleep." : r.error || "The Assistant couldn't start the task.";
    goal.focus();
  });
  goal.addEventListener("input", () => goal.removeAttribute("aria-invalid"));
  const el = h("details", { class: "assistant-task ui-disclosure" },
    h("summary", { class: "ui-disclosure__summary" }, "Start a task"),
    h("div", { class: "ui-disclosure__body" },
      h("p", { class: "assistant-task__purpose" }, "Give the Assistant a goal. It works on the PC, so you can leave this page and come back."), form));
  showCurrent();
  const wrap = h("div", { class: "assistant-task__box" }, el, current);
  return {
    el: wrap,
    availability({ disabled, phrase }) {
      off = disabled ? phrase : null;
      goal.disabled = !!disabled;
      if (disabled) go.setAttribute("aria-disabled", "true"); else go.removeAttribute("aria-disabled");
      if (disabled) note.textContent = "";
      showCurrent();
    },
  };
}
