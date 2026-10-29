// Print Lab Evidence Studio
// Decision support over the existing observation/verdict/photo/reference data.
import { mountLabV2 } from "./lab-v2.js";

const list = (v) => (Array.isArray(v) ? v : []);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const SHA = /^[0-9a-f]{64}$/;
const refExperimentId = (value) => String(value || "").replace(/-[^-]*$/, "");

function plain(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join(", ");
  if (typeof v === "object") {
    return Object.entries(v)
      .map(([k, x]) => [k, plain(x)])
      .filter(([, x]) => x !== "")
      .map(([k, x]) => `${k} ${x}`)
      .join(" · ");
  }
  return String(v);
}

function normalized(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  if (Array.isArray(v)) return v.map(normalized);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalized(v[k]);
    return out;
  }
  return String(v);
}

function same(a, b) {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

function shown(v) {
  const p = plain(v);
  return p || "—";
}

function photoUrl(project, photo) {
  if (!photo || !SHA.test(String(photo.sha256 || ""))) return "";
  return `/api/lab/${encodeURIComponent(project || "")}/photo/${photo.sha256}.jpg`;
}

function firstPhoto(x) {
  return list(x && x.photos).find((p) => p && SHA.test(String(p.sha256 || ""))) || null;
}

export function referenceExperiment(x, ix) {
  if (!x || !ix) return null;
  const byId = Object.fromEntries(list(ix.experiments).filter(Boolean).map((e) => [e.id, e]));

  for (const item of list(x.reference_variants)) {
    const ref = byId[refExperimentId(item)];
    if (ref && ref.id !== x.id) return ref;
  }

  const explicit = [
    x.reference_experiment,
    x.reference_id,
    x.reference && x.reference.experiment,
    x.comparison && x.comparison.reference_experiment,
  ].find((id) => typeof id === "string" && id);

  return explicit && byId[explicit] && explicit !== x.id ? byId[explicit] : null;
}

export function evidenceState(x) {
  if (!x) return { label: "Unknown", tone: "neutral", code: "unknown" };

  if (x.verdict && x.verdict.kind === "acceptance") {
    return x.verdict.good_enough === true
      ? { label: "Accepted", tone: "ok", code: "accepted" }
      : { label: "Not accepted", tone: "bad", code: "rejected" };
  }

  if (x.outcome === "supported") return { label: "Prediction supported", tone: "ok", code: "supported" };
  if (x.outcome === "refuted") return { label: "Prediction refuted", tone: "warn", code: "refuted" };
  if (x.outcome === "inconclusive") return { label: "Inconclusive", tone: "neutral", code: "inconclusive" };
  if (x.status === "answered") return { label: "Observed", tone: "ok", code: "observed" };
  if (x.status === "printing") return { label: "Printing", tone: "warn", code: "printing" };

  return { label: "Decision pending", tone: "neutral", code: "pending" };
}

function variantKey(v, i) {
  return String((v && (v.tab || v.id)) || `#${i + 1}`);
}

function variantValue(v) {
  if (!v) return null;
  if (v.realized !== null && v.realized !== undefined) {
    return v.unit ? `${shown(v.realized)} ${v.unit}` : shown(v.realized);
  }
  if (v.requested !== null && v.requested !== undefined) {
    return v.unit ? `${shown(v.requested)} ${v.unit}` : shown(v.requested);
  }
  return null;
}

function addChange(out, category, field, before, after) {
  if (same(before, after)) return;
  out.push({
    category,
    field: String(field),
    reference: before,
    current: after,
  });
}

export function changesOf(current, reference) {
  if (!current || !reference) return [];

  const out = [];

  addChange(
    out,
    "Experiment",
    "Test kind",
    String(reference.test_kind || "").replace(/_/g, " "),
    String(current.test_kind || "").replace(/_/g, " ")
  );

  addChange(out, "Material", "Filament", reference.filament || null, current.filament || null);

  const rf = reference.factor || {};
  const cf = current.factor || {};
  addChange(out, "Factor", "Factor", rf.name || null, cf.name || null);
  addChange(out, "Factor", cf.name || rf.name || "Values", rf.values || null, cf.values || null);

  const rv = new Map(list(reference.variants).map((v, i) => [variantKey(v, i), v]));
  const cv = new Map(list(current.variants).map((v, i) => [variantKey(v, i), v]));
  const keys = [...new Set([...rv.keys(), ...cv.keys()])];

  for (const key of keys) {
    const a = rv.get(key);
    const b = cv.get(key);
    if (!a || !b) {
      addChange(out, "Variant", key, a ? variantValue(a) : null, b ? variantValue(b) : null);
      continue;
    }
    addChange(out, "Variant", key, variantValue(a), variantValue(b));
    addChange(out, "Variant", `${key} grade`, a.grade || null, b.grade || null);
  }

  addChange(out, "Result", "Outcome", reference.outcome || null, current.outcome || null);
  addChange(
    out,
    "Result",
    "Validity",
    reference.validity && reference.validity.status,
    current.validity && current.validity.status
  );
  addChange(out, "Result", "Finding", reference.finding || null, current.finding || null);

  if (reference.verdict || current.verdict) {
    const verdictText = (x) => x && (
      x.note ||
      (x.kind === "acceptance"
        ? (x.good_enough ? "good enough" : "not good enough")
        : x.kind)
    );
    addChange(out, "Result", "Verdict", verdictText(reference.verdict), verdictText(current.verdict));
  }

  return out;
}

export function comparisonModel(x, ix) {
  const reference = referenceExperiment(x, ix);
  if (!reference) return null;

  return {
    current: x,
    reference,
    currentState: evidenceState(x),
    referenceState: evidenceState(reference),
    changes: changesOf(x, reference),
    currentPhoto: firstPhoto(x),
    referencePhoto: firstPhoto(reference),
  };
}

export function evidenceButton(x, ix) {
  const model = comparisonModel(x, ix);
  if (!model) return "";
  const count = model.changes.length;
  return `<button type="button" class="btn-outline lab-evidence-open" data-exp="${esc(x.id)}">Evidence${count ? ` · ${count} change${count === 1 ? "" : "s"}` : ""}</button>`;
}

function statePill(state) {
  return `<span class="lab-evidence__pill" data-tone="${esc(state.tone)}">${esc(state.label)}</span>`;
}

function photoCell(title, x, photo, project) {
  const src = photoUrl(project, photo);
  const verdict = x.verdict && (
    x.verdict.note ||
    (x.verdict.kind === "acceptance"
      ? (x.verdict.good_enough ? "Good enough" : "Not good enough")
      : x.verdict.kind)
  );

  return `<section class="lab-evidence__side">
    <div class="lab-evidence__side-head">
      <div>
        <span class="lab-evidence__eyebrow">${esc(title)}</span>
        <h3>${esc(x.id)}</h3>
      </div>
      ${statePill(evidenceState(x))}
    </div>
    ${src
      ? `<a href="${src}" target="_blank" rel="noopener" class="lab-evidence__photo"><img src="${src}" alt="${esc(x.id)} evidence photo"></a>`
      : `<div class="lab-evidence__photo lab-evidence__photo--empty"><span>No synced photo</span></div>`}
    <dl class="lab-evidence__facts">
      ${x.question_text ? `<div><dt>Question</dt><dd>${esc(x.question_text)}</dd></div>` : ""}
      ${x.filament ? `<div><dt>Filament</dt><dd>${esc(plain(x.filament))}</dd></div>` : ""}
      ${x.finding ? `<div><dt>Finding</dt><dd>${esc(plain(x.finding))}</dd></div>` : ""}
      ${verdict ? `<div><dt>Verdict</dt><dd>${esc(verdict)}</dd></div>` : ""}
    </dl>
  </section>`;
}

function changesTable(changes) {
  if (!changes.length) {
    return `<div class="lab-evidence__same"><strong>No material deltas in the synced index.</strong><span>The experiment and its reference resolve to the same compared values.</span></div>`;
  }

  return `<div class="lab-evidence__changes">
    <div class="lab-evidence__changes-head">
      <h3>What changed</h3>
      <span class="meta">${changes.length} difference${changes.length === 1 ? "" : "s"}</span>
    </div>
    <div class="lab-evidence__table-wrap">
      <table class="lab-evidence__table">
        <thead><tr><th>Area</th><th>Field</th><th>Reference</th><th>Current</th></tr></thead>
        <tbody>${changes.map((c) => `<tr>
          <td>${esc(c.category)}</td>
          <th scope="row">${esc(c.field)}</th>
          <td>${esc(shown(c.reference))}</td>
          <td>${esc(shown(c.current))}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

export function studioHtml(x, ix) {
  const model = comparisonModel(x, ix);
  if (!model) {
    return `<p class="meta">No explicit reference experiment is synced for ${esc(x && x.id)}.</p>`;
  }

  const project = ix && ix.project;

  return `<div class="lab-evidence__summary">
      <div>
        <span class="lab-evidence__eyebrow">Decision context</span>
        <h2 id="labEvidenceTitle">Evidence · ${esc(model.current.id)} vs ${esc(model.reference.id)}</h2>
      </div>
      <p class="meta">This view does not decide for you. It surfaces the synced evidence and the deltas between this experiment and its reference.</p>
    </div>
    <div class="lab-evidence__grid">
      ${photoCell("Current", model.current, model.currentPhoto, project)}
      ${photoCell("Reference", model.reference, model.referencePhoto, project)}
    </div>
    ${changesTable(model.changes)}
    <div class="lab-evidence__footer">
      <p class="meta">For pixel inspection or curtain comparison, use the existing photo Compare control on the experiment card.</p>
    </div>`;
}

export function mountEvidenceStudio(state) {
  if (!state || !state.box || !state.sheetsContainer) return;
  mountLabV2(state);

  let dialog = state.sheetsContainer.querySelector("#labEvidenceStudio");
  if (!dialog) {
    state.sheetsContainer.insertAdjacentHTML("beforeend", `
      <dialog id="labEvidenceStudio" class="lab-evidence" aria-labelledby="labEvidenceTitle">
        <div class="lab-evidence__shell">
          <button type="button" class="btn-outline lab-evidence__close" aria-label="Close evidence studio">Close</button>
          <div class="lab-evidence__body"></div>
        </div>
      </dialog>`);
    dialog = state.sheetsContainer.querySelector("#labEvidenceStudio");
  }

  dialog.querySelector(".lab-evidence__close")?.addEventListener("click", () => dialog.close());

  state.box.addEventListener("click", (event) => {
    const button = event.target.closest(".lab-evidence-open");
    if (!button) return;

    const ix = state.currentData && state.currentData.index;
    const x = list(ix && ix.experiments).find((e) => e && e.id === button.dataset.exp);
    if (!x) return;

    dialog.querySelector(".lab-evidence__body").innerHTML = studioHtml(x, ix);
    if (!dialog.open) dialog.showModal();
  });

  state.closeEvidenceStudio = () => {
    if (dialog && dialog.open) dialog.close();
  };
}