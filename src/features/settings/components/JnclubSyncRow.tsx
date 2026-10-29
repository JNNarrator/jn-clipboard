// The whole cross-device sync UI: one line.
//
// There is deliberately no switch and no server field. The server is a build
// constant (this is a personal fork, the origin never changes), and "synced or
// not" is the only state a user needs to see. Signing in is the only action,
// and it happens in the system browser — the app never handles the password.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatError } from "../../../shared/lib/errorMessage";

interface SyncStatusPayload {
    configured: boolean;
    lastSeq: number;
    lastSyncAt: number | null;
    lastError: string | null;
}

interface JnclubSyncRowProps {
    t: (key: string) => string;
}

const relative = (t: (key: string) => string, at: number | null) => {
    if (!at) return t("jnclub_sync_never");
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return t("jnclub_sync_just_now");
    if (minutes < 60) return t("jnclub_sync_minutes_ago").replace("{n}", String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("jnclub_sync_hours_ago").replace("{n}", String(hours));
    return new Date(at).toLocaleDateString();
};

const JnclubSyncRow = ({ t }: JnclubSyncRowProps) => {
    const [status, setStatus] = useState<SyncStatusPayload | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        invoke<SyncStatusPayload>("get_jnclub_sync_status").then(setStatus).catch(() => {});
        const unlisten = listen<SyncStatusPayload>("jnclub-sync-status", (event) => {
            setStatus(event.payload);
        });
        return () => {
            void unlisten.then((off) => off());
        };
    }, []);

    const signIn = async () => {
        setBusy(true);
        setError(null);
        try {
            setStatus(await invoke<SyncStatusPayload>("jnclub_sync_login"));
        } catch (err) {
            setError(formatError(String(err), t));
        } finally {
            setBusy(false);
        }
    };

    const signOut = async () => {
        setBusy(true);
        setError(null);
        try {
            setStatus(await invoke<SyncStatusPayload>("jnclub_sync_sign_out"));
        } catch (err) {
            setError(formatError(String(err), t));
        } finally {
            setBusy(false);
        }
    };

    const configured = status?.configured ?? false;
    const failed = Boolean(error ?? status?.lastError);

    return (
        <>
            <div className="setting-item">
                <div className="item-label-group">
                    <span className="item-label">{t("jnclub_sync_title")}</span>
                    <span className="settings-panel-meta">
                        {configured
                            ? t("jnclub_sync_state_on").replace("{when}", relative(t, status?.lastSyncAt ?? null))
                            : t("jnclub_sync_state_off")}
                    </span>
                </div>
                <button
                    type="button"
                    className="settings-action-button settings-action-button--small"
                    onClick={configured ? signOut : signIn}
                    disabled={busy}
                >
                    {busy
                        ? t("jnclub_sync_signing_in")
                        : configured ? t("jnclub_sync_sign_out") : t("jnclub_sync_sign_in")}
                </button>
            </div>
            {failed && (
                <div className="settings-panel-meta is-error">
                    {formatError(String(error ?? status?.lastError), t)}
                </div>
            )}
        </>
    );
};

export default JnclubSyncRow;
