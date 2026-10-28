// Pi Hub — Print Lab (Workshop › Print lab): 24/7 coupon inspection, test notebook and operator verdicts.
import { api, card, empty, h, toast } from "./core.js";

export const every = 15;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (x) => (x === null || x === undefined ? "–" : String(Math.round(Number(x) * 10) / 10));

const STATUS = {
  planned: ["Planned", "neutral"],
  built: ["Built", "neutral"],
  build_failed: ["Build failed", "bad"],
  ready: ["Ready to print", "accent"],
  needs_approval: ["Needs your approval", "attention"],
  approved: ["Approved", "accent"],
  printing: ["Printing", "attention"],
  answered: ["Answered", "good"],
  abandoned: ["Abandoned", "neutral"],
};

const OUTCOME = {
  supported: ["Prediction supported", "good"],
  refuted: ["Prediction refuted", "accent"],
  unresolved: ["Unresolved", "neutral"],
  inconclusive: ["Inconclusive", "neutral"],
};

const VALIDITY = {
  valid: ["Fair comparison", "good"],
  confounded: ["Confounded", "bad"],
  unknown: ["Can't tell if fair", "attention"],
};

const REASONS = {
  witness_abnormal: "the witness wall printed abnormally",
  witness_inconclusive: "the witness wall couldn't be judged",
  anchor_shifted: "the control reprint came out different",
  anchor_inconclusive: "the control reprint couldn't be judged",
  layer_time_mismatch: "the plates spent different time per layer",
  reference_not_printed: "the reference was never printed",
  reference_unmeasurable: "the reference plate can't be measured",
  cross_plate_no_anchor: "compared across plates with no control reprint",
  cross_plate_by_design: "separate plates are the factor being tested",
  production_mismatch: "this plate differs from how the tile will be printed",
};

const DONE = new Set(["answered", "abandoned"]);

function badgeTone(tone) {
  if (tone === "good") return "ok";
  if (tone === "attention") return "warn";
  if (tone === "bad") return "danger";
  return tone;
}

const badge = ([label, tone]) => `<span class="badge badge--${badgeTone(tone)}">${esc(label)}</span>`;
const value = (v) => (Array.isArray(v) ? [...new Set(v.map(String))].join("/") : typeof v === "number" ? n(v) : String(v ?? "").includes("/") ? String(v).split("/").pop() : String(v ?? ""));
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return !isFinite(m) ? "" : m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function makeRequestId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return "rq-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function prepareJpeg(file) {
  let blob = file;
  try {
    const bmp = await createImageBitmap(file);
    let w = bmp.width, h = bmp.height;
    const max = 2400;
    if (w > max || h > max) {
      if (w > h) { h = Math.round((h * max) / w); w = max; }
      else { w = Math.round((w * max) / h); h = max; }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  } catch {}
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const sha = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  return { blob, sha };
}

function renderRequestsList(items) {
  if (!items || !items.length) return "";
  return items.slice(0, 5).map((r) => {
    const tone = r.status === "applied" ? "ok" : r.status === "refused" ? "danger" : "warn";
    const title = r.kind ? r.kind[0].toUpperCase() + r.kind.slice(1) : "Request";
    return `<div class="lab-request"><span class="badge badge--${tone}">${esc(title)} · ${esc(r.status)}</span>${r.message ? ` <span class="meta">${esc(r.message)}</span>` : ""}</div>`;
  }).join("");
}

function photoUrl(project, p) {
  return `/api/lab/${encodeURIComponent(project)}/photo/${esc(p.sha256)}.jpg`;
}

function meter(label, spent, next, total, unit) {
  total = Number(total) || 1;
  const a = Math.min(100, (100 * (spent || 0)) / total);
  const b = Math.min(100 - a, (100 * (next || 0)) / total);
  const over = (spent || 0) + (next || 0) > total + 1e-9;
  return `<div class="lab-meter${over ? " lab-meter--over" : ""}"><div class="lab-meter__head"><span>${esc(label)}</span><span>${n(spent)} / ${n(total)} ${unit}</span></div>` +
    `<div class="lab-meter__track" role="img" aria-label="${n(spent)} of ${n(total)} ${unit} used${next ? `, the next test adds ${n(next)}` : ""}"><span class="lab-meter__spent" style="width:${a.toFixed(1)}%"></span><span class="lab-meter__next" style="width:${b.toFixed(1)}%"></span></div></div>`;
}

