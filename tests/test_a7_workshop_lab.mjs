// A7 P1 on Workshop › Printer and Print lab: one faceplate each and no old cards. The printer's faceplate carries the
// camera as its aside and says unknown, never idle, when no source answers; Print lab's Needs you here is a section
// shown only when something waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const chip = (p) => p.querySelector('.ui-faceplate__nameplate .ui-chip');
const live = { status: 'live', source: 'Bambuddy', observed_at: new Date().toISOString() };

test('Workshop: printing shows the percentage, the job, the progress bar and the camera beside it', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/workshop.js');
    const p = printerPlate({ state: 'printing', progress: 42, left: '1 h 10 min', minutes_left: 70, job_name: 'RIFT_TILE.gcode.3mf',
      layer_num: 12, total_layers: 300, nozzle_temp: 220, nozzle_target: 220, bed_temp: 60, bed_target: 0, telemetry: live },
    { ok: true, source: 'Pi' });
    assert.equal(chip(p).className, 'ui-chip ui-chip--ok ui-chip--live');
    assert.equal(text(p.querySelector('.ui-readout')), '42 %');
    assert.match(text(p.querySelector('.ui-faceplate__caption')), /^Done in about 1 h 10 min/);
    const dd = p.querySelectorAll('dd').map(text);
    assert.ok(dd.includes('Rift tile') && dd.includes('12 / 300') && dd.includes('60°C'), 'a heater with no target shows one number');
    assert.ok(p.querySelector('[role="progressbar"]'));
    assert.ok(p.querySelector('.ui-faceplate__aside .cam-img'), 'the camera is the aside');
  } finally { dom.uninstall(); }
});

test('Workshop: idle says so once (no readout repeating the lamp, no layer); no source is unknown; stale is "Last readings"', async () => {
  const dom = install();
  try {
    const { printerPlate } = await import('../hub/static/js/workshop.js');
    const idle = printerPlate({ state: 'idle', headline: 'Idle', detail: 'Ready for the next print.', layer_num: 679, total_layers: 679, telemetry: live }, { ok: false, reason: 'liveview_off' });
    assert.equal(text(chip(idle)), 'Idle');
    assert.ok(!idle.querySelector('.ui-readout'));
    assert.ok(!idle.querySelectorAll('dt').map(text).includes('Layer'));
    assert.match(text(idle.querySelector('.ui-faceplate__aside')), /LAN Only Liveview/);
    assert.equal(chip(printerPlate({ state: 'idle', telemetry: {} }, null)).className, 'ui-chip ui-chip--unknown');
    assert.equal(text(chip(printerPlate({ state: 'idle', stale: true, telemetry: live }, null))), 'Last readings');
    assert.equal(chip(printerPlate({ state: 'error', telemetry: live }, null)).className, 'ui-chip ui-chip--bad');
  } finally { dom.uninstall(); }
});

test('Workshop: when the status fails, the faceplate says no answer instead of a skeleton that never settles', async () => {
  const dom = install();
  try {
    const ws = await import('../hub/static/js/workshop.js');
    const state = { root: dom.root() };
    ws.mount(state);
    ws.failed(state);
    ws.leave(state);
    assert.equal(state.root.querySelectorAll('.ui-faceplate').length, 1);
    assert.equal(chip(state.root.querySelector('.ui-faceplate')).className, 'ui-chip ui-chip--unknown');
    assert.equal(state.root.querySelectorAll('.card').length, 0);
  } finally { dom.uninstall(); }
});

test('Print lab: no card classes; Needs you here is a section, hidden with nothing waiting', async () => {
  const dom = install();
  try {
    const { renderNotebook } = await import('../hub/static/js/lab.js');
    const exp = { id: 'E-1', status: 'planned', question_text: 'Does it?' };
    const q = { id: 'Q-1', question: 'Why?', status: 'open', experiments: ['E-1'] };
    const withNeed = renderNotebook({ index: { experiments: [exp], questions: [q], needs: [{ id: 'E-1', action: 'Fix the plan' }] }, meta: {} });
    assert.doesNotMatch(withNeed, /class="card[ "]/);
    assert.match(withNeed, /<section class="ui-section lab-needs-here" id="lab-sec-needs" aria-labelledby="lab-needs-title"><h2 id="lab-needs-title">Needs you here<\/h2><ul class="ui-rows lab-needs">/);
    const none = renderNotebook({ index: { experiments: [exp], questions: [q], needs: [] }, meta: {} });
    assert.match(none, /id="lab-sec-needs" aria-labelledby="lab-needs-title" hidden>/);
    assert.doesNotMatch(none, /class="card[ "]/);
  } finally { dom.uninstall(); }
});
