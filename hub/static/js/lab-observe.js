// /lab: "Record what happened", the phone form for observations (a port of Local AI's print-lab-observe.js).
// One guided session per printed pair or strip: identify the part, then only the questions that belong to each subject
// (the pair: separation and overall; each tile: face, back and mounting; a strip: face, separation and overall), then
// the light. Nothing is preselected; every question also offers "Not looked at", "Couldn't tell" and "Doesn't apply".
// The draft lives on the phone until the Mac records it; the request id is made once and kept until the Mac refuses it,
// so a retry after a lost answer, or after an edit while the Mac sleeps, is the same request and is never recorded twice. Everything from the Mac is escaped. The pure parts are exported for node.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const list = (v) => (Array.isArray(v) ? v : []);

export const VALUES = {
  face: [["clean", "Clean"], ["flawed", "Flawed"], ["failed", "Failed"]],
  separation: [["easily", "Came apart easily"], ["effort", "With effort"], ["no", "Didn't come apart"]],
  backing: [["whole", "Whole"], ["marked", "Marked"], ["damaged", "Damaged"]],
  mounting: [["fits", "Mounts"], ["needs_work", "Needs work"], ["unusable", "Can't be mounted"]],
  acceptance: [["accepted", "Accepted"], ["accepted_with_defects", "Accepted with defects"], ["rejected", "Rejected"]],
};
const MISSING = [["not_assessed", "Not looked at"], ["unknown", "Couldn't tell"], ["not_applicable", "Doesn't apply"]];
const LABEL = { face: "Face", separation: "Separation", backing: "Back", mounting: "Mounting", acceptance: "Overall" };
const LIGHTS = [["diagnostic", "Diagnostic (raking light from one side)"], ["room", "Room light"], ["installed", "Installed, where the tile will live"], ["unknown", "Not sure"]];
const PAIRED = new Set(["full_part", "scaled_part"]);
export const PICKUP = "The Mac hasn't picked this up yet. It runs when the Mac is awake; your answers are kept.";
// Every outcome a subject can carry is in every snapshot (complete snapshots); unasked ones are not_assessed.
const ALLOWED = { tile: ["face", "backing", "mounting", "acceptance"], pair: ["separation", "acceptance"], strip: ["face", "separation", "acceptance"], run: ["acceptance"] };

// Local AI shows the button on a printing experiment with no verdict yet, and on an answered one; both need a run.
export const canObserve = (x) => Boolean(x && x.run && ((x.status === "printing" && !x.verdict) || x.status === "answered"));
export const observeButton = (x) => (canObserve(x) ? `<button type="button" class="btn-outline lab-observe" data-exp="${esc(x.id)}">Record what happened</button>` : "");

// ---- the draft, kept on the phone; a blocked or full localStorage never breaks the form ----
export const draftKey = (project, id) => `printLab:observe:${project}:${id}`;
export function loadDraft(project, id) {
  try { const d = JSON.parse(globalThis.localStorage.getItem(draftKey(project, id)) || "{}"); return d && typeof d === "object" && !Array.isArray(d) ? d : {}; } catch { return {}; }
}
export function saveDraft(project, id, draft) { try { globalThis.localStorage.setItem(draftKey(project, id), JSON.stringify(draft)); } catch { /* the form still works */ } }
export function clearDraft(project, id) { try { globalThis.localStorage.removeItem(draftKey(project, id)); } catch { /* nothing to clear */ } }

// The subjects this session asks about, each with the outcomes that belong to it.
export function plan(x) {
  return PAIRED.has(x && x.test_kind)
    ? [{ key: "pair", kind: "pair", title: "The pair", outcomes: ["separation", "acceptance"] },
      { key: "tile1", kind: "tile", title: "One tile", side: true, outcomes: ["face", "backing", "mounting"] },
      { key: "tile2", kind: "tile", title: "The other tile", side: true, outcomes: ["face", "backing", "mounting"] }]
    : [{ key: "strip", kind: "strip", title: "The strip", outcomes: ["face", "separation", "acceptance"] }];
}

// The first unanswered question, in the order the form asks them; null when everything is answered.
export function missing(d, x) {
  d = d || {};
  const ans = d.answers || {};
  if (list(x.variants).length && !d.variant) return ["variant", "Which part"];
  if (!d.identified) return ["identified", "How you know which part"];
  if (d.identified === "unidentified" && !(d.identNote || "").trim()) return ["identified", "What you know about the part"];
  for (const s of plan(x)) {
    if (s.side && !(d.sides || {})[s.key]) return [`${s.key}.side`, `${s.title}: which side`];
    for (const o of s.outcomes) {
      const a = ans[`${s.key}.${o}`];
      if (!a || !(a.value || a.status)) return [`${s.key}.${o}`, `${s.title}: ${LABEL[o]}`];
      if (a.status === "not_applicable" && !(a.note || "").trim()) return [`${s.key}.${o}`, `${s.title}: why ${LABEL[o].toLowerCase()} doesn't apply`];
    }
  }
  if (!d.light) return ["light", "The light"];
  return null;
}