function needsHtml(ix, byId) {
  if (!ix.needs || !ix.needs.length) return '<p class="meta">Nothing needs you right now.</p>';
  return `<ul class="list-group lab-needs">${ix.needs.map((x) => `<li class="list-row"><div class="list-row__main"><div class="list-row__title"><a href="#lab-${esc(x.id)}" data-lab-open="${esc(x.id)}">${esc(x.action)} · ${esc(x.id)}</a></div>` +
    `<div class="list-row__sub">${esc(byId[x.id]?.question_text || "")}</div><div class="list-row__sub">${esc(x.why || "")}</div>` +
    `<div class="lab-cmd"><code>${esc(x.command)}</code><button type="button" class="btn-outline lab-copy" data-copy="${esc(x.command)}" aria-label="Copy the command for ${esc(x.id)}">Copy</button></div></div></li>`).join("")}</ul>`;
}

function questionHtml(q, byId) {
  const exps = (q.experiment_ids || []).map((id) => byId[id]).filter(Boolean);
  const m = q.budget ? [
    meter("Coupons", q.budget.coupons_spent, q.budget.coupons_next, q.budget.coupons_total, "coupons"),
    meter("Material", q.budget.g_spent, q.budget.g_next, q.budget.g_total, "g"),
    meter("Time", q.budget.minutes_spent, q.budget.minutes_next, q.budget.minutes_total, "min"),
  ].join("") : "";
  const stop = q.stop ? `<div class="lab-stop${q.stop.may_continue ? "" : " lab-stop--bad"}">${esc(q.stop.reason || "")}</div>` : "";
  const now = q.now_testing ? `<div class="lab-now"><span class="meta">Now testing</span><p class="lab-now__q">${esc(q.now_testing.hypothesis || "")}</p><a href="#lab-${esc(q.now_testing.experiment_id)}" data-lab-open="${esc(q.now_testing.experiment_id)}">Open ${esc(q.now_testing.experiment_id)}</a></div>` : "";
  return `<section class="card lab-question"><h2>${esc(q.title || "Question")}</h2><p class="meta">${esc(q.why || "")}</p>${m}${stop}${now}</section>`;
}

