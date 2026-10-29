import assert from "node:assert/strict";
import {
  changesOf,
  comparisonModel,
  evidenceButton,
  evidenceState,
  referenceExperiment,
  studioHtml,
} from "../hub/static/js/lab-evidence.js";

const ref = {
  id: "E-019",
  status: "answered",
  test_kind: "full_part",
  filament: "PLA Matte Dusty Rose",
  factor: { name: "top_surface_speed", values: [200] },
  variants: [
    { id: "E-019-A", tab: "A", requested: 200, realized: 200, unit: "mm/s", grade: "clean" },
  ],
  verdict: { kind: "acceptance", good_enough: true, note: "keeper" },
  outcome: "supported",
  validity: { status: "valid" },
  finding: "Accepted baseline",
  photos: [{ sha256: "a".repeat(64), run: "PR-019-01", tab: "A" }],
};

const cur = {
  id: "E-023",
  status: "answered",
  test_kind: "full_part",
  filament: "PLA Matte Dusty Rose",
  factor: { name: "top_surface_speed", values: [160] },
  variants: [
    { id: "E-023-A", tab: "A", requested: 160, realized: 160, unit: "mm/s", grade: "clean" },
  ],
  verdict: { kind: "acceptance", good_enough: true, note: "smoother face" },
  outcome: "supported",
  validity: { status: "valid" },
  finding: "Cleaner top surface",
  photos: [{ sha256: "b".repeat(64), run: "PR-023-01", tab: "A" }],
  reference_variants: ["E-019-A"],
};

const ix = { project: "hex-tile", experiments: [ref, cur] };

assert.equal(referenceExperiment(cur, ix).id, "E-019");
assert.equal(referenceExperiment({ id: "E-024", reference_experiment: "E-019" }, ix).id, "E-019");
assert.equal(evidenceState(ref).code, "accepted");

const changes = changesOf(cur, ref);
assert(changes.some((c) => c.category === "Factor" && c.field === "top_surface_speed"));
assert(changes.some((c) => c.category === "Variant" && c.field === "A"));
assert(changes.some((c) => c.category === "Result" && c.field === "Finding"));

const model = comparisonModel(cur, ix);
assert.equal(model.reference.id, "E-019");
assert.equal(model.current.id, "E-023");
assert.equal(model.currentPhoto.sha256, "b".repeat(64));
assert.equal(model.referencePhoto.sha256, "a".repeat(64));

const button = evidenceButton(cur, ix);
assert(button.includes("lab-evidence-open"));
assert(button.includes("E-023"));

const html = studioHtml(cur, ix);
assert(html.includes("Evidence · E-023 vs E-019"));
assert(html.includes("What changed"));
assert(html.includes("/api/lab/hex-tile/photo/" + "a".repeat(64) + ".jpg"));
assert(html.includes("/api/lab/hex-tile/photo/" + "b".repeat(64) + ".jpg"));

assert.equal(evidenceButton({ id: "E-999" }, ix), "");

console.log("lab-evidence: ok");
