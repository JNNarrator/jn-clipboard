import { invoke } from "@tauri-apps/api/core";
import { open, ask, message } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight } from "lucide-react";
import { withNativeDialog } from "../../../../shared/lib/focus";
import { formatError } from "../../../../shared/lib/errorMessage";

interface DataSettingsGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
    dataPath: string;
    /** Portable build: the data stays in the folder next to the app. */
    portable: boolean;
}

const DataSettingsGroup = ({
    t,
    collapsed,
    onToggle,
    dataPath,
    portable
}: DataSettingsGroupProps) => {
    return (
        <div className={`settings-group ${collapsed ? "collapsed" : ""}`}>
            <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
                <h3>{t("data_management")}</h3>
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            {!collapsed && (
                <div className="group-content">
                        <div className="setting-item column">
                            <div className="setting-item-heading">
                                <div className="item-label-group">
                                    <span className="item-label">{t("data_path")}</span>
                                </div>
                                <div className="settings-action-group">
                                    {!portable && (
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button--small"
                                            onClick={async () => {
                                                await withNativeDialog(async () => {
                                                    const selected = await open({
                                                        directory: true,
                                                        multiple: false,
                                                        title: t("change_data_path")
                                                    });
                                                    if (!selected) return;

                                                    const newPath = selected as string;
                                                    const confirmed = await ask(
                                                        t("data_move_confirm").replace("{path}", newPath),
                                                        { title: t("change_data_path"), kind: "warning", okLabel: t("confirm"), cancelLabel: t("cancel") }
                                                    );
                                                    if (!confirmed) return;

                                                    try {
                                                        await invoke("set_data_path", { newPath });
                                                        await message(
                                                            t("data_move_success"),
                                                            { title: t("notice"), kind: "info" }
                                                        );
                                                        await invoke("relaunch");
                                                    } catch (error: unknown) {
                                                        console.error(error);
                                                        await message(
                                                            t("data_move_failed").replace("{e}", formatError(error, t)),
                                                            { title: t("error"), kind: "error" }
                                                        );
                                                    }
                                                }, "settings:change-data-path");
                                            }}
                                        >
                                            {t("change_app")}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button--small"
                                        onClick={async () => {
                                            try {
                                                if (!dataPath) throw new Error(t("not_set"));
                                                await invoke("open_folder", { path: dataPath });
                                            } catch (error: unknown) {
                                                console.error(error);
                                                await withNativeDialog(() => message(
                                                    `${t("open_failed")}${formatError(error, t)}`,
                                                    { title: t("error"), kind: "error" }
                                                ), "settings:data-path-error");
                                            }
                                        }}
                                        title={t("open_folder")}
                                    >
                                        {t("open_folder")}
                                    </button>
                                </div>
                            </div>
                            <div className="data-panel settings-path-panel is-static">
                                {dataPath}
                            </div>
                            {portable && (
                                <span className="item-desc">{t("data_path_portable_hint")}</span>
                            )}
                        </div>
                </div>
            )}
        </div>
    );
};

export default DataSettingsGroup;
