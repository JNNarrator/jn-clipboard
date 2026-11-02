/**
 * `relaunch()` has no browser equivalent; a reload is the closest thing.
 */
export async function relaunch(): Promise<void> {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
