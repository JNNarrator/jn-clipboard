/**
 * The browser cannot replace itself.
 *
 * A page that received a new build from its own server is already running the
 * new build after a reload, so `check()` reports "nothing to install" and the
 * UI falls back to the version comparison against GitHub.
 */
export async function check(): Promise<null> {
  return null;
}
