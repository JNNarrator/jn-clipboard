import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Accessibility } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isMacPlatform } from "../lib/platform";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { openedSettingsFromHere, requestMacAccessibility } from "../lib/macAccessibility";

/**
 * The quiet reminder after the first-run dialog was dismissed.
 *
 * The dialog catches the user once, at launch. If they chose "Later" there,
 * nothing else in the app explains why ⌘V is suddenly manual — until they land
 * in settings, which is exactly the place people stop looking once things
 * "mostly work". This banner sits at the top of the list instead: one line,
 * one button, dismissable for the session only. It reappears next launch
 * while the permission is still missing, because the underlying thing it
 * warns about has not gone away.
 */
export default function MacAccessibilityBanner({ ready, t }: {
  ready: boolean;
  t: (key: string) => string;
}) {
  const [needed, setNeeded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ready || !isTauriRuntime() || !isMacPlatform()) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    const check = () => {
      void invoke<boolean>("check_macos_permissions").then(granted => {
        if (alive) setNeeded(!granted);
      }).catch(() => undefined);
    };
    check();
    // Cheap: only while the permission is missing, and only while the app
    // fronts. The dialog's prompt already covers the settings trip.
    void listen("accessibility-permission-required", () => {
      if (alive) setDismissed(false);
      check();
    }).then(unlisten => {
      if (alive) dispose = unlisten;
      else unlisten();
    }).catch(() => undefined);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      dispose?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [ready]);

  if (!needed || dismissed) return null;

  return (
    <button
      type="button"
      className="accessibility-banner"
      onClick={() => {
        void requestMacAccessibility().catch(() => undefined);
      }}
      aria-live="polite"
    >
      <Accessibility size={13} aria-hidden="true" />
      <span className="accessibility-banner-text">
        {openedSettingsFromHere()
          ? t("accessibility_banner_restart")
          : t("accessibility_banner_text")}
      </span>
      <span
        role="button"
        tabIndex={0}
        className="accessibility-banner-close"
        aria-label={t("dismiss")}
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            setDismissed(true);
          }
        }}
      >
        ×
      </span>
    </button>
  );
}
