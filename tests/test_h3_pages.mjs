// A7 H3a: Weather, Network and Documents drawn as one page (P1 faceplate, P3 lamp-right rows, P8 honest states).
import test from 'node:test';
import assert from 'node:assert/strict';
import { install, text } from './helpers/fake_dom.mjs';

const WX = { place: 'Springfield', units: 'F', sunset: '6:02 PM', alerts: [],
  now: { temp: 61, feels: 59, sky: 'Partly cloudy', icon: 'partly-day', wind: 8, gusts: 9, humidity: 40, uv: 3 },
  hours: [{ label: '3 PM', temp: 62, icon: 'partly-day', rain: 0 }],
  days: [{ date: '2026-11-05', high: 64, low: 44, sky: 'Partly cloudy', icon: 'partly-day', rain: 30 },
    { date: '2026-11-06', high: 58, low: 40, sky: 'Rain', icon: 'rain', rain: 80 }] };

test('Weather: now is the faceplate, the week is lamp-right rows, Open-Meteo in the sources', async () => {
  const dom = install();
  try {
    const { weatherView } = await import('../hub/static/js/weather.js');
    const v = weatherView({ weather: WX, place_set: true });
    const plate = v.parts.find((p) => p.className?.startsWith('ui-faceplate'));
    assert.equal(plate.getAttribute('aria-label'), 'Springfield');
    assert.equal(text(plate.querySelector('.ui-readout')), '61°');
    assert.ok(!plate.querySelector('.ui-chip'), 'no lamp without a warning');
    assert.ok(plate.querySelectorAll('dt').map(text).includes('Sunset'));
    assert.ok(!plate.querySelectorAll('dt').map(text).includes('Air quality'), 'no air reading, no row');
    const week = v.parts.find((p) => p.className === 'ui-section' && text(p.querySelector('h2')) === 'This week');
    assert.deepEqual(week.querySelectorAll('.ui-row__title').map(text), ['Today', 'Tomorrow']);
    assert.deepEqual(v.sources.map((s) => [s.name, s.tone]), [['Open-Meteo', 'ok'], ['National Weather Service', 'ok']]);
  } finally { dom.uninstall(); }
});

test('Weather: a warning is a notice above the faceplate and lights its lamp', async () => {
  const dom = install();
  try {
    const { weatherView } = await import('../hub/static/js/weather.js');
    const v = weatherView({ weather: { ...WX, alerts: [{ event: 'Wind Advisory', headline: 'Until 6 PM' }] }, place_set: true });
    assert.match(v.parts[0].className, /ui-notice ui-notice--warn/);
    assert.equal(v.parts[0].getAttribute('role'), 'alert');
    assert.equal(v.parts[1].querySelector('.ui-chip').className, 'ui-chip ui-chip--warn');
  } finally { dom.uninstall(); }
});

test('Weather: no town and a silent service are told apart, neither shown as fine', async () => {
  const dom = install();
  try {
    const { weatherView } = await import('../hub/static/js/weather.js');
    const unset = weatherView({ weather: null, place_set: false });
    assert.equal(text(unset.parts[0].querySelector('.ui-chip')), 'Town not set');
    assert.equal(unset.parts[0].querySelector('a').getAttribute('href'), '/settings#group-outside');
    assert.equal(unset.sources[0].tone, 'unknown');
    const down = weatherView({ weather: null, place_set: true });
    assert.equal(down.parts[0].querySelector('.ui-chip').className, 'ui-chip ui-chip--bad');
    assert.equal(down.sources[0].tone, 'bad');
  } finally { dom.uninstall(); }
});

test('Network: the internet is the faceplate; unknown is never OK; ad blocking is a row with a lamp', async () => {
  const dom = install();
  try {
    const { internetPlate, networkSources, adBlocking } = await import('../hub/static/js/network.js');
    const ok = internetPlate({ status: 'ok', orbi_ms: 2, wan_ms: 9.34, dns_ms: 5, orbi_down_mbps: 63, orbi_up_mbps: null });
    assert.equal(text(ok.querySelector('.ui-readout')), '9.3 ms');
    assert.equal(ok.querySelector('.ui-chip').className, 'ui-chip ui-chip--ok');
    assert.deepEqual(ok.querySelectorAll('dt').map(text), ['In use, down']);
    for (const net of [null, { status: 'unknown', wan_ms: 9 }, { status: 'ok' }]) {
      const p = internetPlate(net);
      assert.equal(p.querySelector('.ui-chip').className, 'ui-chip ui-chip--unknown');
      assert.equal(text(p.querySelector('.ui-readout')), '—');
    }
    assert.equal(internetPlate({ status: 'bad', orbi_ms: 2, wan_ms: null }).querySelector('.ui-chip').className, 'ui-chip ui-chip--bad');
    assert.deepEqual(networkSources(null, null).map((s) => s.tone), ['bad', 'bad']);
    assert.equal(adBlocking({ available: true, protection: false, blocked: 0, queries: 12 }).word, 'Off');
    assert.equal(adBlocking(null).tone, 'unknown');
  } finally { dom.uninstall(); }
});

test('Documents: answering, down, signed out and a failed search each say so on the faceplate and the sources line', async () => {
  const dom = install();
  try {
    const { documentsPlate } = await import('../hub/static/js/documents.js');
    const cases = [[{ available: true, results: [] }, 'ok'], [{ available: false }, 'bad'], [{ signedOut: true }, 'unknown'], [null, 'unknown']];
    for (const [d, tone] of cases) {
      const v = documentsPlate(d);
      assert.equal(v.plate.getAttribute('aria-label'), 'Paperless, on the PC');
      assert.equal(v.plate.querySelector('.ui-chip').className, `ui-chip ui-chip--${tone}`);
      assert.equal(v.sources[0].tone, tone);
    }
  } finally { dom.uninstall(); }
});
