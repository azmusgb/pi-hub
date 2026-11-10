// CSS review, 4 Nov 2026: what the shell's stylesheets must keep. Focus you can see, error text you can read in both
// themes, the Print lab's buttons styled, 44 px targets on a phone, one owner for .timeline and .meter, and a camera
// view that fits the visible screen on an iPhone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL(`../hub/static/${f}`, import.meta.url), 'utf8');
const ALL = ['app.css', 'pages.css', 'enhance.css', 'components.css', 'home.css', 'lab.css'];

test('the focus ring is solid accent, not the 10% wash', () => {
  const ring = css('app.css').match(/--ring:\s*([^;]+);/)[1];
  assert.doesNotMatch(ring, /accent-soft/);
  assert.match(ring, /var\(--accent\)/);
});

test('error text uses the error colour, never the ink meant for text on a red fill', () => {
  for (const f of ALL) {
    for (const line of css(f).split('\n')) {
      assert.doesNotMatch(line, /(?<![-\w])color:\s*var\(--bad-ink/, `${f}: ${line.trim()}`);
    }
  }
});

test("the Print lab's button classes are styled, at least 44 px tall", () => {
  const lab = css('lab.css');
  for (const c of ['btn-primary', 'btn-outline', 'btn-subtle']) assert.match(lab, new RegExp(`\\.${c}\\b[^{]*\\{`), c);
  assert.match(lab, /\.btn-primary,[\s\S]{0,120}\{[^}]*min-height:\s*44px/);
});

test('on a phone the page strips, Search, Restart, the theme link and the Site map links are 44 px targets', () => {
  const touch = [...css('enhance.css').matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  // A10 D2 (plan decision 4): a target's size follows the pointer, not the window's width, so a touch screen of any
  // width gets 44 px, and the rail's own links are in the list.
  assert.doesNotMatch(css('enhance.css'), /@media \(max-width: 860px\), \(pointer: coarse\)/);
  // The tabs are the kit's ui-tabs (2.16), 48 px everywhere, so they need no touch rule here (A23 P4).
  for (const sel of ['.top-cmd-btn', '.service-list .status-side .btn', '.link-btn', '.more-group > h2 a', '.rail a[data-page]', '#theme-btn']) {
    assert.ok(touch.includes(sel), `${sel} is in a touch block`);
  }
});

test("Home's \"other things are fine\" disclosure and the rack's links are 44 px targets everywhere", () => {
  const home = css('home-dashboard.css');
  for (const sel of ['.hd-others__summary', '.hd-unit__go']) {
    assert.match(home, new RegExp(`${sel.replace('.', '\\.')} \\{[^}]*min-height: 44px`), sel);
  }
});

test('.timeline and the pill .meter each have one owner', () => {
  assert.doesNotMatch(css('enhance.css'), /^\.timeline\b/m, 'the movies drive timeline is styled by pages.css only');
  assert.match(css('pages.css'), /\.meter:not\(:has\(> \.meter-bar\)\)/, 'the pill meter does not catch the bar meter');
});

test('the camera view fits the visible screen, not 100vh', () => {
  const block = css('home.css').match(/\.cam-modal \{[\s\S]*?\.cam-modal-img \{[\s\S]*?\}/)[0];
  assert.doesNotMatch(block, /100vh|100vw/);
});
