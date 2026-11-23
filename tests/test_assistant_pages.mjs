// A27 step 1, Pi Hub's half (docs/superpowers/plans/2026-11-16-a27-flatter-assistant-nav.md; kit 2.26.0): the Assistant's
// five tools are cards of Developer tools, its admin pages are cards of one System page, and every retired id still
// resolves. Pi Hub draws none of the Assistant's rows itself (site.js keeps system "hub"); it opens the Assistant at a
// Local AI view, /assistant?to=<view>, so an old address keeps working while its view is still in the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, page, redirect } from '../hub/static/ui/pages.js';
import { SITE } from '../hub/static/js/site.js';
import { siteMap } from '../hub/static/js/map.js';
import { ASSISTANT_PAGES, addressFor, frameSrc } from '../hub/static/js/assistant.js';
import { ASSISTANT_URL, resolveLink } from '../hub/static/js/sections.js';

const ADMIN = ['status', 'models', 'developer-tools', 'assistant-settings', 'audit-log'];
// Each retired id as kit 2.25.0 listed it: its address and the Local AI view that address opened.
const RETIRED = [
  ['assistant-status', '/assistant/status', 'status'],
  ['tools-files', '/assistant/tools/files', 'workbench'],
  ['tools-repository', '/assistant/tools/repository', 'repoTools'],
  ['tools-powershell', '/assistant/tools/powershell', 'powershell'],
  ['tools-browser', '/assistant/tools/browser', 'actions'],
  ['tools-n8n', '/assistant/tools/n8n', 'automations'],
  ['changes-in-progress', '/assistant/changes/in-progress', 'inProgress'],
  ['changes-shipped', '/assistant/changes/shipped', 'shipped'],
];
// Every Local AI view a live row or card opens.
const VIEWS = new Set(PAGES.filter((p) => p.system === 'assistant').flatMap((p) => [p.view, ...(p.cards || []).map((c) => c.view)]).filter(Boolean));

test('A27 D1, D3: no tool or admin page is a tab, and Pi Hub draws no Assistant row in a strip, ⌘K or the Site map', () => {
  const tabs = PAGES.filter((p) => p.system === 'assistant' && p.reach.includes('tabs')).map((p) => p.id);
  assert.deepEqual(tabs.filter((id) => ADMIN.includes(id) || id.startsWith('tools-')), []);
  assert.deepEqual(PAGES.filter((p) => p.parent === 'assistant-system').map((p) => [p.id, p.role, p.reach[0]]),
    ADMIN.map((id) => [id, 'detail', 'card:assistant-system']), 'System › Assistant opens its admin pages from cards');
  assert.deepEqual(page('developer-tools').cards.map((c) => c.id), ['files', 'repository', 'powershell', 'browser', 'n8n']);
  assert.ok(SITE.rows.every((p) => p.system === 'hub'));
  const strips = SITE.areas.map((a) => SITE.stripFor(SITE.page(a.landing).path)).filter(Boolean).flatMap((s) => s.items);
  const drawn = [...strips, ...SITE.entries('palette'), ...SITE.entries('map')].map((e) => e.href);
  assert.deepEqual(drawn.filter((href) => href.startsWith('/assistant')), []);
  // The Site map's Assistant group is its five areas, each one click from /assistant, none a tool or admin page.
  const group = siteMap().find((g) => g.key === 'assistant');
  assert.deepEqual(group.pages.map((p) => p.label), ['Home', 'Work', 'Projects', 'Improve', 'System']);
  assert.deepEqual(group.pages.map((p) => p.href), ASSISTANT_PAGES.map(([to]) => addressFor(to)));
});

test('A27: every Assistant view Pi Hub links to is a live row or card, never a retired id', () => {
  for (const [to, label] of ASSISTANT_PAGES.filter(([to]) => to)) {
    assert.ok(VIEWS.has(to), `${label}: ${to} is a view in the list`);
    assert.equal(redirect(to), null, `${label}: ${to} is not a retired id`);
  }
});

test('A27: no page Pi Hub draws is more than two levels inside its area', () => {
  const depth = (p) => (p.parent ? 1 + depth(SITE.page(p.parent)) : 1);
  assert.deepEqual(SITE.rows.filter((p) => depth(p) > 2).map((p) => p.id), []);
});

for (const [id, path, view] of RETIRED) {
  test(`A27: the retired ${id} still resolves, at ${path}, to the view it opened`, () => {
    assert.equal(page(id), null, `${id} is no longer a page`);
    const r = redirect(id);
    assert.ok(r, `${id} is in the redirects`);
    const to = page(r.to);
    assert.ok(to, `${id} redirects to a live page`);
    if (r.card) {
      const card = (to.cards || []).find((c) => c.id === r.card);
      assert.deepEqual([to.id, card?.path, card?.view], ['developer-tools', path, view]);
    } else if (r.stage) {
      assert.deepEqual([to.id, r.path, r.stage], ['changes', path, path.split('/').pop()]);
    } else {
      assert.deepEqual([to.path, to.view], [path, view]);
    }
    // Pi Hub's way in: a Needs-you or ⌘K link names the view, and /assistant frames Local AI at that view.
    assert.equal(resolveLink(`tool:assistant/#${view}`), addressFor(view));
    assert.equal(frameSrc(`?to=${view}`), `${ASSISTANT_URL}#${view}`);
  });
}
