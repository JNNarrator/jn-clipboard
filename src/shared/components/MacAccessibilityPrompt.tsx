import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isMacPlatform } from "../lib/platform";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { openedSettingsFromHere, requestMacAccessibility } from "../lib/macAccessibility";
import ConfirmDialog from "./ConfirmDialog";

export default function MacAccessibilityPrompt({ ready, theme, t, pushToast }: {
  ready: boolean;
  theme: string;
  t: (key: string) => string;
  pushToast: (message: string, duration?: number) => number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // macOS answers the trust question from a cache taken when the process
  // started, so a switch flipped while the app runs is not visible to us. Once
  // the user has been to System Settings, restarting is the way through.
  const [needsRestart, setNeedsRestart] = useState(false);
  useEffect(() => {
    if (!ready || !isTauriRuntime() || !isMacPlatform()) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    void invoke<boolean>("check_macos_permissions").then(granted => {
      if (alive && !granted) setOpen(true);
    }).catch(console.error);
    void listen("accessibility-permission-required", () => {
      if (alive) setOpen(true);
    }).then(unlisten => {
      if (alive) dispose = unlisten;
      else unlisten();
    }).catch(console.error);
    return () => { alive = false; dispose?.(); };
  }, [ready]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // Ask the backend to re-read the grant: the answer taken while the dialog
    // opened can predate the switch the user just flipped.
    const check = (settle: boolean) => {
      void invoke<boolean>("check_macos_permissions", { settle }).then(granted => {
        if (!alive) return;
        if (granted) {
          setOpen(false);
          return;
        }
        if (openedSettingsFromHere()) setNeedsRestart(true);
      }).catch(console.error);
    };
    const interval = window.setInterval(() => check(true), 3000);
    const onFocus = () => check(true);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [open]);

  const authorize = async () => {
    setBusy(true);
    try {
      await requestMacAccessibility();
    } catch {
      pushToast(t("accessibility_settings_failed"), 5000);
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    // Someone who has just been through System Settings does not need the
    // same warning again; say why the next copy may still not paste instead.
    if (openedSettingsFromHere()) pushToast(t("accessibility_still_missing"), 7000);
    setOpen(false);
  };

  const restart = () => {
    void invoke("relaunch").catch(console.error);
  };

  return <ConfirmDialog
    open={open}
    title={t("accessibility_permission")}
    message={needsRestart
      ? `${t("accessibility_permission_prompt")}\n\n${t("accessibility_restart_hint")}`
      : t("accessibility_permission_prompt")}
    theme={theme}
    busy={busy}
    confirmLabel={needsRestart ? t("accessibility_restart_app") : t("accessibility_go_authorize")}
    cancelLabel={t("accessibility_permission_later")}
    onConfirm={needsRestart ? restart : () => { void authorize(); }}
    onClose={later}
  />;
}
