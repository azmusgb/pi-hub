// Print Lab v2 — additive run / qualification / production presentation.
// The existing notebook stays authoritative; this module decorates it with the
// engineering state that became first-class after Run records and qualification.
import { labFetch, watchRequests } from "./lab-net.js";

const list = (v) => (Array.isArray(v) ? v : []);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const qualificationStatus = new Map();

const RUN_TONE = {
  planned: "neutral",
  printing: "warn",
  completed: "ok",
  qualified: "ok",
  failed: "danger",
  aborted: "danger",
};

const fmt = (n) => n === null || n === undefined || n === "" ? "—" : String(Math.round(Number(n) * 10) / 10);
const duration = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return "";
  const h = Math.floor(m / 60), rest = Math.round(m % 60);
  return h ? `${h}h ${rest}m` : `${rest}m`;
};
const when = (iso) => {
  const d = new Date(iso);
  return !iso || Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
};

function canonicalRuns(exp, ix) {
  const found = list(ix && ix.runs).filter((r) => r && r.experiment === exp.id);
  if (found.length) return [...found].sort((a, b) => String(b.id).localeCompare(String(a.id)));
  // Migration fallback: existing experiment projection exposes PR-* runs.
  const legacy = list(exp && exp.runs);
  return legacy.map((r, i) => {
    const p = r && r.print;
    const word = String(p && p.status_word || "").toLowerCase();
    const isLatest = i === legacy.length - 1;
    const inherited = isLatest && exp.status === "printing" ? "printing"
      : exp.status === "answered" ? "completed"
      : exp.status === "abandoned" ? "aborted"
      : "planned";
    const status = word.includes("fail") ? "failed"
      : word.includes("print") ? "printing"
      : p ? "completed"
      : inherited;
    return {
      id: r.id || `PR-${exp.id.replace(/^E-/, "")}-${String(i + 1).padStart(2, "0")}`,
      experiment: exp.id,
      build: r.build_id || null,
      status,
      started_at: r.started_at,
      printer: null,
      estimate: isLatest ? (exp.estimate || {}) : {},
      actual: p ? { minutes: p.minutes, g: p.grams } : {},
      artifacts: null,
      legacy: true,
    };
  }).sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

export function productionState(ix) {
  const q = ix && ix.qualification || {};
  const p = ix && ix.production || {};
  const rawPackage = q.current_package;
  const packageId = typeof rawPackage === "string"
    ? rawPackage
    : rawPackage && typeof rawPackage === "object"
      ? (rawPackage.id || rawPackage.path || null)
      : null;
  const current = p.current || (rawPackage && typeof rawPackage === "object" ? { ...rawPackage, sealed: true } : null);
  return {
    experiment: q.current_reference || (current && current.experiment) || null,
    run: q.current_run || (current && current.run) || null,
    package: packageId || (current && (current.id || current.path)) || null,
    current,
  };
}

export function referenceCardHtml(ix) {
  const ref = productionState(ix);
  if (!ref.experiment && !ref.package) {
    return `<section class="card lab-v2-reference lab-v2-reference--empty">
      <div class="lab-v2-kicker">Production</div>
      <h2>Reference not set in Qualification</h2>
      <p class="meta">Experiments can continue normally. A qualified Run will become the explicit production reference here.</p>
    </section>`;
  }
  const sealed = Boolean(ref.current && ref.current.sealed);
  const artifactCount = ref.current && ref.current.artifact_count;
  return `<section class="card lab-v2-reference">
    <div class="lab-v2-reference__head">
      <div><div class="lab-v2-kicker">Current production reference</div>
        <h2>${esc(ref.experiment || "Qualified package")}${ref.run ? ` · ${esc(ref.run)}` : ""}</h2></div>
      <span class="badge badge--${sealed ? "ok" : "neutral"}">${sealed ? "Sealed" : "Qualified"}</span>
    </div>
    ${ref.package ? `<p class="lab-v2-package">${esc(ref.package)}</p>` : ""}
    <div class="lab-v2-reference__facts">
      ${artifactCount != null ? `<span>${esc(artifactCount)} packaged artifact${artifactCount === 1 ? "" : "s"}</span>` : ""}
      ${ref.current && ref.current.sealed_at ? `<span>sealed ${esc(when(ref.current.sealed_at))}</span>` : ""}
      ${ref.current && ref.current.previous_reference ? `<span>replaced ${esc(ref.current.previous_reference)}</span>` : ""}
    </div>
  </section>`;
}

function runMetrics(run) {
  const est = run.estimate || {}, actual = run.actual || {};
  const time = actual.minutes != null ? `${duration(actual.minutes)} actual` : est.minutes != null ? `${duration(est.minutes)} est.` : "";
  const grams = actual.g != null ? `${fmt(actual.g)} g actual` : est.g != null ? `${fmt(est.g)} g est.` : "";
  const layers = est.layers != null ? `${fmt(est.layers)} layers` : "";
  return [time, grams, layers].filter(Boolean);
}

function artifactLine(run, qualified) {
  const a = run.artifacts;
  if (!a) return `<span class="lab-v2-artifacts lab-v2-artifacts--legacy">Legacy run · artifact identity not migrated</span>`;
  if (qualified) return `<span class="lab-v2-artifacts lab-v2-artifacts--ok">✓ Sealed artifact identity</span>`;
  if (a.ready) return `<span class="lab-v2-artifacts lab-v2-artifacts--ok">✓ ${esc(a.bound)}/${esc(a.required)} artifacts bound</span>`;
  const problems = [...list(a.missing), ...list(a.files_missing)];
  return `<span class="lab-v2-artifacts lab-v2-artifacts--bad">⚠ Artifact identity incomplete${problems.length ? ` · ${esc(problems.join(", "))}` : ""}</span>`;
}

export function runCardHtml(run, ix) {
  const prod = productionState(ix);
  const qualified = run.id === prod.run || run.status === "qualified";
  const tone = qualified ? "ok" : (RUN_TONE[run.status] || "neutral");
  const status = qualified ? "Qualified" : String(run.status || "run").replace(/_/g, " ");
  const metrics = runMetrics(run);
  return `<section class="lab-v2-run${qualified ? " lab-v2-run--qualified" : ""}" data-run="${esc(run.id)}">
    <div class="lab-v2-run__head">
      <div><div class="lab-v2-kicker">Physical run</div><strong>${esc(run.id)}</strong></div>
      <span class="badge badge--${esc(tone)}">${esc(status)}</span>
    </div>
    <div class="lab-v2-run__facts">
      ${run.printer ? `<span>${esc(run.printer)}</span>` : ""}
      ${run.started_at ? `<span>started ${esc(when(run.started_at))}</span>` : ""}
      ${run.finished_at ? `<span>finished ${esc(when(run.finished_at))}</span>` : ""}
    </div>
    ${metrics.length ? `<p class="lab-v2-run__metrics">${metrics.map(esc).join(" · ")}</p>` : ""}
    <p class="lab-v2-run__identity">${artifactLine(run, qualified)}</p>
  </section>`;
}

function referenceIds(exp) {
  const ids = list(exp && exp.reference_variants).map((x) => {
    const m = String(x || "").match(/^(E-\d{3,})/);
    return m && m[1];
  }).filter(Boolean);
  return [...new Set(ids)];
}

function buildId(exp, run) {
  if (run && typeof run.build === "string") return run.build;
  const shown = exp && exp.shown_build;
  if (typeof shown === "string") return shown;
  if (shown && typeof shown.id === "string") return shown.id;
  const check = exp && exp.check;
  if (check && typeof check.build_id === "string") return check.build_id;
  if (check && check.build && typeof check.build.id === "string") return check.build.id;
  return null;
}

function makeRequestId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return "rq-" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function qualificationModel(exp, ix) {
  const run = canonicalRuns(exp, ix)[0] || null;
  const build = buildId(exp, run);
  const refs = referenceIds(exp);
  const firstClass = Boolean(run && String(run.id || "").startsWith("RUN-"));
  const artifactReady = Boolean(firstClass && run.artifacts && run.artifacts.ready);
  const eligible = exp && exp.status === "answered" && run && build && refs.length;
  return { run, build, refs, firstClass, artifactReady, eligible };
}

export function qualificationPanelHtml(exp, ix) {
  const q = qualificationModel(exp, ix);
  if (!q.eligible) return "";
  const status = qualificationStatus.get(exp.id) || {};
  const disabledQualify = !(q.firstClass && q.artifactReady);
  return `<section class="lab-v2-qual" data-qual-exp="${esc(exp.id)}">
    <div class="lab-v2-qual__head"><div><div class="lab-v2-kicker">Qualification</div><strong>Owner release decision</strong></div>
      <span class="badge badge--${q.artifactReady ? "ok" : "neutral"}">${q.artifactReady ? "Package ready" : q.firstClass ? "Artifacts incomplete" : "Legacy run"}</span></div>
    <p class="meta">Exact snapshot: ${esc(q.run.id)} · ${esc(q.build)}</p>
    ${!q.firstClass ? `<p class="meta lab-v2-qual__warning">Production qualification is locked until this print has a canonical RUN record. Continue/Reject remain available.</p>` : ""}
    ${q.firstClass && !q.artifactReady ? `<p class="meta lab-v2-qual__warning">Production qualification is locked until model, process, filament, and slice artifacts are bound.</p>` : ""}
    <label class="lab-v2-qual__field">Reference
      <select data-qual-reference>${q.refs.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join("")}</select>
    </label>
    <label class="lab-v2-qual__review"><input type="checkbox" data-qual-reviewed> I reviewed the evidence comparison for this exact Run.</label>
    <label class="lab-v2-qual__field">Reason
      <textarea rows="2" maxlength="500" data-qual-reason placeholder="Why should this run become production, continue testing, or be rejected?"></textarea>
    </label>
    <div class="lab-v2-qual__actions">
      <button type="button" class="btn-outline" data-qual-decision="continue">Continue testing</button>
      <button type="button" class="btn-outline" data-qual-decision="rejected">Reject</button>
      <button type="button" class="btn" data-qual-decision="qualified"${disabledQualify ? " disabled" : ""}>Qualify production</button>
    </div>
    <p class="lab-v2-qual__status" role="status" data-tone="${esc(status.tone || "")}"${status.text ? "" : " hidden"}>${esc(status.text || "")}</p>
  </section>`;
}

export function lifecycleModel(exp, ix) {
  const runs = canonicalRuns(exp, ix);
  const latest = runs[0] || null;
  const prod = productionState(ix);
  const hasBuild = Boolean(exp.shown_build || exp.check || !["planned", "build_failed"].includes(exp.status));
  const hasEvidence = list(exp.photos).length > 0 || list(exp.ai_observations).length > 0 || Boolean(exp.finding || exp.verdict);
  const hasVerdict = Boolean(exp.verdict);
  const qualified = prod.experiment === exp.id && (!prod.run || runs.some((r) => r.id === prod.run));
  const produced = qualified && Boolean(prod.package || prod.current);
  return [
    ["Plan", true, "done"],
    ["Build", hasBuild, hasBuild ? "done" : "todo"],
    ["Run", Boolean(latest), latest && latest.status === "printing" ? "active" : latest ? "done" : "todo"],
    ["Evidence", hasEvidence, hasEvidence ? "done" : "todo"],
    ["Verdict", hasVerdict, hasVerdict ? "done" : "todo"],
    ["Qualify", qualified, qualified ? "done" : "todo"],
    ["Production", produced, produced ? "done" : "todo"],
  ];
}

export function lifecycleHtml(exp, ix) {
  const steps = lifecycleModel(exp, ix);
  return `<div class="lab-v2-life" aria-label="Experiment lifecycle">${steps.map(([label, done, state]) =>
    `<span class="lab-v2-life__step lab-v2-life__step--${esc(state)}"><i aria-hidden="true"></i>${esc(label)}${done ? `<b class="sr"> complete</b>` : ""}</span>`
  ).join(`<span class="lab-v2-life__line" aria-hidden="true"></span>`)}</div>`;
}

export function experimentV2Html(exp, ix) {
  const runs = canonicalRuns(exp, ix);
  const showRail = ["full_part", "scaled_part"].includes(exp.test_kind) || runs.length || exp.status === "printing";
  if (!showRail) return "";
  return `<div class="lab-v2-exp">
    ${lifecycleHtml(exp, ix)}
    ${runs.map((r) => runCardHtml(r, ix)).join("")}
    ${qualificationPanelHtml(exp, ix)}
  </div>`;
}

function styles() {
  if (document.getElementById("lab-v2-styles")) return;
  const style = document.createElement("style");
  style.id = "lab-v2-styles";
  style.textContent = `
    .lab-v2-overview{display:grid;gap:12px;margin:0 0 16px}.lab-v2-reference{border-left:4px solid var(--ui-ok,#3ecf8e)}
    .lab-v2-reference--empty{border-left-color:var(--ui-muted,#93a1b3)}.lab-v2-reference__head,.lab-v2-run__head,.lab-v2-qual__head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .lab-v2-reference h2{margin:3px 0 0}.lab-v2-kicker{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--ui-muted,#93a1b3);font-weight:700}
    .lab-v2-package{font:12px/1.45 var(--ui-mono);overflow-wrap:anywhere;margin:10px 0 6px}.lab-v2-reference__facts,.lab-v2-run__facts{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--ui-muted,#93a1b3);font-size:12px}
    .lab-v2-exp{margin:10px 0 12px;padding:10px 0;border-top:1px solid var(--ui-line,#1f2a38);border-bottom:1px solid var(--ui-line,#1f2a38)}
    .lab-v2-run,.lab-v2-qual{margin-top:10px;padding:10px 12px;border:1px solid var(--ui-line,#1f2a38);border-radius:9px;background:color-mix(in srgb,var(--ui-surface-2,#1a2431) 75%,transparent)}
    .lab-v2-run--qualified{border-color:color-mix(in srgb,var(--ui-ok,#3ecf8e) 60%,var(--ui-line,#1f2a38));box-shadow:inset 3px 0 0 var(--ui-ok,#3ecf8e)}
    .lab-v2-run__metrics{margin:7px 0 4px;font-weight:650;font-variant-numeric:tabular-nums}.lab-v2-run__identity{margin:5px 0 0;font-size:12px}.lab-v2-artifacts--ok{color:var(--ui-ok,#3ecf8e)}.lab-v2-artifacts--bad{color:var(--ui-bad,#ff736c)}.lab-v2-artifacts--legacy{color:var(--ui-muted,#93a1b3)}
    .lab-v2-life{display:flex;align-items:center;overflow-x:auto;padding:2px 0 5px;scrollbar-width:thin}.lab-v2-life__step{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px;color:var(--ui-muted,#93a1b3)}
    .lab-v2-life__step i{width:9px;height:9px;border:1px solid currentColor;border-radius:50%;display:inline-block}.lab-v2-life__step--done{color:var(--ui-ok,#3ecf8e)}.lab-v2-life__step--done i{background:currentColor}.lab-v2-life__step--active{color:var(--ui-warn,#f5b03d);font-weight:700}.lab-v2-life__step--active i{background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 20%,transparent)}
    .lab-v2-life__line{height:1px;min-width:16px;flex:1;background:var(--ui-line,#1f2a38);margin:0 6px}.lab-v2-qual{border-left:3px solid var(--ui-accent,#6ca8ff)}.lab-v2-qual__warning{color:var(--ui-warn,#f5b03d)}
    .lab-v2-qual__field{display:grid;gap:5px;margin-top:9px;font-size:12px;font-weight:650}.lab-v2-qual__field select,.lab-v2-qual__field textarea{width:100%;box-sizing:border-box}.lab-v2-qual__review{display:flex;align-items:flex-start;gap:8px;margin-top:10px;font-size:12px}.lab-v2-qual__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.lab-v2-qual__status{margin:8px 0 0;font-size:12px}.lab-v2-qual__status[data-tone="bad"]{color:var(--ui-bad,#ff736c)}.lab-v2-qual__status[data-tone="ok"]{color:var(--ui-ok,#3ecf8e)}
    @media(max-width:640px){.lab-v2-reference__head,.lab-v2-run__head,.lab-v2-qual__head{align-items:center}.lab-v2-run__facts{display:block}.lab-v2-run__facts span{display:block;margin-top:2px}.lab-v2-life__line{min-width:10px}.lab-v2-qual__actions button{flex:1 1 100%}}
  `;
  document.head.append(style);
}

export function decorateLabV2(state) {
  const ix = state && state.currentData && state.currentData.index;
  const box = state && state.box;
  if (!ix || !box) return;
  styles();

  let overview = box.querySelector(".lab-v2-overview");
  if (!overview) {
    overview = document.createElement("div");
    overview.className = "lab-v2-overview";
    const layout = box.querySelector(".lab-layout");
    if (layout) layout.before(overview); else box.prepend(overview);
  }
  const overviewHtml = referenceCardHtml(ix);
  if (overview.innerHTML !== overviewHtml) overview.innerHTML = overviewHtml;

  const byId = Object.fromEntries(list(ix.experiments).filter(Boolean).map((x) => [x.id, x]));
  for (const article of box.querySelectorAll("article.lab-exp[id^='lab-']")) {
    const id = article.id.slice(4), exp = byId[id];
    if (!exp) continue;
    const html = experimentV2Html(exp, ix);
    let block = article.querySelector(":scope > .lab-v2-exp");
    if (!html) { block?.remove(); continue; }
    if (!block) {
      block = document.createElement("div");
      block.className = "lab-v2-exp";
      const title = article.querySelector("h3");
      if (title) title.insertAdjacentElement("afterend", block); else article.append(block);
    }
    const inner = html.replace(/^<div class="lab-v2-exp">|<\/div>$/g, "");
    if (block.innerHTML !== inner) block.innerHTML = inner;
  }
}

async function sendQualification(state, button) {
  const panel = button.closest("[data-qual-exp]");
  const expId = panel && panel.dataset.qualExp;
  const ix = state.currentData && state.currentData.index;
  const exp = list(ix && ix.experiments).find((x) => x && x.id === expId);
  if (!panel || !exp || !ix) return;
  const q = qualificationModel(exp, ix);
  const reference = panel.querySelector("[data-qual-reference]")?.value || "";
  const reason = panel.querySelector("[data-qual-reason]")?.value.trim() || "";
  const reviewed = Boolean(panel.querySelector("[data-qual-reviewed]")?.checked);
  const decision = button.dataset.qualDecision;

  if (!q.run || !q.build || !reference || !reason || !reviewed) {
    qualificationStatus.set(expId, { tone: "bad", text: "Choose the reference, confirm evidence review, and enter a reason." });
    decorateLabV2(state);
    return;
  }
  if (decision === "qualified" && !(q.firstClass && q.artifactReady)) return;

  const requestId = makeRequestId();
  const payload = {
    decision,
    reason,
    reference_experiment: reference,
    run_seen: q.run.id,
    build_seen: q.build,
    evidence_reviewed: true,
  };
  qualificationStatus.set(expId, { tone: "", text: "Waiting for the Mac to revalidate this exact Run and Build…" });
  decorateLabV2(state);
  try {
    await labFetch(`/api/lab/${encodeURIComponent(state.currentProject)}/qualification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, experiment: exp.id, run: q.run.id, payload }),
    });
    const stop = watchRequests(state.currentProject, [requestId], (item) => {
      if (item.status === "refused") qualificationStatus.set(expId, { tone: "bad", text: item.message || "The Mac refused this qualification decision." });
      else if (item.status === "applied" || item.status === "duplicate") qualificationStatus.set(expId, { tone: "ok", text: item.message || "Qualification decision recorded on the Mac." });
      else qualificationStatus.set(expId, { tone: "", text: "Waiting for the Mac to revalidate this exact Run and Build…" });
      decorateLabV2(state);
      if (item.status === "refused" || item.status === "applied" || item.status === "duplicate") stop();
    });
  } catch (err) {
    qualificationStatus.set(expId, { tone: "bad", text: err.message || "Couldn't queue the qualification decision." });
    decorateLabV2(state);
  }
}

export function mountLabV2(state) {
  if (!state || !state.box || state.labV2Mounted) return;
  state.labV2Mounted = true;
  let queued = false, decorating = false;
  const schedule = () => {
    if (queued || decorating) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      decorating = true;
      try { decorateLabV2(state); } finally { decorating = false; }
    });
  };
  const onClick = (event) => {
    const button = event.target.closest("[data-qual-decision]");
    if (button && state.box.contains(button)) sendQualification(state, button);
  };
  state.box.addEventListener("click", onClick);
  const observer = new MutationObserver(schedule);
  observer.observe(state.box, { childList: true, subtree: true });
  state.stopLabV2 = () => { observer.disconnect(); state.box.removeEventListener("click", onClick); };
  schedule();
}
