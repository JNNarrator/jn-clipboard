import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight } from "lucide-react";

interface E2eSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    e2eKey: string;
    saveE2eKey: (value: string) => Promise<void>;
}

/** The shared key that seals MQTT messages and WebDAV files (docs/E2E-ENCRYPTION.md). */
const E2eSettingsGroup = ({ t, collapsed, onToggle, e2eKey, saveE2eKey }: E2eSettingsGroupProps) => {
    const [fingerprint, setFingerprint] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [draftInvalid, setDraftInvalid] = useState(false);
    const [revealed, setRevealed] = useState(false);
    // Rotating or removing the key cuts this device off until every other
    // device changes too, so both take a second click.
    const [armed, setArmed] = useState<"rotate" | "disable" | null>(null);

    useEffect(() => {
        if (!e2eKey) {
            setFingerprint(null);
            return;
        }
        invoke<string | null>("e2e_key_fingerprint", { key: e2eKey }).then(setFingerprint).catch(() => setFingerprint(null));
    }, [e2eKey]);

    const apply = async (value: string) => {
        await saveE2eKey(value);
        setArmed(null);
        setRevealed(false);
        setDraft("");
        setDraftInvalid(false);
    };

    const saveDraft = async () => {
        const valid = await invoke<string | null>("e2e_key_fingerprint", { key: draft }).catch(() => null);
        if (!valid) {
            setDraftInvalid(true);
            return;
        }
        await apply(draft.trim());
    };

    const confirmOr = (action: "rotate" | "disable", run: () => Promise<void>) => {
        if (armed === action) void run();
        else setArmed(action);
    };

    return (
        <div className={`settings-group ${collapsed ? "collapsed" : ""}`}>
            <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
                <div className="group-header-title">
                    <h3>{t("e2e_settings")}</h3>
                    {fingerprint && <span className="settings-status-dot is-connected" title={t("e2e_on")} />}
                </div>
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {!collapsed && (
                <div className="group-content">
                    <div className="settings-notice">{t("e2e_intro")}</div>
                    {!fingerprint && <div className="settings-notice">{t("e2e_upgrade_first")}</div>}
                    <div className="settings-notice">{t("e2e_plaintext_dropped")}</div>
                    {fingerprint ? (
                        <>
                            <div className="setting-item">
                                <div className="item-label-group">
                                    <span className="item-label">{t("e2e_fingerprint")}</span>
                                    <span className="item-desc">{t("e2e_fingerprint_hint")}</span>
                                </div>
                                <code className="e2e-fingerprint">{fingerprint}</code>
                            </div>
                            <div className="setting-item">
                                <div className="item-label-group">
                                    <span className="item-label">{t("e2e_key")}</span>
                                    <span className="item-desc">{t("e2e_share_hint")}</span>
                                </div>
                                <button type="button" className="settings-action-button settings-action-button--small" onClick={() => setRevealed((value) => !value)}>
                                    {t(revealed ? "e2e_hide_key" : "e2e_show_key")}
                                </button>
                            </div>
                            {revealed && <code className="e2e-key-text">{e2eKey}</code>}
                            <div className="settings-notice">{t("e2e_change_warning")}</div>
                            <div className="e2e-actions">
                                <button type="button" className="settings-action-button settings-action-button--small" onClick={() => confirmOr("rotate", async () => apply(await invoke<string>("generate_e2e_key")))}>
                                    {t(armed === "rotate" ? "e2e_confirm_again" : "e2e_rotate")}
                                </button>
                                <button type="button" className="settings-action-button settings-action-button--small" onClick={() => confirmOr("disable", () => apply(""))}>
                                    {t(armed === "disable" ? "e2e_confirm_again" : "e2e_disable")}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="setting-item">
                                <div className="item-label-group">
                                    <span className="item-label">{t("e2e_off")}</span>
                                </div>
                                <button type="button" className="settings-action-button settings-action-button--small" onClick={async () => apply(await invoke<string>("generate_e2e_key"))}>
                                    {t("e2e_generate")}
                                </button>
                            </div>
                            <div className="setting-item">
                                <input
                                    className="search-input settings-field"
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={draft}
                                    placeholder={t("e2e_paste_placeholder")}
                                    aria-invalid={draftInvalid}
                                    onChange={(e) => {
                                        setDraft(e.target.value);
                                        setDraftInvalid(false);
                                    }}
                                />
                                <button type="button" className="settings-action-button settings-action-button--small" disabled={!draft.trim()} onClick={() => void saveDraft()}>
                                    {t("e2e_save")}
                                </button>
                            </div>
                            {draftInvalid && <div className="settings-notice">{t("e2e_invalid")}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default E2eSettingsGroup;
