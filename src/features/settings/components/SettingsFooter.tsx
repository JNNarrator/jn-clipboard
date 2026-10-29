import { Github, MessageSquare, RefreshCw, RotateCcw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import SettingsAbout from "./SettingsAbout";
import { useUpdateCheck } from "../../../shared/hooks/useUpdateCheck";
import { formatError } from "../../../shared/lib/errorMessage";
import type { ReleaseChannel } from "../../../shared/lib/releaseBuild";

const REPO_URL = "https://github.com/JNNarrator/jn-clipboard";

interface SettingsFooterProps {
    expanded?: boolean;
    t: (key: string) => string;
    appVersion: string;
    releaseChannel: ReleaseChannel;
    portable: boolean;
    onResetSettings: () => void;
}

const cardStyle = {
    cursor: "pointer",
    transition: "all 0.2s",
    margin: 0,
    width: "auto",
    padding: "10px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "0"
} as const;

const linkStyle = {
    fontSize: "var(--font-size-xs)",
    color: "var(--accent-color)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
    opacity: 0.7,
    fontWeight: 600,
    padding: "2px 4px"
} as const;

const SettingsFooter = ({
    expanded = false,
    t,
    appVersion,
    releaseChannel,
    portable,
    onResetSettings
}: SettingsFooterProps) => {
    const openIssues = () => void openUrl(`${REPO_URL}/issues`);
    const update = useUpdateCheck();

    if (expanded) {
        return (
            <SettingsAbout
                t={t}
                appVersion={appVersion}
                releaseChannel={releaseChannel}
                portable={portable}
                onResetSettings={onResetSettings}
            />
        );
    }

    return (
        <>
            {/* Footer Actions */}
            <div style={{
                marginTop: "16px",
                display: "flex",
                justifyContent: "center",
                gap: "12px",
                flexWrap: "wrap"
            }}>
                {/* Feedback Card */}
                <div className="settings-group" style={cardStyle} onClick={openIssues}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <MessageSquare size={16} />
                        <span style={{ fontSize: "var(--font-size-base)", fontWeight: 600 }}>
                            {t("feedback")}
                        </span>
                    </div>
                </div>

                {/* Update Card */}
                <div
                    className="settings-group"
                    style={cardStyle}
                    onClick={() => void update.check()}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <RefreshCw size={16} />
                        <span style={{ fontSize: "var(--font-size-base)", fontWeight: 600 }}>
                            {update.checking ? t("checking_update") : t("check_update")}
                        </span>
                    </div>
                </div>

                {/* Reset Card */}
                <div className="settings-group" style={cardStyle} onClick={() => onResetSettings()}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <RotateCcw size={16} />
                        <span style={{ fontSize: "var(--font-size-base)", fontWeight: 600 }}>{t("reset_defaults")}</span>
                    </div>
                </div>
            </div>

            {/* Version Info */}
            <div style={{
                marginTop: "16px",
                marginBottom: "32px",
                textAlign: "center",
                opacity: 1
            }}>
                <div style={{
                    fontSize: "var(--font-size-base)",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    letterSpacing: "0.5px",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px"
                }}>
                    <span>jn-clipboard {appVersion ? `v${appVersion}` : ""}</span>
                    {releaseChannel === "beta" && (
                        <span className="settings-version-badge beta">Beta</span>
                    )}
                    {portable && (
                        <span className="settings-version-badge portable">Portable</span>
                    )}
                </div>
                <div style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                    marginBottom: "4px"
                }}>
                    {t("slogan")}
                </div>

                {/* Update result. Stays empty until the user asks, so the footer
                    does not grow a second line for nothing. */}
                {update.error && (
                    <div className="settings-panel-meta is-error" style={{ marginBottom: "6px" }}>
                        {formatError(update.error, t)}
                    </div>
                )}
                {update.info?.available && (
                    <div style={{ marginBottom: "6px" }}>
                        <div className="settings-panel-meta" style={{ marginBottom: "6px" }}>
                            {t("update_available").replace(
                                "{version}",
                                `v${update.info.latestVersion ?? ""}`
                            )}
                        </div>
                        {update.info.releaseUrl && (
                            <button
                                className="settings-action-button settings-action-button--small"
                                onClick={() => void openUrl(update.info!.releaseUrl!)}
                            >
                                {t("download_update")}
                            </button>
                        )}
                    </div>
                )}
                {update.info && !update.info.available && (
                    <div className="settings-panel-meta" style={{ marginBottom: "6px" }}>
                        {t("update_up_to_date")}
                    </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
                    <button
                        onClick={() => void openUrl(REPO_URL)}
                        style={{ ...linkStyle, display: "inline-flex", alignItems: "center", gap: "4px" }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                    >
                        <Github size={12} />
                        <span>GitHub</span>
                    </button>
                </div>
            </div>
        </>
    );
};

export default SettingsFooter;
