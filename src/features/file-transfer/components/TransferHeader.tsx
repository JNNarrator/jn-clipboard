import { useState, useRef, useEffect } from "react";
import {
    FolderOpen,
    Trash2,
    Search,
    MoreHorizontal,
    Globe,
    Check,
} from "lucide-react";
import type { NetworkInterfaceInfo } from "../types";

export interface TransferHeaderProps {
    t: (key: string) => string;
    hasOnlineDevices: boolean;
    conversationTitle: string;
    onlineDevicesCount: number;
    /** Names of connected TieZ apps that predate encryption. */
    unencryptedDevices: string[];
    activeIp?: string;
    actualPort?: string;
    selectedIp: string;
    interfaces: NetworkInterfaceInfo[];
    onSwitchIp: (ip: string) => void;
    showSearchBar: boolean;
    isFiltering: boolean;
    onToggleSearch: () => void;
    onOpenFolder: () => void;
    hasMessages: boolean;
    onClearHistory: () => void;
    connectionUrl?: string;
    copiedLink?: boolean;
    onCopyLink?: (url: string) => void;
    showQrCode?: boolean;
    onToggleQrCode?: () => void;
}

export const TransferHeader = ({
    t,
    hasOnlineDevices,
    conversationTitle,
    onlineDevicesCount,
    unencryptedDevices,
    selectedIp,
    interfaces,
    onSwitchIp,
    showSearchBar,
    isFiltering,
    onToggleSearch,
    onOpenFolder,
    hasMessages,
    onClearHistory,
}: TransferHeaderProps) => {
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        if (!showMoreMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (!moreMenuRef.current?.contains(e.target as Node)) {
                setShowMoreMenu(false);
            }
        };
        window.addEventListener("pointerdown", handleClickOutside);
        return () => window.removeEventListener("pointerdown", handleClickOutside);
    }, [showMoreMenu]);

    return (
        <div className="wt-header">
            {/* Left: Clear connection status indicator */}
            <div className="wt-header-status-group">
                <span
                    className={`wt-status-dot ${hasOnlineDevices ? "is-online" : "is-waiting"}`}
                    aria-hidden="true"
                />
                <div className="wt-header-status-copy">
                    <span className="wt-status-primary">
                        {hasOnlineDevices
                            ? (conversationTitle || t("ft_device_ready"))
                            : t("ft_waiting_device")}
                    </span>
                    {hasOnlineDevices && unencryptedDevices.length > 0 ? (
                        <span className="wt-status-secondary wt-status-warning" title={t("ft_unencrypted_hint")}>
                            {t("ft_unencrypted_device").replace("{name}", unencryptedDevices.join("、"))}
                        </span>
                    ) : hasOnlineDevices && (
                        <span className="wt-status-secondary">
                            {onlineDevicesCount === 1 ? t("ft_lan_transferring") : t("ft_devices_online").replace("{n}", String(onlineDevicesCount))}
                        </span>
                    )}
                </div>
            </div>

            {/* Right: Only primary Search button + "三个点" (...) More Menu button */}
            <div className="wt-header-actions" ref={moreMenuRef}>
                <button
                    type="button"
                    className={`wt-header-action ${showSearchBar || isFiltering ? "is-active" : ""}`}
                    title={showSearchBar ? t("ft_close_search") : t("ft_search_records_hotkey")}
                    aria-label={t("ft_search_records")}
                    onClick={onToggleSearch}
                >
                    <Search size={15} strokeWidth={2.2} />
                </button>

                <button
                    type="button"
                    className={`wt-header-action ${showMoreMenu ? "is-active" : ""}`}
                    title={t("more_actions")}
                    aria-label={t("more_actions")}
                    aria-expanded={showMoreMenu}
                    onClick={() => setShowMoreMenu((prev) => !prev)}
                >
                    <MoreHorizontal size={18} strokeWidth={2.4} />
                </button>

                {/* "三个点" 更多操作下拉菜单 */}
                {showMoreMenu && (
                    <div className="wt-more-menu" role="menu">
                        <button
                            type="button"
                            className="wt-more-menu-item"
                            role="menuitem"
                            onClick={() => {
                                setShowMoreMenu(false);
                                onOpenFolder();
                            }}
                        >
                            <FolderOpen size={16} strokeWidth={1.8} />
                            <span>{t("ft_open_save_folder")}</span>
                        </button>

                        {interfaces.length > 1 && (
                            <>
                                <div className="wt-more-menu-divider" role="separator" />
                                <div className="wt-more-menu-section-label">{t("ft_switch_network")}</div>
                                {interfaces.map((iface) => (
                                    <button
                                        key={iface.ip}
                                        type="button"
                                        className={`wt-more-menu-item ${selectedIp === iface.ip ? "is-selected" : ""}`}
                                        role="menuitemradio"
                                        aria-checked={selectedIp === iface.ip}
                                        onClick={() => {
                                            onSwitchIp(iface.ip);
                                        }}
                                    >
                                        <Globe size={16} strokeWidth={1.8} />
                                        <span className="wt-more-menu-ip-label">{iface.label}</span>
                                        {selectedIp === iface.ip && <Check size={15} strokeWidth={2.4} className="wt-more-menu-check" />}
                                    </button>
                                ))}
                            </>
                        )}

                        {hasMessages && (
                            <>
                                <div className="wt-more-menu-divider" role="separator" />
                                <button
                                    type="button"
                                    className="wt-more-menu-item is-danger"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        onClearHistory();
                                    }}
                                >
                                    <Trash2 size={16} strokeWidth={1.8} />
                                    <span>{t("ft_clear_history")}</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
