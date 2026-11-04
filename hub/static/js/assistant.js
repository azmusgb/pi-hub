// Assistant page: embeds Local AI seamlessly into Pi Hub's shell.
import { h } from "./core.js";

export const every = 0; // The embedded app manages its own polling/events

export function mount(state) {
  state.frame = h("iframe", {
    src: "https://assistant.rahe-home.duckdns.org/#ask",
    class: "assistant-frame",
    title: "Local AI Assistant",
    allow: "clipboard-read; clipboard-write",
  });

  state.root.append(
    h("div", { class: "assistant-view-wrap" }, state.frame)
  );
}

export function load(state) {
  // Sync context or search params if passed (e.g. ?context=...)
  const ctx = state.context.get("context");
  if (ctx && state.frame) {
    try {
      state.frame.contentWindow?.postMessage({ type: "assistant-context", context: ctx }, "*");
    } catch {
      // Cross-origin message safety
    }
  }
}

export function leave(state) {
  // Nothing to cleanup
}
