export const isTauriRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
  return !!(w.__TAURI__ || w.__TAURI_INTERNALS__ || w.__TAURI_IPC__);
};

/**
 * Whether `invoke` reaches a real command backend.
 *
 * True inside the native shell, and also in the browser build, which aliases
 * `@tauri-apps/api/core` to its own dispatch table and marks itself with
 * `__TIEZ_WEB_BACKEND__`. Use this — not {@link isTauriRuntime} — to decide
 * whether to *load data*. Keep `isTauriRuntime` for capabilities that only a
 * native window has: dragging, tray, global hotkeys, OS permissions, updates.
 */
export const hasCommandBackend = (): boolean => {
  if (isTauriRuntime()) return true;
  if (typeof window === "undefined") return false;
  return (window as unknown as { __TIEZ_WEB_BACKEND__?: unknown }).__TIEZ_WEB_BACKEND__ === true;
};