// The snapshots the Mac records: one per subject, complete (every allowed outcome present).
export function snapshots(d, x) {
  d = d || {};
  const ans = d.answers || {};
  const variant = d.variant || null, v = list(x.variants).find((y) => y.id === variant);
  const base = {
    experiment: x.id, run: x.run || null, build: x.shown_build || null, variant,
    label: (d.label || "").trim() || null, identified: d.identified, note: d.identified === "unidentified" ? (d.identNote || "").trim() : null,
  };
  const source = { kind: "owner_report", words: (d.words || "").trim(), evidence: [], occurred_at: null, attributed_by: "phone_session" };
  return plan(x).map((s) => {
    const outcomes = {};
    for (const o of ALLOWED[s.kind]) {
      const a = ans[`${s.key}.${o}`];
      outcomes[o] = !a ? { status: "not_assessed", value: null, note: null }
        : a.value ? { status: "assessed", value: a.value, note: (a.note || "").trim() || null }
          : { status: a.status, value: null, note: (a.note || "").trim() || null };
    }
    const side = s.side ? ((d.sides || {})[s.key] === "unknown" ? null : (d.sides || {})[s.key] || null) : null;
    const subject = { ...base, kind: s.kind, tile: side, label: base.label || (v ? v.tab || null : null) };
    if (s.side && !side && subject.identified !== "unidentified") subject.note = (subject.note ? subject.note + "; " : "") + "which side isn't known";
    return { subject, viewing: { light: d.light }, outcomes, source };
  });
}

export const observationRequest = (x, snaps, id) => ({ id, kind: "observation", experiment: x.id, run: x.run || null, payload: { snapshots: snaps } });

// The request to send (Local AI's print-lab-observe.js send()): the id is made on the first send and kept until the Mac
// refuses it; the snapshots are read from the form on every send and kept with the draft as what was sent.
export function prepareSend(draft, x, makeId) {
  draft.requestId = draft.requestId || makeId();
  draft.sentSnapshots = snapshots(draft, x);
  return observationRequest(x, draft.sentSnapshots, draft.requestId);
}
// Only a refusal frees the id: the next send is then a new request.
const release = (draft) => { delete draft.requestId; delete draft.sentSnapshots; return draft; };

// What the Mac's answer does to the draft: recorded (or already recorded) clears it; refused keeps the answers and frees
// the next send.
export function settle(draft, item) {
  if (!draft || !item || draft.requestId !== item.id) return null;
  if (item.status === "applied") return { draft: null, status: `Recorded. ${item.message || ""}`.trim(), error: "" };
  if (item.status === "duplicate") return { draft: null, status: "Already recorded on the Mac", error: "" };
  if (item.status === "refused") {
    const d = release({ ...draft });
    return { draft: d, status: "", error: item.message || "The Mac refused it. Your answers are kept." };
  }
  return { draft, status: "Waiting for the Mac", error: "" };
}

// ---- the form ----
function radios(name, legend, options, checked) {
  return `<fieldset class="lab-obs__q" data-q="${esc(name)}"><legend>${esc(legend)}</legend><div class="lab-obs__opts">` +
    options.map(([v, l]) => `<label class="lab-obs__opt"><input type="radio" name="${esc(name)}" value="${esc(v)}"${checked === v ? " checked" : ""}><span>${esc(l)}</span></label>`).join("") +
    "</div></fieldset>";
}

function outcomeHtml(s, o, d) {
  const name = `${s.key}.${o}`, a = (d.answers || {})[name] || {};
  const note = a.status === "not_applicable" || a.status === "unknown" || a.value === "flawed" || a.value === "accepted_with_defects";
  return radios(name, LABEL[o], [...VALUES[o], ...MISSING], a.value || a.status) +
    `<div class="lab-sheet__field lab-obs__note"${note ? "" : " hidden"} data-note="${esc(name)}"><label for="obsNote-${esc(name)}">${a.status === "not_applicable" ? "Why it doesn't apply" : "What you see"}</label>` +
    `<input type="text" id="obsNote-${esc(name)}" maxlength="300" data-note-input="${esc(name)}" value="${esc(a.note || "")}"></div>`;
}

