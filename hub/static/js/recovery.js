// Recheck recovery without repeating a command. Dependencies are injectable for tests.
export const VERIFIABLE = new Set(["restart:plex", "restart:homebridge", "remount:movies"]);
export async function verifyRecovery(name, { check, active = () => true,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 3 } = {}) {
  let result = { state: "unavailable", message: "Recovery could not be checked.",
    next_step: "Check the connection, then check recovery again without repeating the fix." };
  for (let i = 0; i < attempts; i++) {
    if (!active()) return { state: "cancelled" };
    try { result = await check(name); } catch { /* Keep the last useful result. */ }
    if (!active()) return { state: "cancelled" };
    if (["recovered", "not_supported", "needs_setup"].includes(result.state)) return result;
    if (i < attempts - 1) await wait(2000);
  }
  return result;
}
