// A19 P7: the 3D view's pure half. The STL reader and its caps, layer picking, toolpath segments, and the words for what was left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../hub/static/js/quick-3d-data.js';

function binaryStl(tris) {
  const buf = new ArrayBuffer(84 + 50 * tris.length);
  const v = new DataView(buf);
  v.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.flat().forEach((x, k) => v.setFloat32(84 + 50 * i + 12 + 4 * k, x, true)));
  return buf;
}
const T = (o = 0) => [[o, 0, 0], [o + 10, 0, 0], [o, 10, 5]];

test('parseStl reads a binary STL and its bounds', () => {
  const s = d.parseStl(binaryStl([T(0), T(20)]));
  assert.equal(s.triangles, 2); assert.equal(s.shown, 2); assert.equal(s.positions.length, 18);
  assert.deepEqual(s.bounds, { lo: [0, 0, 0], hi: [30, 10, 5] });
});

test('parseStl reads an ASCII STL', () => {
  const txt = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 4 0 0\nvertex 0 4 2\nendloop\nendfacet\nendsolid x\n';
  const s = d.parseStl(new TextEncoder().encode(txt).buffer);
  assert.equal(s.triangles, 1); assert.deepEqual(s.bounds.hi, [4, 4, 2]);
});

test('parseStl thins to the cap and says how many it kept', () => {
  const s = d.parseStl(binaryStl(Array.from({ length: 10 }, (_, i) => T(i))), 3);
  assert.equal(s.triangles, 10); assert.ok(s.shown <= 3 && s.shown >= 1); assert.equal(s.positions.length, s.shown * 9);
});

test('parseStl refuses empty, truncated, non-numeric and garbage files in words', () => {
  assert.throws(() => d.parseStl(new ArrayBuffer(0)), /empty or truncated/);
  assert.throws(() => d.parseStl(null), /empty or truncated/);
  assert.throws(() => d.parseStl(new TextEncoder().encode('not an stl at all, nothing here').buffer), /readable STL/);
  assert.throws(() => d.parseStl(binaryStl([[[NaN, 0, 0], [1, 0, 0], [0, 1, 0]]])), /aren't numbers/);
  const cut = binaryStl([T(0), T(5)]).slice(0, 120); // framing no longer matches: not binary, not ASCII
  assert.throws(() => d.parseStl(cut), /readable STL/);
});

test('pickLayers keeps first and last, evenly, and reports the step', () => {
  assert.deepEqual(d.pickLayers(4, 60), { indices: [0, 1, 2, 3], step: 1 });
  const p = d.pickLayers(1000, 60);
  assert.equal(p.indices.length, 60); assert.equal(p.indices[0], 0); assert.equal(p.indices.at(-1), 999);
  assert.equal(p.step, 17); assert.deepEqual(p.indices, [...p.indices].sort((a, b) => a - b));
  assert.deepEqual(d.pickLayers(0, 60).indices, []);
});

test('layerSegments puts each run at the layer height, by feature, and caps', () => {
  const geo = { z: 0.4, extrusion: [{ f: 'Outer wall', p: [0, 0, 10, 0, 10, 10] }, { f: 'Sparse infill', p: [1, 1, 2, 2] }], travel: [[0, 0, 5, 5]] };
  const s = d.layerSegments(geo);
  assert.deepEqual(s.lines.get('Outer wall'), [0, 0, 0.4, 10, 0, 0.4, 10, 0, 0.4, 10, 10, 0.4]);
  assert.equal(s.used, 3); assert.equal(s.travel.length, 0);
  assert.equal(d.layerSegments(geo, { travel: true }).travel.length, 6);
  const c = d.layerSegments(geo, { budget: 2 });
  assert.equal(c.used, 2); assert.equal(c.dropped, 1);
  assert.doesNotThrow(() => d.layerSegments(null)); assert.doesNotThrow(() => d.layerSegments({ extrusion: [{ p: 'x' }, null] }));
});

test('the six views plus isometric each have a direction and an up that are not parallel', () => {
  assert.deepEqual(Object.keys(d.VIEWS).sort(), ['back', 'bottom', 'front', 'iso', 'left', 'right', 'top']);
  for (const v of Object.values(d.VIEWS)) {
    const [a, b] = [v.dir, v.up];
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    assert.ok(cross.some((x) => Math.abs(x) > 1e-9), `${v.label}: camera direction must not be parallel to up`);
  }
});

test('reduced mode follows the device and is stricter', () => {
  assert.equal(d.isReduced({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(d.isReduced({ matchMedia: () => ({ matches: false }), innerWidth: 390 }), true);
  assert.equal(d.isReduced({ matchMedia: () => ({ matches: false }), innerWidth: 1400, navigator: { deviceMemory: 2 } }), true);
  assert.equal(d.isReduced({ matchMedia: () => ({ matches: false }), innerWidth: 1400, navigator: { deviceMemory: 8 } }), false);
  assert.ok(d.limits(true).layers < d.limits(false).layers && d.limits(true).segments < d.limits(false).segments);
});

test('reductionNote says what was left out, or nothing', () => {
  assert.equal(d.reductionNote({ reduced: false, layers: 100, step: 1, dropped: 0, modelShown: 5, modelTotal: 5 }), '');
  const n = d.reductionNote({ reduced: true, layers: 500, step: 9, dropped: 1200, modelShown: 80000, modelTotal: 900000 });
  assert.match(n, /^Reduced mode for this device/); assert.match(n, /every 9th layer/); assert.match(n, /1,200/); assert.match(n, /80,000 of 900,000/);
  assert.match(d.reductionNote({ reduced: false, layers: 300, step: 2, dropped: 0, modelShown: 0, modelTotal: 0 }), /every second layer/);
});
