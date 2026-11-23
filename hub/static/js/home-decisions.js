// The owner's open decisions in Home's Needs you (amendment A33; plan 2026-11-21-a33-owner-decisions, P2 and decisions
// 3-6). /api/needs carries `decisions` for the owner only (hub/decisions.py attach()); for anyone else the key is
// absent and nothing is drawn, so nothing hints that decisions exist. The kit draws the group
// (ApplianceNeeds.renderDecisions); this file decides what it is given and does the write. Decisions never enter Needs
// you's count, the badge, the wall or the display: they are only drawn here.
import { post } from "./core.js";
import { resolveLink } from "./sections.js";
import { tool } from "../ui/tools.js";

// Where a decision's spec link may point: the hub and the Assistant (the kit's registry addresses) and github.com
// (owner, 23 Nov). hub/decisions.py LINK_HOSTS also takes the Assistant's machine-facing name and IP,
// which no page here links (tests/test_nav_links.mjs); a link to one is not drawn. tests/test_decisions.py keeps this
// list inside LINK_HOSTS.
export const LINK_ORIGINS = [...["hub", "assistant"].map((id) => `https://${tool(id).host}`), "https://github.com"];

// One Home's memory of the group: whether an answer has shown this caller is the owner, the last open list read
// (null: none read), the ids recorded here (a read that left before the write landed doesn't bring them back), the
// answers in flight, and what is drawn.
export function decisionsState() {
  return { owner: false, last: null, recorded: new Set(), busy: 0, node: null, sig: "", drawn: null };
}

const unrecorded = (ds, list) => list.filter((d) => !ds.recorded.has(d?.id));

// What the group shows for one /api/needs answer (`needs` null: the read failed): {list, state}, or null for nothing.
// A failed read is never an empty list: it keeps the last rows read under "Not current", and with none it says the
// decisions couldn't be read (the kit reads "stale" with no rows as "error"). `decisions: null` is the hub saying it
// can't read its table: "error", beside the hub's own Needs item for it.
export function decisionsView(ds, needs) {
  if (!needs) return ds.owner ? { list: unrecorded(ds, ds.last || []), state: "stale" } : null;
  if (!Object.hasOwn(needs, "decisions")) {  // not the owner (or signed out since): nothing, and nothing kept
    Object.assign(ds, { owner: false, last: null });
    return null;
  }
  ds.owner = true;
  const open = needs.decisions?.open;
  if (!Array.isArray(open)) {
    ds.last = null;
    return { list: [], state: "error" };
  }
  for (const id of ds.recorded) if (!open.some((d) => d?.id === id)) ds.recorded.delete(id);
  ds.last = unrecorded(ds, open);
  return ds.last.length ? { list: ds.last, state: "" } : null;
}

// What a drawn group shows, as one string: two reads with the same one draw the same rows.
const signature = (view) => JSON.stringify([view.state, view.list.map((d) => [d.id, d.kind, d.question, d.options,
  d.recommended, d.link])]);

// The answer the hub says it holds for `id`, or false: a reply without one is never taken as recorded. The kit takes
// the recorded row out of the group itself, so the group drawn is now the list without it: the next read, which no
// longer lists it, matches and redraws nothing (the other rows keep a failed note or a half-written answer).
function held(ds, id, d) {
  if (!d || d.id !== id || !d.answered_at || typeof d.answer !== "string" || !d.answer) return false;
  ds.recorded.add(id);
  if (ds.drawn) {
    ds.drawn = { ...ds.drawn, list: ds.drawn.list.filter((x) => x?.id !== id) };
    ds.sig = signature(ds.drawn);
  }
  return d.answer;
}

// The tap's write (plan decision 6). Resolves to the answer the hub holds, shown as "Recorded: …"; resolves false or
// rejects for anything else, so the kit keeps the row and says it wasn't recorded.
// 200: recorded (or the same answer already was: a double tap). 409 with answered_at: answered elsewhere, differently;
// the row leaves and says what was recorded. 409 without: the question changed while shown; nothing is recorded and
// the group is read again. 404, 401/403, 5xx or no answer: the error stands.
export async function answerDecision(ds, id, answer, reload, send = post) {
  ds.busy += 1;
  try {
    return held(ds, id, (await send(`/api/decisions/${encodeURIComponent(id)}/answer`, { answer }))?.decision);
  } catch (e) {
    const d = e?.status === 409 ? e.body?.decision : null;
    if (d?.id !== id) throw e;
    if (d.answered_at) return held(ds, id, d);
    setTimeout(() => reload?.(), 0);  // after the kit has marked the row: the redraw brings the question as it is now
    return false;
  } finally {
    ds.busy -= 1;
  }
}

// The group's node for one /api/needs answer, or null. The same node comes back while an answer is in flight, and
// while what it shows hasn't changed, so a refresh never drops a pending row, a "Not recorded" note, a half-written
// answer or keyboard focus.
export function drawDecisions(ds, needs, reload) {
  const view = decisionsView(ds, needs);
  if (ds.busy && ds.node) return ds.node;
  if (!view) return (ds.node = null);
  const sig = signature(view);
  if (ds.node && sig === ds.sig) return ds.node;
  const frag = globalThis.ApplianceNeeds.renderDecisions(view.list, {
    onAnswer: (id, answer) => answerDecision(ds, id, answer, reload), here: new URL(location.href), resolve: resolveLink,
    allowOrigins: LINK_ORIGINS, ...(view.state ? { state: view.state } : {}),
  });
  Object.assign(ds, { sig, drawn: view, node: frag.firstChild || null });
  for (const a of ds.node?.querySelectorAll("a") || []) if (a.origin === location.origin) a.setAttribute("data-link", "");
  return ds.node;
}