function experimentHtml(x, project, requests) {
  const b = [];
  if (STATUS[x.status]) b.push(badge(STATUS[x.status]));
  if (x.outcome && OUTCOME[x.outcome]) b.push(badge(OUTCOME[x.outcome]));
  if (x.validity && VALIDITY[x.validity.status]) b.push(badge(VALIDITY[x.validity.status]));

  const meta = [x.plan, x.build, x.run].filter(Boolean).join(" · ");
  const vars = (x.variants || []).map((v) => {
    const u = v.unit ? ` ${v.unit}` : "";
    const name = v.tab || v.id;
    return `<li>${esc(name)}: ${v.realized != null && v.as_asked === false ? `${esc(value(v.requested))} asked, ${n(v.realized)} printed${esc(u)}` : `${esc(v.realized != null ? n(v.realized) : value(v.requested))}${esc(u)}`}</li>`;
  }).join("");

  const cost = [
    x.estimate && `estimated ${n(x.estimate.minutes)} min, ${n(x.estimate.g)} g`,
    x.usage && `used ${n(x.usage.minutes)} min, ${n(x.usage.g)} g`,
    x.layer_time_median_s && `${n(x.layer_time_median_s)} s per layer`,
  ].filter(Boolean).join(", ");

  const why = x.outcome && x.validity ? (x.validity.reasons || []).map((r) => REASONS[r.code] || r.code).join("; ") : "";
  const v = x.verdict;
  const said = v && (v.note || (v.kind === "acceptance" ? (v.good_enough ? "good enough" : "not good enough") : v.kind));
  const shots = (x.photos || []).filter((p) => p.sha256).map((p, i) => `<a href="${photoUrl(project, p)}" target="_blank" rel="noopener"${i ? "" : ' class="lab-shots__first"'}><img src="${photoUrl(project, p)}" alt="${esc(x.id)} print ${esc(p.run || "")}" loading="lazy"></a>`).join("");
  const guards = ((x.check || {}).guards || []).filter((g) => !g.ok).map((g) => `<li class="lab-guard--${g.result === "blocked" ? "bad" : "attention"}">${esc(g.message)}</li>`).join("");
  const dl = [
    ["Hypothesis", x.hypothesis],
    ["Prediction", x.prediction],
    ["Why this test", x.why_this_test],
    ["Judge on", x.judge_on],
    ["Abandoned because", x.abandoned_reason],
    ["Filament", x.filament],
  ].filter((r) => r[1]).map(([k, t]) => `<dt>${esc(k)}</dt><dd>${esc(t)}</dd>`).join("");

  let actions = "";
  if (x.status === "printing" && !x.verdict) {
    const hint = '<p class="meta lab-light-hint">Raking light from one side, same distance, tab in frame.</p>';
    const addBtn = `<button type="button" class="btn-outline lab-add-photos" data-exp="${esc(x.id)}">Add photos</button><input type="file" accept="image/*" multiple class="visually-hidden" aria-label="Add photos for ${esc(x.id)}" data-exp="${esc(x.id)}">`;
    const verdictBtn = x.criteria && x.criteria.length ? `<button type="button" class="btn-outline lab-record-verdict" data-exp="${esc(x.id)}">Record verdict</button>` : "";
    const expReqs = (requests || []).filter((r) => r.experiment === x.id);
    const reqsHtml = `<div class="lab-requests" id="lab-requests-${esc(x.id)}" aria-live="polite">${renderRequestsList(expReqs)}</div>`;
    actions = `${hint}<div class="lab-actions">${addBtn}${verdictBtn}</div>${reqsHtml}`;
  }

  return `<article class="card lab-exp" id="lab-${esc(x.id)}"><header class="lab-exp__head"><span class="lab-exp__id">${esc(x.id)}</span>${b.join("")}</header><h3>${esc(x.question_text || "")}</h3><p class="meta">${esc(meta)}</p>` +
    (vars ? `<ul class="lab-variants">${vars}</ul>` : "") +
    (cost ? `<p class="meta">${esc(cost)}</p>` : "") +
    (why ? `<p class="meta">Why: ${esc(why)}</p>` : "") +
    (said ? `<p class="lab-verdict">Your verdict: ${esc(said)} <span class="meta">${esc(when(v.at))}</span></p>` : "") +
    actions +
    (shots ? `<div class="lab-shots">${shots}</div>` : "") +
    `<details class="lab-details" data-lab-details="${esc(x.id)}"><summary>Details</summary><dl>${dl}</dl>${guards ? `<h4>Last check (${esc(String(x.check.status || "").replace(/_/g, " "))})</h4><ul class="lab-guards">${guards}</ul>` : ""}</details></article>`;
}

function renderNotebook(data, requests) {
  const ix = data.index, meta = data.meta || {}, byId = Object.fromEntries((ix.experiments || []).map((x) => [x.id, x]));
  const open = (ix.questions || []).filter((q) => !["answered", "stopped"].includes(q.status));
  const active = (ix.experiments || []).filter((x) => !DONE.has(x.status));
  const earlier = (ix.experiments || []).filter((x) => DONE.has(x.status));
  const stale = meta.synced_at && Date.now() - new Date(meta.synced_at) > 2 * 3600e3;

  return `<p class="meta lab-synced${stale ? " lab-synced--stale" : ""}">Synced from the Mac ${esc(ago(meta.synced_at))}${stale ? ". The Mac may be asleep." : ""}</p>` +
    (ix.problems && ix.problems.length ? `<div class="lab-problems" role="alert"><strong>Records the Mac can't read</strong><ul>${ix.problems.map((p) => `<li><b>${esc(p.file)}</b> ${esc(p.error)}</li>`).join("")}</ul></div>` : "") +
    `<div class="lab-layout"><div class="lab-side"><section class="card lab-needs-card"><h2>Needs you</h2>${needsHtml(ix, byId)}</section>` +
    (open.map((q) => questionHtml(q, byId)).join("") || '<section class="card"><div class="empty-state"><div class="empty-state__title">No open question.</div><div>Start one on the Mac with lab question new.</div></div></section>') +
    `</div><div class="lab-notebook"><h2>Notebook</h2>${active.map((x) => experimentHtml(x, ix.project, requests)).join("") || '<p class="meta">No open experiments.</p>'}` +
    (earlier.length ? `<details class="lab-earlier"><summary>Earlier (${earlier.length})</summary>${earlier.map((x) => experimentHtml(x, ix.project, requests)).join("")}</details>` : "") +
    "</div></div>";
}

