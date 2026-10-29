import assert from "node:assert/strict";
import {
  experimentV2Html,
  lifecycleModel,
  productionState,
  qualificationModel,
  qualificationPanelHtml,
  referenceCardHtml,
  runCardHtml,
} from "../hub/static/js/lab-v2.js";

const run = {
  id: "RUN-025-01",
  experiment: "E-025",
  build: "BLD-025-01",
  status: "printing",
  printer: "Bambu Lab X2D 0.4 nozzle",
  started_at: "2026-10-29T20:00:00+00:00",
  estimate: { minutes: 761.2, g: 363.71, layers: 660 },
  actual: {},
  artifacts: { bound: 4, required: 4, ready: true, missing: [], files_missing: [] },
};

const exp = {
  id: "E-025",
  status: "printing",
  test_kind: "full_part",
  shown_build: "BLD-025-01",
  reference_variants: ["E-019-A", "E-019-B"],
  photos: [],
  ai_observations: [],
  verdict: null,
  runs: [{ id: "PR-025-01", build_id: "BLD-025-01", started_at: run.started_at }],
};

const ix = {
  project: "hex-tile",
  experiments: [exp],
  runs: [run],
  qualification: {},
  production: { current: null, packages: [] },
};

assert.equal(productionState(ix).experiment, null);
assert(referenceCardHtml(ix).includes("Reference not set in Qualification"));

const runHtml = runCardHtml(run, ix);
assert(runHtml.includes("RUN-025-01"));
assert(runHtml.includes("12h 41m est."));
assert(runHtml.includes("363.7 g est."));
assert(runHtml.includes("660 layers"));
assert(runHtml.includes("4/4 artifacts bound"));

const life = lifecycleModel(exp, ix);
assert.deepEqual(life.map((x) => x[0]), ["Plan", "Build", "Run", "Evidence", "Verdict", "Qualify", "Production"]);
assert.equal(life[2][2], "active");
assert.equal(life[5][1], false);

const html = experimentV2Html(exp, ix);
assert(html.includes("Experiment lifecycle"));
assert(html.includes("RUN-025-01"));
assert(!html.includes("Owner release decision"));

const answeredExp = { ...exp, status: "answered", verdict: { kind: "acceptance", good_enough: true } };
const answeredRun = { ...run, status: "completed" };
const answeredIx = { ...ix, experiments: [answeredExp], runs: [answeredRun] };
const qual = qualificationModel(answeredExp, answeredIx);
assert(qual.eligible);
assert.equal(qual.firstClass, true);
assert.equal(qual.artifactReady, true);
assert.equal(qual.build, "BLD-025-01");
assert.deepEqual(qual.refs, ["E-019"]);
const qualHtml = qualificationPanelHtml(answeredExp, answeredIx);
assert(qualHtml.includes("Owner release decision"));
assert(qualHtml.includes("Exact snapshot: RUN-025-01 · BLD-025-01"));
assert(qualHtml.includes("Package ready"));
assert(qualHtml.includes('data-qual-decision="qualified"'));
assert(!qualHtml.includes('data-qual-decision="qualified" disabled'));

const incompleteIx = {
  ...answeredIx,
  runs: [{ ...answeredRun, artifacts: { bound: 3, required: 4, ready: false, missing: ["slice"], files_missing: [] } }],
};
const incompleteHtml = qualificationPanelHtml(answeredExp, incompleteIx);
assert(incompleteHtml.includes("Artifacts incomplete"));
assert(incompleteHtml.includes('data-qual-decision="qualified" disabled'));

const legacyIx = { ...answeredIx, runs: [] };
const legacyQual = qualificationModel(answeredExp, legacyIx);
assert.equal(legacyQual.firstClass, false);
const legacyHtml = qualificationPanelHtml(answeredExp, legacyIx);
assert(legacyHtml.includes("Legacy run"));
assert(legacyHtml.includes("canonical RUN record"));
assert(legacyHtml.includes('data-qual-decision="qualified" disabled'));

const packageId = "E-025-RUN-025-01-qualified-2026-10-30";
const qualifiedIx = {
  ...answeredIx,
  qualification: {
    current_reference: "E-025",
    current_run: "RUN-025-01",
    current_package: {
      id: packageId,
      path: `production/${packageId}`,
      experiment: "E-025",
      run: "RUN-025-01",
      manifest_sha256: "f".repeat(64),
    },
  },
  production: {
    current: {
      id: packageId,
      experiment: "E-025",
      run: "RUN-025-01",
      sealed: true,
      artifact_count: 4,
      previous_reference: "E-019",
      sealed_at: "2026-10-30T01:00:00+00:00",
    },
    packages: [],
  },
};

assert.equal(productionState(qualifiedIx).run, "RUN-025-01");
assert.equal(productionState(qualifiedIx).package, packageId);
const refHtml = referenceCardHtml(qualifiedIx);
assert(refHtml.includes("Current production reference"));
assert(refHtml.includes("RUN-025-01"));
assert(refHtml.includes(packageId));
assert(refHtml.includes("Sealed"));
assert(refHtml.includes("replaced E-019"));

const qualifiedRunHtml = runCardHtml({ ...answeredRun, status: "qualified" }, qualifiedIx);
assert(qualifiedRunHtml.includes("Sealed artifact identity"));
assert(qualifiedRunHtml.includes("Qualified"));

console.log("lab-v2: ok");