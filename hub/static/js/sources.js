// The sources line at the foot of every page (A7 P1, P8): each source the page reads, with its lamp and, when it isn't
// answering or is old, the phrase-table words. A page sets state.sources = [{name, tone, word?}] after each load; main.js
// draws it under the page. No list means no line, never an empty "Sources:".
import { h } from "./core.js";

const TONES = new Set(["ok", "warn", "bad", "unknown"]);

// Only well-formed entries: a name, a known tone (anything else is "unknown": not answering is never shown as fine).
export function sourceEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.name === "string" && s.name.trim())
    .map((s) => ({ name: s.name.trim(), tone: TONES.has(s.tone) ? s.tone : "unknown", word: typeof s.word === "string" ? s.word.trim() : "" }));
}

export function renderSources(el, list) {
  if (!el) return;
  const items = sourceEntries(list);
  el.hidden = !items.length;
  el.replaceChildren(...(items.length ? [h("span", {}, "Sources:"), ...items.map(({ name, tone, word }) =>
    h("span", { class: `ui-chip ui-chip--${tone}` }, word ? `${name}: ${word}` : name))] : []));
}
