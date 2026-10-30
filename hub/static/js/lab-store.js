// Print Lab v3 state boundary.
//
// The legacy notebook still owns the fetch/action details for now, but renderers no
// longer watch and rewrite the DOM. They subscribe to this small model boundary.
// Assignments to state.currentData/currentRequests are coalesced into one microtask,
// so an authoritative notebook render completes before additive views render.

export const LAB_PHASE = Object.freeze({
  BOOTING: "booting",
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  AUTH_REQUIRED: "auth_required",
  DEGRADED: "degraded",
  OFFLINE: "offline",
  ERROR: "error",
});

const VALID_PHASES = new Set(Object.values(LAB_PHASE));

export function createLabStore(initial = {}, schedule = (fn) => queueMicrotask(fn)) {
  let phase = VALID_PHASES.has(initial.phase) ? initial.phase : LAB_PHASE.BOOTING;
  let data = initial.data ?? null;
  let requests = Array.isArray(initial.requests) ? initial.requests : [];
  let error = initial.error ?? null;
  let revision = 0;
  let queued = false;
  const listeners = new Set();

  const snapshot = () => ({ phase, data, requests, error, revision });
  const notify = () => {
    if (queued) return;
    queued = true;
    schedule(() => {
      queued = false;
      const value = snapshot();
      for (const listener of [...listeners]) listener(value);
    });
  };
  const changed = () => { revision += 1; notify(); };

  const store = {
    snapshot,
    subscribe(listener, { immediate = false } = {}) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      if (immediate) listener(snapshot());
      return () => listeners.delete(listener);
    },
    transition(next, nextError = null) {
      if (!VALID_PHASES.has(next)) throw new Error(`Unknown Print Lab phase: ${next}`);
      if (phase === next && error === nextError) return false;
      phase = next;
      error = nextError;
      changed();
      return true;
    },
    setData(next) {
      if (data === next) return false;
      data = next ?? null;
      if (data) { phase = LAB_PHASE.READY; error = null; }
      changed();
      return true;
    },
    setRequests(next) {
      const value = Array.isArray(next) ? next : [];
      if (requests === value) return false;
      requests = value;
      changed();
      return true;
    },
    markLoading() { return store.transition(LAB_PHASE.LOADING); },
    markEmpty() { return store.transition(LAB_PHASE.EMPTY); },
    markAuthRequired(err = null) { return store.transition(LAB_PHASE.AUTH_REQUIRED, err); },
    markDegraded(err = null) { return store.transition(LAB_PHASE.DEGRADED, err); },
    markOffline(err = null) { return store.transition(LAB_PHASE.OFFLINE, err); },
    markError(err = null) { return store.transition(LAB_PHASE.ERROR, err); },
  };
  return store;
}

export function attachLabStore(state, schedule) {
  if (!state) return null;
  if (state.labStore) return state.labStore;

  let currentData = state.currentData ?? null;
  let currentRequests = Array.isArray(state.currentRequests) ? state.currentRequests : [];
  const store = createLabStore({
    phase: currentData ? LAB_PHASE.READY : LAB_PHASE.LOADING,
    data: currentData,
    requests: currentRequests,
  }, schedule);

  Object.defineProperty(state, "currentData", {
    configurable: true,
    enumerable: true,
    get: () => currentData,
    set(value) {
      currentData = value ?? null;
      store.setData(currentData);
    },
  });
  Object.defineProperty(state, "currentRequests", {
    configurable: true,
    enumerable: true,
    get: () => currentRequests,
    set(value) {
      currentRequests = Array.isArray(value) ? value : [];
      store.setRequests(currentRequests);
    },
  });

  state.labStore = store;
  state.labPhase = (phase, err = null) => store.transition(phase, err);
  return store;
}