function sheetsHtml() {
  return `
<dialog id="labVerdictSheet" class="lab-sheet" aria-labelledby="labVerdictTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labVerdictTitle" class="lab-sheet__title">Record verdict</h2>
      <button type="button" id="labVerdictCancel" class="btn-outline" aria-label="Cancel verdict">Cancel</button>
    </div>
    <div id="labVerdictBody" class="lab-sheet__body"></div>
    <div class="lab-sheet__section">
      <label class="lab-checkbox-label">
        <input type="checkbox" id="labVerdictInconclusiveToggle">
        <span>Print failed or can't tell</span>
      </label>
      <div id="labVerdictInconclusiveBox" class="lab-sheet__field" hidden>
        <label for="labVerdictInconclusiveReason">Reason</label>
        <input type="text" id="labVerdictInconclusiveReason" placeholder="e.g. bed adhesion failure">
      </div>
    </div>
    <div class="lab-sheet__section">
      <div class="lab-sheet__field">
        <label for="labVerdictLighting">Light used</label>
        <select id="labVerdictLighting">
          <option value="diagnostic" selected>Diagnostic (raking light from one side)</option>
          <option value="room">Room light</option>
          <option value="installed">Installed (where the tile will live)</option>
        </select>
      </div>
      <div class="lab-sheet__field">
        <label for="labVerdictNote">Note</label>
        <input type="text" id="labVerdictNote" placeholder="What you see">
      </div>
    </div>
    <p id="labVerdictStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labVerdictError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labVerdictReplace" class="btn-outline" hidden>Replace verdict</button>
      <button type="button" id="labVerdictSend" class="primary" disabled>Send to the Mac</button>
    </div>
  </form>
</dialog>
<dialog id="labPhotosSheet" class="lab-sheet" aria-labelledby="labPhotosTitle">
  <form method="dialog" class="lab-sheet__form">
    <div class="lab-sheet__head">
      <h2 id="labPhotosTitle" class="lab-sheet__title">Add photos</h2>
      <button type="button" id="labPhotosCancel" class="btn-outline" aria-label="Cancel photos">Cancel</button>
    </div>
    <p class="meta lab-sheet__hint">Choose which tab each photo shows:</p>
    <div id="labPhotosList" class="lab-sheet__body"></div>
    <p id="labPhotosStatus" class="lab-sheet__status" role="status" aria-live="polite" hidden></p>
    <p id="labPhotosError" class="lab-sheet__error" role="alert" hidden></p>
    <div class="lab-sheet__actions">
      <button type="button" id="labPhotosSend" class="primary">Send photos</button>
    </div>
  </form>
</dialog>`;
}

