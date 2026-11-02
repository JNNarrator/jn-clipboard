/**
 * Update checking, and installing in place on the desktop.
 *
 * Two paths, because they can do different things:
 *
 * - Desktop asks the updater plugin, which downloads the signed bundle the
 *   release workflow attaches and swaps it in. The alternative — open a web
 *   page, download a dmg, drag it over the old app — is what this replaces.
 * - The browser build cannot replace itself, so it only asks GitHub what the
 *   latest tag is and points at the release page.
 */
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
    currentVersion: string;
    latestVersion: string | null;
    available: boolean;
    releaseUrl: string | null;
    notes: string | null;
    publishedAt: string | null;
}

export type UpdatePhase =
    | "idle"
    | "checking"
    | "ready"
    | "downloading"
    | "installing"
    | "up-to-date"
    | "error";

interface UpdateCheckState {
    phase: UpdatePhase;
    info: UpdateInfo | null;
    /** 0-100, or null while the endpoint has not reported a length. */
    progress: number | null;
    error: string | null;
}

/** What `check()` from the plugin resolves to, narrowed to what we use. */
interface PluginUpdate {
    version: string;
    currentVersion: string;
    body?: string;
    date?: string;
    downloadAndInstall: (onEvent?: (event: PluginProgressEvent) => void) => Promise<void>;
}

type PluginProgressEvent =
    | { event: "Started"; data: { contentLength?: number } }
    | { event: "Progress"; data: { chunkLength: number } }
    | { event: "Finished" };

const isTauri = () =>
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const RELEASE_TAG_URL = "https://github.com/JNNarrator/jn-clipboard/releases/tag/v";

/**
 * Finds out whether there is a newer build.
 *
 * Never installs by itself: pulling tens of megabytes because someone clicked
 * a footer button without reading it would be rude, so the caller shows what
 * is available and install is a second, informed click.
 */
export function useUpdateCheck() {
    const [state, setState] = useState<UpdateCheckState>({
        phase: "idle",
        info: null,
        progress: null,
        error: null,
    });
    // The plugin returns a handle that must survive until install(); keeping it
    // in state would re-render the tree on every download chunk.
    const [pending, setPending] = useState<PluginUpdate | null>(null);

    const check = useCallback(async (): Promise<UpdateCheckState> => {
        setState((prev) =>
            prev.phase === "checking" || prev.phase === "downloading" || prev.phase === "installing"
                ? prev
                : { ...prev, phase: "checking", error: null },
        );
        try {
            if (isTauri()) {
                const { check: pluginCheck } = await import("@tauri-apps/plugin-updater");
                const update = (await pluginCheck()) as PluginUpdate | null;
                if (!update) {
                    setPending(null);
                    const idle: UpdateCheckState = {
                        phase: "up-to-date",
                        info: null,
                        progress: null,
                        error: null,
                    };
                    setState(idle);
                    return idle;
                }
                setPending(update);
                const ready: UpdateCheckState = {
                    phase: "ready",
                    info: {
                        currentVersion: update.currentVersion,
                        latestVersion: update.version,
                        available: true,
                        releaseUrl: `${RELEASE_TAG_URL}${update.version}`,
                        notes: update.body ?? null,
                        publishedAt: update.date ?? null,
                    },
                    progress: null,
                    error: null,
                };
                setState(ready);
                return ready;
            }

            const info = await invoke<UpdateInfo>("check_update");
            const next: UpdateCheckState = {
                phase: info.available ? "ready" : "up-to-date",
                info,
                progress: null,
                error: null,
            };
            setState(next);
            return next;
        } catch (error) {
            const failed: UpdateCheckState = {
                phase: "error",
                info: null,
                progress: null,
                error: String(error),
            };
            setState(failed);
            return failed;
        }
    }, []);

    /**
     * Downloads and installs, reporting progress.
     *
     * Does not restart: the caller decides when, because a relaunch in the
     * middle of a paste is worse than a window that is one version stale.
     */
    const install = useCallback(async (): Promise<UpdateCheckState> => {
        if (!pending) return { phase: "error", info: null, progress: null, error: "no update pending" };
        setState((prev) => ({ ...prev, phase: "downloading", progress: 0, error: null }));
        try {
            let total = 0;
            let received = 0;
            await pending.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    total = event.data.contentLength ?? 0;
                } else if (event.event === "Progress") {
                    received += event.data.chunkLength;
                    const next =
                        total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null;
                    // Only repaint on a whole-percent change; the events arrive
                    // far more often than the bar can usefully move.
                    setState((prev) => (prev.progress === next ? prev : { ...prev, progress: next }));
                } else {
                    setState((prev) => ({ ...prev, phase: "installing", progress: 100 }));
                }
            });
            setPending(null);
            const done: UpdateCheckState = { phase: "installing", info: null, progress: 100, error: null };
            setState(done);
            return done;
        } catch (error) {
            const failed: UpdateCheckState = {
                phase: "error",
                info: null,
                progress: null,
                error: String(error),
            };
            setState(failed);
            return failed;
        }
    }, [pending]);

    const restart = useCallback(async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
    }, []);

    const busy =
        state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";

    return {
        ...state,
        busy,
        /** Kept for callers that only care whether a check is under way. */
        checking: state.phase === "checking",
        canInstall: !!pending && isTauri(),
        check,
        install,
        restart,
    };
}
