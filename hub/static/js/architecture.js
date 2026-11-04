// Architecture page: embeds System Atlas seamlessly into Pi Hub's shell.
import { h } from "./core.js";

export const every = 0;

export function mount(state) {
  const repo = state.context.get("repo") || "pi-hub";
  const commit = state.context.get("commit") || "";
  const query = new URLSearchParams();
  if (repo) query.set("repo", repo);
  if (commit) query.set("commit", commit);
  const qStr = query.toString();
  const src = `https://assistant.rahe-home.duckdns.org/#architecture${qStr ? "?" + qStr : ""}`;

  state.frame = h("iframe", {
    src,
    class: "assistant-frame",
    title: "System Atlas Architecture",
    allow: "clipboard-read; clipboard-write",
  });

  state.root.append(
    h("div", { class: "assistant-view-wrap" }, state.frame)
  );
}

export function load() {
  // Subscribed frame manages its own hash / route changes
}

export function leave() {
  // Nothing to cleanup
}
