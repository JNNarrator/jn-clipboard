import { invoke } from "@tauri-apps/api/core";

let systemPromptRequested = false;
let settingsVisited = false;

/**
 * "Authorize" for the macOS Accessibility permission.
 *
 * The first time, only macOS's own prompt is shown: it adds jn-clipboard to the
 * Accessibility list and has its own "Open System Settings" button. Opening
 * Settings at the same time put the Settings window over that prompt before
 * the user could answer it. macOS shows the prompt once; if no prompt took
 * focus, or on later clicks, Settings is opened directly.
 */
export const requestMacAccessibility = async (): Promise<void> => {
  if (!systemPromptRequested) {
    systemPromptRequested = true;
    const granted = await invoke<boolean>("request_macos_permissions");
    if (granted) return;
    // Opening Settings under the system prompt used to bury it, so wait for
    // the user to answer before falling back to Settings.
    const answered = await waitForFocus(6000);
    if (!answered) return; // the prompt is still up
  }
  await invoke("open_macos_accessibility_settings");
  await waitForBlur(6000);
  settingsVisited = true;
};

/**
 * True when the system settings page was opened from here and the user has
 * since left it. The grant lands while they are there, so anything asked
 * before that is stale — callers use this to explain the retry instead of
 * repeating a warning that is about to go away.
 */
export const openedSettingsFromHere = (): boolean => settingsVisited;

const waitForFocus = async (timeout: number): Promise<boolean> => {
  if (document.hasFocus()) return true;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("focus", onFocus);
      resolve(false);
    }, timeout);
    const onFocus = () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      resolve(true);
    };
    window.addEventListener("focus", onFocus);
  });
};

const waitForBlur = async (timeout: number): Promise<void> => {
  if (!document.hasFocus()) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      resolve();
    }, timeout);
    const onBlur = () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
      resolve();
    };
    window.addEventListener("blur", onBlur);
  });
};
