// Home & network › Devices: the lights, plugs, switches, fans and laundry the hub can see, and Homebridge to change them.
import { h } from "./core.js";
import * as controls from "./control.js";
import { fillNeedsHere, needsHere } from "./page-parts.js";
import { openInRow } from "./section-links.js";

export const every = controls.every;

export function mount(state) {
  state.needs = needsHere();
  state.devices = { root: h("div"), context: state.context, needs: state.needs };
  controls.mount(state.devices);
  state.root.append(state.devices.root, openInRow("lights"));
}

export async function load(state) {
  await Promise.all([controls.load(state.devices), fillNeedsHere(state.needs, "/devices")]);
  state.sources = state.devices.sources;
}
