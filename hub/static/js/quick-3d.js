// Quick Print's 3D view (A19 P7): the stored model and the sliced file's toolpaths in Three.js. Loaded on demand from the
// Quick Print page and nowhere else. It never takes part in authorising a print: Slice, Review, Prepare, Start and Monitor
// don't import this file, and if it or WebGL fails the page says so in a line and the 2D layer inspector is untouched.
import { h } from "./core.js";
import { featureColor, featureOrder, mm } from "./quick-layers.js";
import { VIEWS, isReduced, layerSegments, limits, parseStl, pickLayers, reductionNote } from "./quick-3d-data.js";

const THREE_URL = "/static/vendor/three-0.187.0/three.module.js";
const ORBIT_URL = "/static/vendor/three-0.187.0/OrbitControls.js";
const PARALLEL = 4;
const KEY_STEP = Math.PI / 24;

const isDark = () => { try { return getComputedStyle(document.documentElement).colorScheme.includes("dark"); } catch { return false; } };

async function getJson(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`The hub answered ${r.status}.`);
  return r.json();
}

// Mounts into `into` and returns { destroy }. `opts.reduced` forces the mode (tests); otherwise it follows the device.
export function view3d(into, jobId, opts = {}) {
  let dead = false, three = null, renderer = null, controls = null, raf = 0, lost = false;
  const reduced = opts.reduced ?? isReduced();
  const cap = limits(reduced);
  const status = h("p", { class: "quick-3d__status", role: "status" }, "Loading the 3D view…");
  const note = h("p", { class: "quick-3d__note" });
  const stage = h("div", { class: "quick-3d__stage", tabindex: "0", role: "group",
    "aria-label": "3D view. Arrow keys turn it, shift and arrow keys move it, plus and minus zoom, 0 resets." });
  const bar = h("div", { class: "quick-3d__bar", role: "toolbar", "aria-label": "3D view controls" });
  const root = h("div", { class: "quick-3d", "aria-label": "3D view" }, status, bar, stage, note);
  into.append(root);

  const fail = (msg) => {
    status.className = "quick-3d__status ui-notice ui-notice--warn";
    status.textContent = msg;
    stage.hidden = true; bar.hidden = true;
  };

  function webglOk() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
  }

  async function run() {
    if (!webglOk()) return fail("This browser can't draw 3D here, so only the 2D layers are shown. Nothing else is affected.");
    try {
      three = await import(THREE_URL);
      const { OrbitControls } = await import(ORBIT_URL);
      if (dead) return;
      await build(three, OrbitControls);
    } catch (e) {
      if (!dead) fail(`The 3D view couldn't start (${e?.message || "unknown error"}). The 2D layers still work, and so does everything else on this page.`);
    }
  }

  async function build(T, OrbitControls) {
    let summary = await getJson(`/api/quick/jobs/${jobId}/layers`);
    for (let i = 0; i < 40 && summary.state === "building" && !dead; i++) {
      status.textContent = `Waiting for the layers to be read from the sliced file${Number.isFinite(summary.progress) ? `: ${Math.round(100 * summary.progress)}%` : ""}…`;
      await new Promise((r) => setTimeout(r, 1500));
      summary = await getJson(`/api/quick/jobs/${jobId}/layers`);
    }
    if (dead) return;
    if (!summary.layers?.length || (summary.state !== "ready" && summary.state !== "building")) {
      return fail(`There are no layers to draw in 3D. ${summary.reason || ""}`.trim());
    }
    const plate = summary.plate?.area ? summary.plate : null;
    const bounds = summary.bounds;
    const area = plate?.area || (bounds ? [bounds[0] - 10, bounds[1] - 10, bounds[2] + 10, bounds[3] + 10] : [0, 0, 256, 256]);
    const maxZ = Math.max(...summary.layers.map((l) => l.z || 0), 1);
    const volumeH = plate?.height || maxZ * 1.2;

    renderer = new T.WebGLRenderer({ antialias: !reduced, powerPreference: reduced ? "low-power" : "default" });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, reduced ? 1.5 : 2));
    renderer.localClippingEnabled = true;
    const canvas = renderer.domElement;
    canvas.className = "quick-3d__canvas";
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); lost = true; cancelAnimationFrame(raf);
      fail("The graphics context was lost, so the 3D view stopped. The 2D layers and everything else still work.");
      stage.hidden = true;
    });
    canvas.addEventListener("webglcontextrestored", () => { lost = false; });
    stage.replaceChildren(canvas);

    const scene = new T.Scene();
    const dark = isDark();
    const ink = dark ? 0xc9d1d9 : 0x1f2933;
    renderer.setClearColor(dark ? 0x10161c : 0xf4f6f8, 1);
    scene.add(new T.AmbientLight(0xffffff, 1.3));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, -1, 2);
    scene.add(sun);

    const cx = (area[0] + area[2]) / 2, cy = (area[1] + area[3]) / 2;
    const target = new T.Vector3(cx, cy, Math.min(maxZ, volumeH) / 2);
    const span = Math.max(area[2] - area[0], area[3] - area[1], volumeH);

    // The build plate and volume, from the slicer's own printable_area / printable_height lines when the file has them.
    const plane = new T.Mesh(new T.PlaneGeometry(area[2] - area[0], area[3] - area[1]),
      new T.MeshBasicMaterial({ color: dark ? 0x1b242c : 0xdde3e8, side: T.DoubleSide, transparent: true, opacity: 0.8 }));
    plane.position.set(cx, cy, -0.05);
    scene.add(plane);
    const box = new T.Box3(new T.Vector3(area[0], area[1], 0), new T.Vector3(area[2], area[3], volumeH));
    const edges = new T.Box3Helper(box, ink);
    edges.material.transparent = true; edges.material.opacity = 0.35;
    scene.add(edges);
    scene.add(new T.AxesHelper(Math.min(30, span / 6)));

    const clip = new T.Plane(new T.Vector3(0, 0, -1), maxZ + 0.01); // keeps z <= constant
    const groups = { model: new T.Group(), paths: new T.Group() };
    scene.add(groups.model, groups.paths);

    // Cameras: perspective and orthographic share one orbit target.
    const persp = new T.PerspectiveCamera(40, 1, span / 200, span * 20);
    const ortho = new T.OrthographicCamera(-1, 1, 1, -1, -span * 20, span * 20);
    let camera = persp;
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false; // draws on demand only, so reduced motion has nothing to respect beyond this
    controls.screenSpacePanning = true;
    controls.target.copy(target);
    controls.addEventListener("change", request);

    function setView(key) {
      const v = VIEWS[key] || VIEWS.iso;
      const aspect = (stage.clientWidth || 320) / (stage.clientHeight || 240); // a narrow stage backs off to keep the plate in
      const d = new T.Vector3(...v.dir).normalize().multiplyScalar(span * 1.9 * Math.max(1, 1 / Math.max(aspect, 0.5)));
      for (const c of [persp, ortho]) { c.up.set(...v.up); c.position.copy(target).add(d); c.lookAt(target); }
      controls.target.copy(target); controls.update();
      fitOrtho(); request();
    }
    function fitOrtho() {
      const w = stage.clientWidth || 320, hh = stage.clientHeight || 240, a = w / hh, s = span * 0.75;
      ortho.left = -s * a; ortho.right = s * a; ortho.top = s; ortho.bottom = -s;
      ortho.zoom = Math.max(ortho.zoom, 0.01); ortho.updateProjectionMatrix();
      persp.aspect = a; persp.updateProjectionMatrix();
    }
    function resize() {
      const w = Math.max(stage.clientWidth, 120), hh = Math.max(stage.clientHeight, 120);
      renderer.setSize(w, hh, false); fitOrtho(); request();
    }
    function request() {
      if (raf || dead || lost) return;
      raf = requestAnimationFrame(() => { raf = 0; if (!dead && !lost) renderer.render(scene, camera); });
    }
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    ro?.observe(stage);

    // Toolbar.
    const btn = (label, onclick, extra = {}) => h("button", { type: "button", class: "ui-btn", onclick, ...extra }, label);
    const camBtn = btn("Orthographic", () => {
      camera = camera === persp ? ortho : persp;
      camBtn.textContent = camera === persp ? "Orthographic" : "Perspective";
      camBtn.setAttribute("aria-pressed", camera === ortho ? "true" : "false");
      controls.object = camera; controls.update(); request();
    }, { "aria-pressed": "false" });
    const cut = h("input", { type: "range", id: `q3-cut-${jobId}`, min: 0, max: summary.layers.length - 1, step: 1,
      value: summary.layers.length - 1, "aria-label": "Section plane: show layers up to" });
    const cutOut = h("output", { for: cut.id }, "");
    const setCut = () => {
      const l = summary.layers[Number(cut.value)] || summary.layers.at(-1);
      clip.constant = Number(cut.value) >= summary.layers.length - 1 ? maxZ + 0.01 : (l.z || 0) + 0.001;
      cutOut.textContent = Number(cut.value) >= summary.layers.length - 1 ? "Whole print" : `Up to layer ${Number(cut.value) + 1} (${l.z} mm)`;
      request();
    };
    cut.addEventListener("input", setCut);
    const toggle = (label, grp, on = true) => h("label", { class: "quick-3d__tog" },
      h("input", { type: "checkbox", checked: on, onchange: (e) => { groups[grp].visible = e.target.checked; request(); } }), label);
    bar.append(...Object.entries(VIEWS).map(([k, v]) => btn(v.label, () => setView(k))), camBtn,
      toggle("Model", "model"), toggle("Toolpaths", "paths"),
      h("label", { class: "quick-3d__cut" }, h("span", {}, "Section"), cut, cutOut));

    // Keyboard: the canvas has focus, so these never fight the page.
    stage.addEventListener("keydown", (e) => {
      const k = e.key;
      const pan = e.shiftKey, a = KEY_STEP;
      const rot = (dx, dy) => {
        const off = camera.position.clone().sub(controls.target);
        const sph = new T.Spherical().setFromVector3(off.applyQuaternion(new T.Quaternion().setFromUnitVectors(camera.up, new T.Vector3(0, 1, 0))));
        sph.theta += dx; sph.phi = Math.min(Math.max(sph.phi + dy, 0.05), Math.PI - 0.05);
        off.setFromSpherical(sph).applyQuaternion(new T.Quaternion().setFromUnitVectors(camera.up, new T.Vector3(0, 1, 0)).invert());
        camera.position.copy(controls.target).add(off); camera.lookAt(controls.target); controls.update(); request();
      };
      const move = (dx, dy) => {
        const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const d = right.multiplyScalar(dx * span * 0.04).add(up.multiplyScalar(dy * span * 0.04));
        camera.position.add(d); controls.target.add(d); controls.update(); request();
      };
      const zoom = (f) => {
        if (camera === ortho) { ortho.zoom = Math.min(Math.max(ortho.zoom * f, 0.1), 40); ortho.updateProjectionMatrix(); }
        else { const off = camera.position.clone().sub(controls.target); camera.position.copy(controls.target).add(off.multiplyScalar(1 / f)); }
        controls.update(); request();
      };
      const keys = {
        ArrowLeft: () => (pan ? move(-1, 0) : rot(-a, 0)), ArrowRight: () => (pan ? move(1, 0) : rot(a, 0)),
        ArrowUp: () => (pan ? move(0, 1) : rot(0, -a)), ArrowDown: () => (pan ? move(0, -1) : rot(0, a)),
        "+": () => zoom(1.15), "=": () => zoom(1.15), "-": () => zoom(1 / 1.15), "0": () => { ortho.zoom = 1; setView("iso"); },
      };
      if (keys[k]) { e.preventDefault(); keys[k](); }
    });

    setView("iso"); resize();
    status.className = "quick-3d__status";
    status.textContent = "Loading the model and toolpaths…";

    // Data: the toolpaths from the file's own layers (every n-th when there are many) and the STL when there is one.
    const { indices, step } = pickLayers(summary.layers.length, cap.layers);
    const order = featureOrder(summary.layers);
    const perLayer = Math.max(200, Math.floor(cap.segments / indices.length));
    let dropped = 0, next = 0;
    const mats = new Map();
    const mat = (f) => {
      if (!mats.has(f)) mats.set(f, new T.LineBasicMaterial({ color: new T.Color(featureColor(Math.max(order.indexOf(f), 0), dark)), clippingPlanes: [clip] }));
      return mats.get(f);
    };
    const worker = async () => {
      while (!dead && next < indices.length) {
        const i = indices[next++];
        let geo;
        try { geo = await getJson(`/api/quick/jobs/${jobId}/layers/${i}`); } catch { continue; }
        const seg = layerSegments(geo, { budget: perLayer });
        dropped += seg.dropped;
        for (const [f, pts] of seg.lines) {
          const g = new T.BufferGeometry();
          g.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
          groups.paths.add(new T.LineSegments(g, mat(f)));
        }
        request();
      }
    };
    const modelP = (async () => {
      try {
        const r = await fetch(`/api/quick/jobs/${jobId}/model`, { credentials: "same-origin" });
        if (!r.ok) return { absent: true };
        const stl = parseStl(await r.arrayBuffer(), cap.triangles);
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(stl.positions, 3));
        g.computeVertexNormals();
        const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: dark ? 0x7aa2c4 : 0x5b8db8, transparent: true, opacity: 0.32,
          side: T.DoubleSide, depthWrite: false, clippingPlanes: [clip] }));
        groups.model.add(m);
        return stl;
      } catch (e) { return { error: e }; }
    })();
    await Promise.all([modelP, ...Array.from({ length: PARALLEL }, worker)]);
    if (dead) return;
    const stl = await modelP;
    const bits = [`${summary.layers.length} layers from the sliced file`];
    bits.push(stl.absent ? "no STL model is stored, so the model isn't drawn" : stl.error ? `the model couldn't be read (${stl.error.message})` : "the stored model is the translucent shape");
    if (Number.isFinite(maxZ)) bits.push(`${mm(maxZ)} tall`);
    status.textContent = `${bits.join("; ")}.`;
    note.textContent = reductionNote({ reduced, layers: summary.layers.length, step, dropped, modelShown: stl.shown || 0, modelTotal: stl.triangles || 0 });
    request();
  }

  run();
  return {
    destroy() {
      dead = true; cancelAnimationFrame(raf);
      try { controls?.dispose(); renderer?.dispose(); renderer?.forceContextLoss?.(); } catch { /* already gone */ }
      root.remove();
    },
  };
}