export function mount(state) {
  state.currentProject = "";
  state.currentData = null;
  state.currentRequests = [];
  state.currentExp = null;
  state.currentReqId = null;
  state.pollTimer = null;
  state.selectedPhotoFiles = [];
  state.selectedPhotoTabs = [];
  state.currentPhotosExp = null;

  state.box = h("div", { class: "lab-body", id: "labBody", "aria-live": "polite" });
  state.sheetsContainer = h("div", { id: "labSheets" });
  state.sheetsContainer.innerHTML = sheetsHtml();

  state.root.append(state.box, state.sheetsContainer);

  const verdictSheet = state.sheetsContainer.querySelector("#labVerdictSheet");
  const photosSheet = state.sheetsContainer.querySelector("#labPhotosSheet");

  state.openExperiment = (id) => {
    const cardEl = state.box.querySelector(`#lab-${id}`);
    if (!cardEl) return;
    const earlier = cardEl.closest(".lab-earlier");
    if (earlier) earlier.open = true;
    const d = cardEl.querySelector(".lab-details");
    if (d) d.open = true;
    cardEl.scrollIntoView({ block: "start" });
    cardEl.setAttribute("tabindex", "-1");
    cardEl.focus({ preventScroll: true });
  };

  function validateVerdict() {
    const sendBtn = state.sheetsContainer.querySelector("#labVerdictSend");
    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (!sendBtn) return;
    if (incToggle && incToggle.checked) {
      state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row").forEach((r) => r.classList.remove("lab-row--missing"));
      sendBtn.disabled = !incReason?.value.trim();
      return;
    }
    let allComplete = true;
    const rows = state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row");
    rows.forEach((row) => {
      let rowComplete = true;
      for (const crit of state.currentExp?.criteria || []) {
        const checked = row.querySelector(`button[data-criterion="${crit.key}"][aria-checked="true"]`);
        if (!checked) { rowComplete = false; break; }
      }
      if (!rowComplete) {
        allComplete = false;
        row.classList.add("lab-row--missing");
      } else {
        row.classList.remove("lab-row--missing");
      }
    });
    sendBtn.disabled = !allComplete;
  }

  function saveVerdictDraft() {
    if (!state.currentExp) return;
    const draft = {
      grades: {},
      inconclusive: Boolean(state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle")?.checked),
      inconclusiveReason: state.sheetsContainer.querySelector("#labVerdictInconclusiveReason")?.value || "",
      lighting: state.sheetsContainer.querySelector("#labVerdictLighting")?.value || "diagnostic",
      note: state.sheetsContainer.querySelector("#labVerdictNote")?.value || "",
    };
    state.sheetsContainer.querySelectorAll("#labVerdictBody .lab-verdict-row").forEach((row) => {
      const tab = row.dataset.tab;
      draft.grades[tab] = {};
      row.querySelectorAll('button[aria-checked="true"]').forEach((btn) => {
        draft.grades[tab][btn.dataset.criterion] = btn.dataset.choice;
      });
    });
    try {
      localStorage.setItem("printLab:draft:" + state.currentExp.id, JSON.stringify(draft));
    } catch {}
  }

  state.openVerdictSheet = (exp) => {
    state.currentExp = exp;
    state.currentReqId = null;
    const body = state.sheetsContainer.querySelector("#labVerdictBody");
    const title = state.sheetsContainer.querySelector("#labVerdictTitle");
    if (!verdictSheet || !body) return;
    if (title) title.textContent = `Record verdict · ${exp.id}`;

    const tabs = (exp.variants || []).map((v) => v.tab || v.id).filter(Boolean);
    body.innerHTML = tabs.map((tab) => {
      const critRows = (exp.criteria || []).map((c) => `
        <div class="lab-verdict-criterion" role="radiogroup" aria-label="${esc(c.label)} for ${esc(tab)}">
          <span class="lab-verdict-criterion__label">${esc(c.label)}</span>
          <div class="lab-chips">
            ${(c.choices || []).map((ch) => `<button type="button" class="btn-outline lab-chip" role="radio" aria-checked="false" data-tab="${esc(tab)}" data-criterion="${esc(c.key)}" data-choice="${esc(ch)}">${esc(ch)}</button>`).join("")}
          </div>
        </div>
      `).join("");
      return `<div class="lab-verdict-row" data-tab="${esc(tab)}"><div class="lab-verdict-row__title">Strip ${esc(tab)}</div>${critRows}</div>`;
    }).join("");

    let draft = { grades: {}, inconclusive: false, inconclusiveReason: "", lighting: "diagnostic", note: "" };
    try {
      const saved = localStorage.getItem("printLab:draft:" + exp.id);
      if (saved) draft = Object.assign(draft, JSON.parse(saved));
    } catch {}

    for (const [tab, crits] of Object.entries(draft.grades || {})) {
      for (const [critKey, choice] of Object.entries(crits || {})) {
        const btn = body.querySelector(`button[data-tab="${tab}"][data-criterion="${critKey}"][data-choice="${choice}"]`);
        if (btn) btn.setAttribute("aria-checked", "true");
      }
    }

    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incBox = state.sheetsContainer.querySelector("#labVerdictInconclusiveBox");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (incToggle) incToggle.checked = Boolean(draft.inconclusive);
    if (incBox) incBox.hidden = !draft.inconclusive;
    if (incReason) incReason.value = draft.inconclusiveReason || "";

    const lightingSelect = state.sheetsContainer.querySelector("#labVerdictLighting");
    if (lightingSelect) lightingSelect.value = draft.lighting || "diagnostic";
    const noteInput = state.sheetsContainer.querySelector("#labVerdictNote");
    if (noteInput) noteInput.value = draft.note || "";

    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (replaceBtn) replaceBtn.hidden = true;

    validateVerdict();
    if (!verdictSheet.open) verdictSheet.showModal();
  };

  function addOrUpdateCardRequest(item) {
    if (!item || !item.experiment) return;
    const idx = state.currentRequests.findIndex((r) => r.id === item.id);
    if (idx >= 0) state.currentRequests[idx] = Object.assign({}, state.currentRequests[idx], item);
    else state.currentRequests.unshift(item);
    const el = state.box.querySelector("#lab-requests-" + item.experiment);
    if (el) {
      const expReqs = state.currentRequests.filter((r) => r.experiment === item.experiment);
      el.innerHTML = renderRequestsList(expReqs);
    }
  }

  function pollVerdictResult(project, reqId, expId) {
    if (state.pollTimer) clearInterval(state.pollTimer);
    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    const startedAt = Date.now();

    const check = async () => {
      try {
        const res = await fetch(`/api/lab/${encodeURIComponent(project)}/requests`);
        if (!res.ok) return;
        const data = await res.json();
        const item = (data.items || []).find((i) => i.id === reqId);
        if (!item) return;

        addOrUpdateCardRequest(item);

        if (item.status === "applied") {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Recorded"; }
          if (errorEl) errorEl.hidden = true;
          try { localStorage.removeItem("printLab:draft:" + expId); } catch {}
          return;
        }

        if (item.status === "refused") {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          if (statusEl) statusEl.hidden = true;
          if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = item.message || "Verdict refused by the Mac";
          }
          if (item.message && item.message.includes("already has a verdict")) {
            if (replaceBtn) replaceBtn.hidden = false;
          }
          return;
        }

        if (Date.now() - startedAt > 120000) {
          if (statusEl) statusEl.textContent = "The Mac hasn't picked this up. It runs when the Mac is awake.";
        }
      } catch {}
    };

    state.pollTimer = setInterval(check, 500);
    check();
  }

  async function sendVerdict(isReplace = false) {
    if (!state.currentExp) return;
    const statusEl = state.sheetsContainer.querySelector("#labVerdictStatus");
    const errorEl = state.sheetsContainer.querySelector("#labVerdictError");
    const replaceBtn = state.sheetsContainer.querySelector("#labVerdictReplace");
    const sendBtn = state.sheetsContainer.querySelector("#labVerdictSend");

    let draft = {};
    try { draft = JSON.parse(localStorage.getItem("printLab:draft:" + state.currentExp.id) || "{}"); } catch {}

    const reqId = isReplace ? makeRequestId() : (state.currentReqId || makeRequestId());
    state.currentReqId = reqId;

    if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Waiting for the Mac"; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (replaceBtn) replaceBtn.hidden = true;
    if (sendBtn) sendBtn.disabled = true;

    const payload = {
      grades: draft.grades || {},
      lighting: draft.lighting || "diagnostic",
      note: draft.note || null,
      inconclusive: draft.inconclusive ? (draft.inconclusiveReason || "unspecified") : null,
      replace: Boolean(isReplace),
    };

    try {
      const res = await fetch(`/api/lab/${encodeURIComponent(state.currentProject)}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reqId,
          kind: "verdict",
          experiment: state.currentExp.id,
          run: state.currentExp.run || null,
          payload,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (statusEl) statusEl.hidden = true;
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = data.detail || data.error || "Failed to send request"; }
        if (sendBtn) sendBtn.disabled = false;
        return;
      }

      addOrUpdateCardRequest({ id: reqId, kind: "verdict", experiment: state.currentExp.id, status: "pending" });
      pollVerdictResult(state.currentProject, reqId, state.currentExp.id);
    } catch (err) {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message || "Network error"; }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  state.openPhotosSheet = (exp, files) => {
    state.currentPhotosExp = exp;
    state.selectedPhotoFiles = files;
    state.selectedPhotoTabs = new Array(files.length).fill(null);
    const list = state.sheetsContainer.querySelector("#labPhotosList");
    const title = state.sheetsContainer.querySelector("#labPhotosTitle");
    const statusEl = state.sheetsContainer.querySelector("#labPhotosStatus");
    const errorEl = state.sheetsContainer.querySelector("#labPhotosError");
    const sendBtn = state.sheetsContainer.querySelector("#labPhotosSend");
    if (!photosSheet || !list) return;

    if (title) title.textContent = `Add photos · ${exp.id}`;
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
    if (sendBtn) sendBtn.disabled = false;

    const tabs = (exp.variants || []).map((v) => v.tab || v.id).filter(Boolean);
    list.innerHTML = files.map((file, idx) => {
      const previewUrl = URL.createObjectURL(file);
      const tabChips = tabs.map((t) => `<button type="button" class="btn-outline lab-chip" data-tab="${esc(t)}" aria-checked="false">${esc(t)}</button>`).join("");
      return `<div class="lab-photo-row" data-photo-idx="${idx}"><img class="lab-photo-thumb" src="${previewUrl}" alt="Photo ${idx + 1}"><div class="lab-photo-tabs" role="group" aria-label="Select tab for photo ${idx + 1}">${tabChips}</div></div>`;
    }).join("");

    if (!photosSheet.open) photosSheet.showModal();
  };

  async function sendPhotos() {
    if (!state.currentPhotosExp || !state.selectedPhotoFiles.length) return;
    const sendBtn = state.sheetsContainer.querySelector("#labPhotosSend");
    const statusEl = state.sheetsContainer.querySelector("#labPhotosStatus");
    const errorEl = state.sheetsContainer.querySelector("#labPhotosError");

    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Uploading photos…"; }
    if (errorEl) errorEl.hidden = true;

    try {
      const uploaded = [];
      for (let i = 0; i < state.selectedPhotoFiles.length; i++) {
        const file = state.selectedPhotoFiles[i];
        const tab = state.selectedPhotoTabs[i] || null;
        const { blob, sha } = await prepareJpeg(file);
        const putRes = await fetch(`/api/lab/${encodeURIComponent(state.currentProject)}/incoming/${sha}.jpg`, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!putRes.ok) {
          const d = await putRes.json().catch(() => ({}));
          throw new Error(d.detail || d.error || "Failed to upload photo");
        }
        uploaded.push({ sha256: sha, tab });
      }

      const reqId = makeRequestId();
      const postRes = await fetch(`/api/lab/${encodeURIComponent(state.currentProject)}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reqId,
          kind: "photos",
          experiment: state.currentPhotosExp.id,
          run: state.currentPhotosExp.run || null,
          payload: {
            run: state.currentPhotosExp.run || null,
            photos: uploaded,
          },
        }),
      });

      if (!postRes.ok) throw new Error("Failed to create photos request");

      addOrUpdateCardRequest({ id: reqId, kind: "photos", experiment: state.currentPhotosExp.id, status: "pending" });
      if (photosSheet.open) photosSheet.close();
      toast("Photos uploaded. The Mac will verify them.");
    } catch (err) {
      if (statusEl) statusEl.hidden = true;
      if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message || "Failed to upload photos"; }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // Click handler on state.box
  state.box.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const t = c.dataset.copy;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(t).then(() => toast("Copied command.")).catch(() => {});
      } else {
        const code = c.previousElementSibling;
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      return;
    }
    const o = e.target.closest("[data-lab-open]");
    if (o) {
      e.preventDefault();
      history.replaceState(history.state, "", `/lab?e=${encodeURIComponent(o.dataset.labOpen)}`);
      state.openExperiment(o.dataset.labOpen);
      return;
    }
    const addBtn = e.target.closest(".lab-add-photos");
    if (addBtn) {
      const expId = addBtn.dataset.exp;
      const input = state.box.querySelector(`input[type="file"][data-exp="${expId}"]`);
      if (input) input.click();
      return;
    }
    const recBtn = e.target.closest(".lab-record-verdict");
    if (recBtn) {
      const expId = recBtn.dataset.exp;
      const exp = state.currentData?.index?.experiments?.find((x) => x.id === expId);
      if (exp) state.openVerdictSheet(exp);
      return;
    }
  });

  state.box.addEventListener("change", (e) => {
    const fileInput = e.target.closest("input[type=\"file\"][data-exp]");
    if (fileInput && fileInput.files && fileInput.files.length) {
      const expId = fileInput.dataset.exp;
      const exp = state.currentData?.index?.experiments?.find((x) => x.id === expId);
      if (exp) state.openPhotosSheet(exp, Array.from(fileInput.files));
      fileInput.value = "";
    }
  });

  // Sheet handlers
  if (verdictSheet) {
    verdictSheet.addEventListener("click", (e) => {
      const chip = e.target.closest("#labVerdictBody button[data-choice]");
      if (chip) {
        const wrap = chip.closest(".lab-chips");
        if (wrap) wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === chip ? "true" : "false"));
        saveVerdictDraft();
        validateVerdict();
        return;
      }
      if (e.target.closest("#labVerdictCancel")) {
        verdictSheet.close();
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        return;
      }
      if (e.target.closest("#labVerdictSend")) {
        sendVerdict(false);
        return;
      }
      if (e.target.closest("#labVerdictReplace")) {
        sendVerdict(true);
        return;
      }
    });

    const incToggle = state.sheetsContainer.querySelector("#labVerdictInconclusiveToggle");
    const incBox = state.sheetsContainer.querySelector("#labVerdictInconclusiveBox");
    const incReason = state.sheetsContainer.querySelector("#labVerdictInconclusiveReason");
    if (incToggle) {
      incToggle.addEventListener("change", () => {
        if (incBox) incBox.hidden = !incToggle.checked;
        saveVerdictDraft();
        validateVerdict();
      });
    }
    if (incReason) {
      incReason.addEventListener("input", () => {
        saveVerdictDraft();
        validateVerdict();
      });
    }
    const lightingSelect = state.sheetsContainer.querySelector("#labVerdictLighting");
    if (lightingSelect) lightingSelect.addEventListener("change", saveVerdictDraft);
    const noteInput = state.sheetsContainer.querySelector("#labVerdictNote");
    if (noteInput) noteInput.addEventListener("input", saveVerdictDraft);
  }

  if (photosSheet) {
    photosSheet.addEventListener("click", (e) => {
      const tabBtn = e.target.closest(".lab-photo-row button[data-tab]");
      if (tabBtn) {
        const row = tabBtn.closest(".lab-photo-row");
        const idx = Number(row.dataset.photoIdx);
        state.selectedPhotoTabs[idx] = tabBtn.dataset.tab;
        row.querySelectorAll("button[data-tab]").forEach((b) => b.setAttribute("aria-checked", b === tabBtn ? "true" : "false"));
        return;
      }
      if (e.target.closest("#labPhotosCancel")) {
        photosSheet.close();
        return;
      }
      if (e.target.closest("#labPhotosSend")) {
        sendPhotos();
        return;
      }
    });
  }
}

