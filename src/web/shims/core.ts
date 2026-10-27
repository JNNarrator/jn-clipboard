/**
 * Browser stand-in for `@tauri-apps/api/core`.
 *
 * `invoke` is the entire native boundary in this app, so swapping it is enough
 * for the shared UI to run against the web backend in `src/web/backend`.
 *
 * The module marks itself with `__TIEZ_WEB_BACKEND__` rather than faking
 * `__TAURI_INTERNALS__`: shared code that only needs "is there a backend to call"
 * checks `hasCommandBackend()`, while genuinely native features (window
 * dragging, tray, hotkeys) keep reading `isTauriRuntime()` and stay off.
 */
export { invokeCommand as invoke } from "../backend/commands";

if (typeof window !== "undefined") {
  (window as unknown as { __TIEZ_WEB_BACKEND__?: boolean }).__TIEZ_WEB_BACKEND__ = true;
}

export type InvokeArgs = Record<string, unknown>;

/** Exported by Tauri 2 but unused here; kept so imports cannot fail to resolve. */
export function convertFileSrc(filePath: string): string {
  return filePath;
}

export function isTauri(): boolean {
  return false;
}
