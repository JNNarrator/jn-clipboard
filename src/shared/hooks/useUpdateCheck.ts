import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
    currentVersion: string;
    latestVersion: string | null;
    available: boolean;
    releaseUrl: string | null;
    notes: string | null;
    publishedAt: string | null;
}

interface UpdateCheckState {
    checking: boolean;
    info: UpdateInfo | null;
    error: string | null;
}

/**
 * Asks the backend whether GitHub has a newer release.
 *
 * Deliberately manual: GitHub allows 60 unauthenticated calls an hour per IP,
 * so the settings footer offers a button instead of polling. The one automatic
 * call happens at launch and lives in App.tsx.
 */
export function useUpdateCheck() {
    const [state, setState] = useState<UpdateCheckState>({
        checking: false,
        info: null,
        error: null
    });
    const inFlight = useRef(false);

    const check = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setState((prev) => ({ ...prev, checking: true, error: null }));
        try {
            const info = await invoke<UpdateInfo>("check_update");
            setState({ checking: false, info, error: null });
        } catch (error) {
            setState({ checking: false, info: null, error: String(error) });
        } finally {
            inFlight.current = false;
        }
    }, []);

    return { ...state, check };
}