export async function load(state) {
  const { projects } = await api("/api/lab/projects");
  if (!projects || !projects.length) {
    state.box.replaceChildren(card("Print lab", { cls: "wide" }, empty("No lab data yet. Run lab sync on the Mac.")));
    return;
  }

  const pName = projects[0].name;
  state.currentProject = pName;

  const [labData, reqData] = await Promise.all([
    api(`/api/lab/${encodeURIComponent(pName)}`),
    fetch(`/api/lab/${encodeURIComponent(pName)}/requests`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
  ]);

  state.currentRequests = (reqData && reqData.items) || [];
  state.currentData = labData;

  state.box.innerHTML = renderNotebook(labData, state.currentRequests);

  const e = state.context.get("e") || (location.hash.startsWith("#lab-") ? location.hash.slice(5) : null);
  if (e) {
    state.openExperiment(e);
    if (state.context.get("do") === "judge") {
      const exp = labData?.index?.experiments?.find((x) => x.id === e);
      if (exp) state.openVerdictSheet(exp);
    }
  }
}

export function leave(state) {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  const vs = state.sheetsContainer?.querySelector("#labVerdictSheet");
  if (vs && vs.open) vs.close();
  const ps = state.sheetsContainer?.querySelector("#labPhotosSheet");
  if (ps && ps.open) ps.close();
}
