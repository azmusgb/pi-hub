// Home & network › Devices: the lights, plugs, switches, fans and laundry the hub can see, and Homebridge to change them.
import { h } from "./core.js";
import * as controls from "./control.js";
import { openInRow } from "./section-links.js";

export const every = controls.every;

export function mount(state) {
  state.devices = { root: h("div"), context: state.context };
  controls.mount(state.devices);
  state.root.append(state.devices.root, openInRow("network", ["devices"]));
}

export async function load(state) {
  await controls.load(state.devices);
}