export function formHtml(x, d) {
  d = d || {};
  const parts = list(x.variants).map((v) => [v.id, `Plate position ${v.tab || v.id}`]);
  const ident = radios("identified", "How do you know which part this is?", [["confirmed", "I read its label or tab"], ["assumed", "By where it sat on the plate"], ["unidentified", "I can't tell"]], d.identified) +
    `<div class="lab-sheet__field lab-obs__note"${d.identified === "unidentified" ? "" : " hidden"} data-note="identified"><label for="obsIdentNote">What you know about it</label><input type="text" id="obsIdentNote" maxlength="300" data-note-input="identified" value="${esc(d.identNote || "")}"></div>`;
  const which = parts.length ? radios("variant", "Which part", parts, d.variant) : "";
  const label = `<div class="lab-sheet__field"><label for="obsLabel">Label you can read on the part (if any)</label><input type="text" id="obsLabel" maxlength="40" value="${esc(d.label || "")}"></div>`;
  const subjects = plan(x).map((s) => `<section class="lab-sheet__section lab-obs__subject" data-subject="${esc(s.key)}"><h3 class="lab-obs__title">${esc(s.title)}</h3>` +
    (s.side ? radios(`${s.key}.side`, "Which side", [["left", "Left"], ["right", "Right"], ["unknown", "Can't tell"]], (d.sides || {})[s.key]) : "") +
    s.outcomes.map((o) => outcomeHtml(s, o, d)).join("") + "</section>").join("");
  const light = radios("light", "Light you looked under", LIGHTS, d.light);
  const words = `<div class="lab-sheet__field"><label for="obsWords">In your own words (optional)</label><textarea id="obsWords" rows="2" maxlength="1000">${esc(d.words || "")}</textarea></div>`;
  return `<section class="lab-sheet__section" data-subject="identify"><h3 class="lab-obs__title">Identify the part</h3>${which}${ident}${label}</section>` +
    subjects + `<section class="lab-sheet__section" data-subject="conditions"><h3 class="lab-obs__title">How you looked</h3>${light}${words}</section>`;
}

export function observeSheetHtml() {
  return `<dialog id="labObserveSheet" class="lab-sheet lab-obs" aria-labelledby="labObserveTitle"><form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head"><h2 id="labObserveTitle" class="lab-sheet__title">Record what happened</h2><button type="button" id="labObserveClose" class="btn-outline">Close</button></div>
    <p class="meta lab-sheet__hint">Answer what you looked at. Nothing is chosen for you; "Not looked at" is a fine answer.</p>
    <div id="labObserveBody" class="lab-sheet__body"></div>
    <p id="labObserveMissing" class="meta lab-sheet__hint" hidden></p>
    <p id="labObserveStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labObserveError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions"><button type="button" id="labObserveSend" class="primary" disabled>Send to the Mac</button></div>
  </form></dialog>`;
}

