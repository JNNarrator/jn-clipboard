/**
 * Manual sync from the header.
 *
 * Two buttons live behind one trigger: push what this device changed, or pull
 * what the others did. Neither is needed for correctness — both platforms sync
 * on a 30 second loop — they exist so someone who has just edited a clip on the
 * phone does not have to wait out a tick to see it here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { SyncOutcome } from "../../web/sync/engine";
import { formatError } from "../lib/errorMessage";

export type SyncDirection = "push" | "pull";

interface Options {
  t: (key: string) => string;
  pushToast: (message: string, duration?: number) => void;
}

/** Kept in step with `src/web/sync/token.ts`. */
const TOKEN_STORAGE_KEY = "jn-token";
const WEB_ENABLED_KEY = "web.sync_enabled";

/**
 * Whether the header should offer the buttons at all.
 *
 * A build with no server configured should not show a control that can only
 * fail, and the answer changes at runtime (the user signs in, or signs out), so
 * it is read from the same source the panels write to.
 */
async function readAvailable(): Promise<boolean> {
  try {
    if (__WEB_TARGET__) {
      const settings = await invoke<Record<string, string>>("get_settings");
      return settings[WEB_ENABLED_KEY] === "true" && !!localStorage.getItem(TOKEN_STORAGE_KEY);
    }
    const status = await invoke<{ configured: boolean }>("get_jnclub_sync_status");
    return !!status?.configured;
  } catch {
    return false;
  }
}

export function useManualSync({ t, pushToast }: Options) {
  const [busy, setBusy] = useState<SyncDirection | null>(null);
  const [available, setAvailable] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readAvailable().then((next) => {
        if (!cancelled) setAvailable(next);
      });
    };
    refresh();

    if (__WEB_TARGET__) {
      // The other tab finishes the SSO round trip; this one has to notice.
      window.addEventListener("focus", refresh);
      return () => {
        cancelled = true;
        window.removeEventListener("focus", refresh);
      };
    }
    // Signing in or out nudges the engine, which answers with its new status.
    const pending = listen("jnclub-sync-status", refresh);
    return () => {
      cancelled = true;
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  const run = useCallback(
    async (direction: SyncDirection) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(direction);
      try {
        const outcome = __WEB_TARGET__
          ? await (await import("../../web/sync/manual")).runWebSync(direction)
          : await invoke<SyncOutcome>("jnclub_sync_now", { direction });

        const moved = direction === "push" ? (outcome?.pushed ?? 0) : (outcome?.pulled ?? 0);
        if (moved > 0) {
          pushToast(
            t(direction === "push" ? "sync_pushed" : "sync_pulled").replace("{n}", String(moved)),
          );
        } else {
          // "Nothing happened" is the usual answer; say it quietly rather than
          // leaving the click looking broken.
          pushToast(
            t(direction === "push" ? "sync_nothing_to_push" : "sync_nothing_to_pull"),
            1800,
          );
        }
      } catch (error) {
        // The browser build reports "not signed in" as a locale key, because
        // the module that raises it has no translator of its own.
        const message = (error as Error)?.message;
        pushToast(
          message?.startsWith("web_sync_") ? t(message) : formatError(error, t),
          4000,
        );
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [pushToast, t],
  );

  return { busy, available, run };
}