// Wires the dialog (it lives in state.sheetsContainer, outside state.box). `deps.send(req)` posts it and starts the poller;
// `deps.watch(id)` only watches; `deps.makeId()`; `deps.expById(id)`; `deps.requests()` the page's known requests.
export function mountObserve(state, deps) {
  const sheet = state.sheetsContainer.querySelector("#labObserveSheet");
  if (!sheet) return;
  const q = (id) => sheet.querySelector("#" + id);
  let ctx = null;

  const status = (text, bad) => {
    const s = q("labObserveStatus"), e = q("labObserveError");
    if (bad) { s.hidden = true; s.textContent = ""; e.hidden = !text; e.textContent = text || ""; }
    else { e.hidden = true; e.textContent = ""; s.hidden = !text; s.textContent = text || ""; }
  };
  const save = () => saveDraft(state.currentProject, ctx.exp.id, ctx.draft);
  function refresh() {
    const m = missing(ctx.draft, ctx.exp), hint = q("labObserveMissing");
    q("labObserveSend").disabled = Boolean(m) || ctx.sending;
    q("labObserveBody").inert = ctx.sending;
    hint.hidden = !m;
    hint.innerHTML = m ? `Still to answer: <a href="#" data-goto="${esc(m[0])}">${esc(m[1])}</a>` : "";
  }
  function toggleNote(name, show, why) {
    const box = sheet.querySelector(`[data-note="${CSS.escape(name)}"]`);
    if (!box) return;
    box.hidden = !show;
    if (why !== undefined) { const l = box.querySelector("label"); if (l) l.textContent = why ? "Why it doesn't apply" : "What you see"; }
  }

  function onChange(e) {
    if (!ctx || ctx.sending) return;
    const t = e.target, d = ctx.draft;
    if (t.type === "radio") {
      const name = t.name;
      if (name === "variant") d.variant = t.value;
      else if (name === "identified") { d.identified = t.value; toggleNote("identified", t.value === "unidentified"); }
      else if (name === "light") d.light = t.value;
      else if (name.endsWith(".side")) d.sides = { ...(d.sides || {}), [name.split(".")[0]]: t.value };
      else {
        const o = name.split(".")[1], isValue = (VALUES[o] || []).some(([v]) => v === t.value), prev = (d.answers || {})[name] || {};
        d.answers = { ...(d.answers || {}), [name]: isValue ? { value: t.value, note: prev.note || "" } : { status: t.value, note: prev.note || "" } };
        toggleNote(name, ["not_applicable", "unknown", "flawed", "accepted_with_defects"].includes(t.value), t.value === "not_applicable");
      }
    } else if (t.dataset && t.dataset.noteInput) {
      const k = t.dataset.noteInput;
      if (k === "identified") d.identNote = t.value;
      else d.answers = { ...(d.answers || {}), [k]: { ...((d.answers || {})[k] || {}), note: t.value } };
    } else if (t.id === "obsLabel") d.label = t.value;
    else if (t.id === "obsWords") d.words = t.value;
    else return;
    save();
    refresh();
  }

  async function send() {
    if (!ctx || ctx.sending || missing(ctx.draft, ctx.exp)) return;
    const req = prepareSend(ctx.draft, ctx.exp, deps.makeId);
    save();
    ctx.sending = true; refresh(); status("Waiting for the Mac");
    try { await deps.send(req); }
    catch (err) {
      if (!ctx) return;
      ctx.sending = false; refresh();
      status((err && err.message) || "Couldn't reach the hub. Your answers are kept; send again when you're back online.", true);
    }
  }

  function open(id) {
    const exp = deps.expById(id);
    if (!exp) return;
    ctx = { exp, draft: loadDraft(state.currentProject, id), sending: false };
    q("labObserveTitle").textContent = `Record what happened · ${exp.id}`;
    q("labObserveBody").innerHTML = formHtml(exp, ctx.draft);
    status("");
    const known = ctx.draft.requestId && deps.requests().find((r) => r.id === ctx.draft.requestId);
    if (known) {
      const s = settle(ctx.draft, known);
      if (s) {
        if (s.draft) { ctx.draft = s.draft; save(); ctx.sending = known.status === "pending"; } else { clearDraft(state.currentProject, id); ctx.draft = {}; ctx.sending = false; }
        status(s.error || s.status, Boolean(s.error));
      }
      if (ctx.sending) deps.watch(ctx.draft.requestId);
    }
    refresh();
    if (!sheet.open) sheet.showModal();
  }

  // The poller's word on an observation request, whether or not the dialog is open.
  state.observeUpdate = (item) => {
    if (!item || item.kind !== "observation" || !item.experiment) return;
    const mine = ctx && ctx.exp.id === item.experiment;
    const draft = mine ? ctx.draft : loadDraft(state.currentProject, item.experiment);
    const s = settle(draft, item);
    if (!s) return;
    if (s.draft) saveDraft(state.currentProject, item.experiment, s.draft); else clearDraft(state.currentProject, item.experiment);
    if (!mine) return;
    ctx.draft = s.draft || {};
    ctx.sending = item.status === "pending" && !deps.stale(item);
    if (item.status === "pending" && deps.stale(item)) status(PICKUP); else status(s.error || s.status, Boolean(s.error));
    if (s.draft === null) q("labObserveBody").innerHTML = formHtml(ctx.exp, {});
    refresh();
  };
  state.openObserve = open;

  sheet.addEventListener("change", onChange);
  sheet.addEventListener("input", (e) => { if (e.target.matches('input[type="text"],textarea')) onChange(e); });
  sheet.addEventListener("click", (e) => {
    if (e.target.closest("#labObserveSend")) { e.preventDefault(); send(); return; }
    if (e.target.closest("#labObserveClose")) { e.preventDefault(); sheet.close(); return; }
    const g = e.target.closest("[data-goto]");
    if (g) {
      e.preventDefault();
      const input = sheet.querySelector(`[data-q="${CSS.escape(g.dataset.goto)}"] input`);
      if (input) { input.focus(); input.scrollIntoView({ block: "center" }); }
    }
  });
  sheet.addEventListener("close", () => { ctx = null; });
}
